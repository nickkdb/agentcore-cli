import type { AgentCoreProjectSpec, DeployedResourceState, HttpGatewayDeployedState } from '../../../schema';
import { getCredentialProvider } from '../../aws/account';
import {
  createHttpGateway,
  createHttpGatewayTarget,
  deleteHttpGateway,
  deleteHttpGatewayTarget,
  getHttpGatewayTarget,
  listAllHttpGateways,
  listHttpGatewayTargets,
  waitForGatewayReady,
  waitForTargetReady,
} from '../../aws/agentcore-http-gateways';
import {
  CloudWatchLogsClient,
  CreateDeliveryCommand,
  DescribeDeliverySourcesCommand,
  PutDeliveryDestinationCommand,
  PutDeliverySourceCommand,
} from '@aws-sdk/client-cloudwatch-logs';
import {
  CreateRoleCommand,
  DeleteRoleCommand,
  DeleteRolePolicyCommand,
  GetRoleCommand,
  IAMClient,
  PutRolePolicyCommand,
} from '@aws-sdk/client-iam';
import { createHash } from 'node:crypto';

// ============================================================================
// Types
// ============================================================================

export interface SetupHttpGatewaysOptions {
  region: string;
  projectName: string;
  projectSpec: AgentCoreProjectSpec;
  existingHttpGateways?: Record<string, HttpGatewayDeployedState>;
  deployedResources?: DeployedResourceState;
}

export interface HttpGatewaySetupResult {
  gatewayName: string;
  status: 'created' | 'skipped' | 'deleted' | 'error';
  gatewayId?: string;
  gatewayArn?: string;
  error?: string;
}

export interface SetupHttpGatewaysResult {
  results: HttpGatewaySetupResult[];
  httpGateways: Record<string, HttpGatewayDeployedState>;
  hasErrors: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const HTTP_GATEWAY_ROLE_POLICY_NAME = 'HttpGatewayExecutionPolicy';

// ============================================================================
// Implementation
// ============================================================================

/**
 * Create or delete HTTP gateways post-deploy.
 *
 * Pattern:
 * 1. For each httpGateway in project spec -> resolve runtime ARN, create or skip
 * 2. For each httpGateway in deployed-state but NOT in project spec -> delete (reconciliation)
 * 3. Return updated deployed state entries
 */
export async function setupHttpGateways(options: SetupHttpGatewaysOptions): Promise<SetupHttpGatewaysResult> {
  const { region, projectName, projectSpec, existingHttpGateways, deployedResources } = options;
  const results: HttpGatewaySetupResult[] = [];
  const httpGateways: Record<string, HttpGatewayDeployedState> = {};

  // Defensive: Zod .default([]) only fires on undefined, not null.
  // If someone has "httpGateways": null in their JSON, it passes through as null.
  const httpGatewaySpecs = projectSpec.httpGateways ?? [];

  const specGatewayNames = new Set(httpGatewaySpecs.map(gw => gw.name));

  // Create or skip gateways from the spec
  for (const gwSpec of httpGatewaySpecs) {
    let resolvedRoleArn: string | undefined;
    let roleCreatedByCli = false;
    try {
      const existingGateway = existingHttpGateways?.[gwSpec.name];

      if (existingGateway) {
        // Already deployed — ensure trace delivery is enabled (may have failed on initial deploy)
        await ensureTraceDelivery({ region, gatewayName: gwSpec.name, gatewayArn: existingGateway.gatewayArn });
        httpGateways[gwSpec.name] = existingGateway;
        results.push({
          gatewayName: gwSpec.name,
          status: 'skipped',
          gatewayId: existingGateway.gatewayId,
          gatewayArn: existingGateway.gatewayArn,
        });
        continue;
      }

      // Try to find by name via list (handles re-creation after state loss)
      const existingByName = await findHttpGatewayByName(region, gwSpec.name);
      if (existingByName) {
        console.warn(
          `Warning: HTTP gateway "${gwSpec.name}" found by name but local state was lost. Target and role state may be incomplete — consider re-deploying.`
        );
        // Ensure trace delivery is enabled (may have failed on initial deploy)
        await ensureTraceDelivery({ region, gatewayName: gwSpec.name, gatewayArn: existingByName.gatewayArn });
        httpGateways[gwSpec.name] = {
          gatewayId: existingByName.gatewayId,
          gatewayArn: existingByName.gatewayArn,
          // targetId, roleArn, roleCreatedByCli unknown after state-loss recovery
        };
        results.push({
          gatewayName: gwSpec.name,
          status: 'skipped',
          gatewayId: existingByName.gatewayId,
          gatewayArn: existingByName.gatewayArn,
        });
        continue;
      }

      // Resolve runtime ARN from deployed state
      const runtimeState = deployedResources?.runtimes?.[gwSpec.runtimeRef];
      if (!runtimeState) {
        results.push({
          gatewayName: gwSpec.name,
          status: 'error',
          error: `Runtime "${gwSpec.runtimeRef}" not found in deployed resources. Deploy the runtime before creating an HTTP gateway.`,
        });
        continue;
      }
      const runtimeArn = runtimeState.runtimeArn;
      if (gwSpec.roleArn) {
        resolvedRoleArn = gwSpec.roleArn;
      } else {
        resolvedRoleArn = await getOrCreateHttpGatewayRole({
          region,
          projectName,
          gatewayName: gwSpec.name,
          runtimeArn,
        });
        roleCreatedByCli = true;
      }

      // Create gateway and wait for it to become READY before adding targets
      // Creating HTTP gateway for runtime
      const createResult = await createHttpGateway({
        region,
        name: gwSpec.name,
        roleArn: resolvedRoleArn,
      });

      const readyGateway = await waitForGatewayReady({
        region,
        gatewayId: createResult.gatewayId,
      });

      // Create target pointing to the runtime
      let targetId: string | undefined;
      try {
        const targetResult = await createHttpGatewayTarget({
          region,
          gatewayId: createResult.gatewayId,
          targetName: gwSpec.runtimeRef,
          runtimeArn,
        });

        targetId = targetResult.targetId;

        // Wait for target to become ready
        // Waiting for gateway target to become ready
        await waitForTargetReady({
          region,
          gatewayId: createResult.gatewayId,
          targetId: targetResult.targetId,
        });
      } catch (targetErr) {
        // Rollback: delete target (if created), wait for deletion, then delete gateway
        try {
          if (targetId) {
            await deleteHttpGatewayTarget({ region, gatewayId: createResult.gatewayId, targetId });
            await waitForTargetDeletion({ region, gatewayId: createResult.gatewayId, targetId });
          }
        } catch {
          // Best-effort target cleanup
        }
        try {
          await deleteHttpGateway({ region, gatewayId: createResult.gatewayId });
        } catch {
          // Best-effort gateway rollback
        }

        // Always clean up auto-created role on target failure, regardless of gateway rollback result
        if (roleCreatedByCli && resolvedRoleArn) {
          try {
            await deleteHttpGatewayRole(region, resolvedRoleArn);
          } catch {
            // Best-effort role cleanup
          }
        }

        results.push({
          gatewayName: gwSpec.name,
          status: 'error',
          error: `Target creation failed, gateway rolled back: ${targetErr instanceof Error ? targetErr.message : String(targetErr)}`,
        });
        continue;
      }

      // Enable gateway trace delivery to aws/spans (required for online eval + AB test aggregation).
      // Without this, the AB test aggregation pipeline won't receive gateway spans.
      try {
        await enableGatewayTraceDelivery({
          region,
          gatewayName: gwSpec.name,
          gatewayArn: createResult.gatewayArn,
        });
      } catch (traceErr) {
        // Rollback: delete target (and wait for deletion), then gateway, then role
        try {
          if (targetId) {
            await deleteHttpGatewayTarget({ region, gatewayId: createResult.gatewayId, targetId });
            await waitForTargetDeletion({ region, gatewayId: createResult.gatewayId, targetId });
          }
        } catch {
          // Best-effort target cleanup
        }
        try {
          await deleteHttpGateway({ region, gatewayId: createResult.gatewayId });
        } catch {
          // Best-effort gateway cleanup
        }
        if (roleCreatedByCli && resolvedRoleArn) {
          try {
            await deleteHttpGatewayRole(region, resolvedRoleArn);
          } catch {
            // Best-effort role cleanup
          }
        }

        results.push({
          gatewayName: gwSpec.name,
          status: 'error',
          error:
            `Trace delivery failed, gateway rolled back: ${traceErr instanceof Error ? traceErr.message : String(traceErr)}. ` +
            `Enable manually with: aws logs put-delivery-source --name gateway-traces-${gwSpec.name} --resource-arn ${createResult.gatewayArn} --log-type TRACES --region ${region}`,
        });
        continue;
      }

      httpGateways[gwSpec.name] = {
        gatewayId: createResult.gatewayId,
        gatewayArn: createResult.gatewayArn,
        gatewayUrl: readyGateway.gatewayUrl,
        targetId,
        roleArn: resolvedRoleArn,
        roleCreatedByCli,
      };

      results.push({
        gatewayName: gwSpec.name,
        status: 'created',
        gatewayId: createResult.gatewayId,
        gatewayArn: createResult.gatewayArn,
      });
    } catch (err) {
      // If we auto-created a role, clean it up on failure
      if (roleCreatedByCli && resolvedRoleArn) {
        try {
          await deleteHttpGatewayRole(region, resolvedRoleArn);
        } catch {
          // Best-effort role cleanup
        }
      }
      results.push({
        gatewayName: gwSpec.name,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Delete orphaned HTTP gateways (in deployed-state but removed from spec)
  if (existingHttpGateways) {
    for (const [gwName, gwState] of Object.entries(existingHttpGateways)) {
      if (!specGatewayNames.has(gwName)) {
        try {
          // Delete all targets before deleting the gateway.
          // Use known targetId first; fall back to listing all targets.
          const targetIds: string[] = [];
          if (gwState.targetId) {
            targetIds.push(gwState.targetId);
          } else {
            try {
              const targets = await listHttpGatewayTargets({
                region,
                gatewayId: gwState.gatewayId,
                maxResults: 100,
              });
              targetIds.push(...targets.targets.map(t => t.targetId));
            } catch {
              // Best-effort — proceed with gateway deletion anyway
            }
          }

          for (const targetId of targetIds) {
            const targetDeleteResult = await deleteHttpGatewayTarget({
              region,
              gatewayId: gwState.gatewayId,
              targetId,
            });
            if (!targetDeleteResult.success) {
              console.warn(
                `Warning: Failed to delete target "${targetId}" for orphaned gateway "${gwName}": ${targetDeleteResult.error}. Proceeding with best-effort gateway deletion.`
              );
            }
          }

          // Delete gateway (best-effort even if target deletion failed)
          const deleteResult = await deleteHttpGateway({
            region,
            gatewayId: gwState.gatewayId,
          });

          // Clean up the auto-created IAM role only if gateway deletion succeeded
          if (deleteResult.success && gwState.roleCreatedByCli && gwState.roleArn) {
            await deleteHttpGatewayRole(region, gwState.roleArn);
          }

          results.push({
            gatewayName: gwName,
            status: deleteResult.success ? 'deleted' : 'error',
            error: deleteResult.error,
          });
        } catch (err) {
          results.push({
            gatewayName: gwName,
            status: 'error',
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }

  return {
    results,
    httpGateways,
    hasErrors: results.some(r => r.status === 'error'),
  };
}

// ============================================================================
// Gateway Trace Delivery
// ============================================================================

/**
 * Enable CloudWatch log delivery for gateway traces.
 *
 * Sets up the full delivery chain: source → destination → delivery.
 * Required for online eval + AB test aggregation pipeline.
 *
 * 1. PutDeliverySource — register gateway as TRACES source
 * 2. PutDeliveryDestination — create XRAY destination
 * 3. CreateDelivery — connect source to destination
 */
async function enableGatewayTraceDelivery(options: {
  region: string;
  gatewayName: string;
  gatewayArn: string;
}): Promise<void> {
  const { region, gatewayName, gatewayArn } = options;
  const credentials = getCredentialProvider();
  const logsClient = new CloudWatchLogsClient({ region, credentials });

  const sourceName = `agentcore-gw-traces-${gatewayName}`;
  const destName = `agentcore-gw-dest-${gatewayName}`;

  // 1. Register gateway as trace source
  await logsClient.send(
    new PutDeliverySourceCommand({
      name: sourceName,
      resourceArn: gatewayArn,
      logType: 'TRACES',
    })
  );

  // 2. Create XRAY destination
  const destResult = await logsClient.send(
    new PutDeliveryDestinationCommand({
      name: destName,
      deliveryDestinationType: 'XRAY',
    })
  );

  const destArn = destResult.deliveryDestination?.arn;
  if (!destArn) {
    throw new Error('PutDeliveryDestination returned no ARN');
  }

  // 3. Connect source to destination (may already exist on redeploy)
  try {
    await logsClient.send(
      new CreateDeliveryCommand({
        deliverySourceName: sourceName,
        deliveryDestinationArn: destArn,
      })
    );
  } catch (err) {
    const errName = (err as { name?: string }).name;
    if (errName !== 'ConflictException') throw err;
    // Delivery already exists — idempotent
  }

  // Gateway trace delivery enabled
}

/**
 * Check if trace delivery is already enabled for a gateway.
 * If not, enable it. Failures are logged as warnings (non-fatal for existing gateways).
 */
async function ensureTraceDelivery(options: {
  region: string;
  gatewayName: string;
  gatewayArn: string;
}): Promise<void> {
  const { region, gatewayName, gatewayArn } = options;
  const credentials = getCredentialProvider();
  const logsClient = new CloudWatchLogsClient({ region, credentials });

  try {
    const sources = await logsClient.send(new DescribeDeliverySourcesCommand({}));
    const hasSource = (sources.deliverySources ?? []).some(
      s => s.resourceArns?.some(a => a.endsWith(`/${gatewayArn.split('/').pop()!}`)) && s.logType === 'TRACES'
    );

    if (!hasSource) {
      await enableGatewayTraceDelivery({ region, gatewayName, gatewayArn });
    }
  } catch (err) {
    console.warn(
      `Warning: Could not verify/enable trace delivery for gateway "${gatewayName}": ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Wait for a gateway target to be fully deleted before deleting the gateway.
 * Polls getHttpGatewayTarget until it returns 404 or timeout is reached.
 */
async function waitForTargetDeletion(options: {
  region: string;
  gatewayId: string;
  targetId: string;
  timeoutMs?: number;
}): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const startTime = Date.now();
  let delayMs = 2_000;

  while (Date.now() - startTime < timeoutMs) {
    try {
      await getHttpGatewayTarget({
        region: options.region,
        gatewayId: options.gatewayId,
        targetId: options.targetId,
      });
      // Target still exists — keep waiting
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('(404)') || msg.includes('not found')) {
        return; // Target confirmed deleted
      }
      // Transient error — keep polling rather than assuming deleted
    }

    const remaining = timeoutMs - (Date.now() - startTime);
    if (remaining <= 0) break;
    await new Promise(resolve => setTimeout(resolve, Math.min(delayMs, remaining)));
    delayMs = Math.min(delayMs * 2, 8_000);
  }
}

// ============================================================================
// Helpers
// ============================================================================

async function findHttpGatewayByName(
  region: string,
  name: string
): Promise<{ gatewayId: string; gatewayArn: string } | undefined> {
  try {
    const gateways = await listAllHttpGateways({ region });
    return gateways.find(gw => gw.name === name);
  } catch (err) {
    console.warn(
      `Warning: Could not list HTTP gateways to check for existing "${name}": ${err instanceof Error ? err.message : String(err)}`
    );
    return undefined;
  }
}

// ============================================================================
// IAM Role Management
// ============================================================================

/**
 * Generate a project-scoped role name following the CDK pattern:
 * AgentCore-{ProjectName}-HttpGw{GatewayName}-{Hash}
 */
function generateRoleName(projectName: string, gatewayName: string): string {
  const base = `AgentCore-${projectName}-HttpGw${gatewayName}`;
  // Use deterministic hash so retries produce the same role name
  const hash = createHash('sha256').update(`${projectName}:${gatewayName}`).digest('hex').slice(0, 8);
  // IAM role names max 64 chars
  return `${base.slice(0, 55)}-${hash}`;
}

/**
 * Extract role name from ARN: arn:aws:iam::123456789012:role/RoleName -> RoleName
 */
function roleNameFromArn(roleArn: string): string {
  const parts = roleArn.split('/');
  return parts[parts.length - 1] ?? roleArn;
}

interface CreateHttpGatewayRoleOptions {
  region: string;
  projectName: string;
  gatewayName: string;
  runtimeArn: string;
}

async function getOrCreateHttpGatewayRole(options: CreateHttpGatewayRoleOptions): Promise<string> {
  const { region, projectName, gatewayName } = options;
  const credentials = getCredentialProvider();
  const iamClient = new IAMClient({ region, credentials });

  const roleName = generateRoleName(projectName, gatewayName);

  const trustPolicy = JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: { Service: 'bedrock-agentcore.amazonaws.com' },
        Action: 'sts:AssumeRole',
      },
    ],
  });

  const policy = JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'InvokeRuntimeStatement',
        Effect: 'Allow',
        Action: [
          'bedrock-agentcore:InvokeRuntime',
          'bedrock-agentcore:InvokeAgent',
          'bedrock-agentcore:InvokeAgentRuntime',
        ],
        // Resource must be '*' because the gateway service invokes runtimes using
        // a resource identifier that doesn't match the deployed runtime ARN format.
        // This matches the A/B testing guide's gateway role policy.
        Resource: '*',
      },
    ],
  });

  let roleArn: string;
  let needsPropagationWait = false;

  try {
    const createResult = await iamClient.send(
      new CreateRoleCommand({
        RoleName: roleName,
        AssumeRolePolicyDocument: trustPolicy,
        Description: `Auto-created execution role for AgentCore HTTP gateway: ${gatewayName}`,
        Tags: [
          { Key: 'agentcore:created-by', Value: 'agentcore-cli' },
          { Key: 'agentcore:project-name', Value: projectName },
          { Key: 'agentcore:http-gateway-name', Value: gatewayName },
        ],
      })
    );

    roleArn = createResult.Role?.Arn ?? '';
    if (!roleArn) {
      throw new Error(`IAM CreateRole succeeded but returned no role ARN for "${roleName}"`);
    }
    needsPropagationWait = true;
  } catch (err: unknown) {
    // Handle retry after a previous failed deploy left the role behind
    const errName = (err as { name?: string }).name;
    if (errName === 'EntityAlreadyExistsException') {
      // IAM role already exists — reusing
      const existing = await iamClient.send(new GetRoleCommand({ RoleName: roleName }));
      roleArn = existing.Role?.Arn ?? '';
      if (!roleArn) {
        throw new Error(`Role "${roleName}" already exists but ARN could not be retrieved`);
      }
    } else {
      throw new Error(
        `Failed to create IAM role "${roleName}" for HTTP gateway "${gatewayName}": ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // Re-apply the inline policy (idempotent — covers both new and recovered roles)
  await iamClient.send(
    new PutRolePolicyCommand({
      RoleName: roleName,
      PolicyName: HTTP_GATEWAY_ROLE_POLICY_NAME,
      PolicyDocument: policy,
    })
  );

  if (needsPropagationWait) {
    // Waiting for IAM role propagation (~15s)
    await new Promise(resolve => setTimeout(resolve, 15_000));
  }

  return roleArn;
}

export async function deleteHttpGatewayRole(region: string, roleArn: string): Promise<void> {
  const credentials = getCredentialProvider();
  const iamClient = new IAMClient({ region, credentials });
  const roleName = roleNameFromArn(roleArn);

  try {
    // Must delete inline policies before deleting the role
    await iamClient.send(
      new DeleteRolePolicyCommand({
        RoleName: roleName,
        PolicyName: HTTP_GATEWAY_ROLE_POLICY_NAME,
      })
    );
  } catch {
    // Policy may not exist
  }

  try {
    await iamClient.send(new DeleteRoleCommand({ RoleName: roleName }));
  } catch {
    // Role may already be deleted or in use -- best effort
  }
}
