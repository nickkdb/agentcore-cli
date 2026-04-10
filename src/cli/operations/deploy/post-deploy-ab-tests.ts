import type { ABTestDeployedState, AgentCoreProjectSpec, DeployedResourceState } from '../../../schema';
import { getCredentialProvider } from '../../aws/account';
import { createABTest, deleteABTest, listABTests } from '../../aws/agentcore-ab-tests';
import type { ABTestEvaluationConfig, ABTestVariant, TrafficAllocationConfig } from '../../aws/agentcore-ab-tests';
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

export interface SetupABTestsOptions {
  region: string;
  projectSpec: AgentCoreProjectSpec;
  existingABTests?: Record<string, ABTestDeployedState>;
  /** Full deployed resource state for resolving ARN references. */
  deployedResources?: DeployedResourceState;
}

export interface ABTestSetupResult {
  testName: string;
  status: 'created' | 'updated' | 'deleted' | 'skipped' | 'error';
  abTestId?: string;
  abTestArn?: string;
  error?: string;
}

export interface SetupABTestsResult {
  results: ABTestSetupResult[];
  abTests: Record<string, ABTestDeployedState>;
  hasErrors: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const AB_TEST_ROLE_POLICY_NAME = 'ABTestExecutionPolicy';

// ============================================================================
// Implementation
// ============================================================================

/**
 * Create, update, or delete AB tests post-deploy.
 *
 * Pattern:
 * 1. For each AB test in project spec → resolve ARN references, create or skip
 * 2. For each AB test in deployed-state but NOT in project spec → delete (reconciliation)
 * 3. Return updated deployed state entries
 */
export async function setupABTests(options: SetupABTestsOptions): Promise<SetupABTestsResult> {
  const { region, projectSpec, existingABTests, deployedResources } = options;
  const results: ABTestSetupResult[] = [];
  const abTests: Record<string, ABTestDeployedState> = {};

  // Create or skip tests from the spec
  for (const testSpec of projectSpec.abTests) {
    try {
      const existingTest = existingABTests?.[testSpec.name];

      if (existingTest) {
        // Already deployed — skip (AB tests are updated via lifecycle commands, not deploy)
        abTests[testSpec.name] = existingTest;
        results.push({
          testName: testSpec.name,
          status: 'skipped',
          abTestId: existingTest.abTestId,
          abTestArn: existingTest.abTestArn,
        });
        continue;
      }

      // Try to find by name via list (handles re-creation after state loss)
      const existingByName = await findABTestByName(region, testSpec.name);
      if (existingByName) {
        abTests[testSpec.name] = {
          abTestId: existingByName.abTestId,
          abTestArn: existingByName.abTestArn,
        };
        results.push({
          testName: testSpec.name,
          status: 'skipped',
          abTestId: existingByName.abTestId,
          abTestArn: existingByName.abTestArn,
        });
        continue;
      }

      // Resolve ARN references from deployed state
      const resolvedVariants = resolveVariants(testSpec.variants, deployedResources);
      const resolvedGatewayArn = resolveGatewayArn(testSpec.gatewayRef, deployedResources);
      if (!resolvedGatewayArn.startsWith('arn:') || resolvedGatewayArn.split(':').length < 6) {
        results.push({
          testName: testSpec.name,
          status: 'error',
          error: `Gateway ARN could not be resolved for AB test "${testSpec.name}". Reference "${testSpec.gatewayRef}" did not match any deployed gateway. Ensure the HTTP gateway was deployed successfully.`,
        });
        continue;
      }
      const resolvedEvalConfig = resolveEvalConfig(testSpec.evaluationConfig, deployedResources);

      // Resolve or auto-create role
      let resolvedRoleArn: string;
      let roleCreatedByCli = false;
      if (testSpec.roleArn) {
        resolvedRoleArn = testSpec.roleArn;
      } else {
        resolvedRoleArn = await getOrCreateABTestRole({
          region,
          projectName: projectSpec.name,
          testName: testSpec.name,
          gatewayArn: resolvedGatewayArn,
          onlineEvalConfigArn: resolvedEvalConfig.onlineEvaluationConfigArn,
        });
        roleCreatedByCli = true;
      }

      const result = await createABTest({
        region,
        name: testSpec.name,
        description: testSpec.description,
        gatewayArn: resolvedGatewayArn,
        roleArn: resolvedRoleArn,
        variants: resolvedVariants,
        evaluationConfig: resolvedEvalConfig,
        trafficAllocationConfig: testSpec.trafficAllocationConfig as TrafficAllocationConfig | undefined,
        maxDurationDays: testSpec.maxDurationDays,
        enableOnCreate: testSpec.enableOnCreate,
      });

      abTests[testSpec.name] = {
        abTestId: result.abTestId,
        abTestArn: result.abTestArn,
        roleArn: resolvedRoleArn,
        roleCreatedByCli,
      };

      results.push({
        testName: testSpec.name,
        status: 'created',
        abTestId: result.abTestId,
        abTestArn: result.abTestArn,
      });
    } catch (err) {
      results.push({
        testName: testSpec.name,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Orphaned AB tests are deleted by deleteOrphanedABTests() which runs
  // as a separate pre-pass before HTTP gateway setup. No deletion loop here.

  return {
    results,
    abTests,
    hasErrors: results.some(r => r.status === 'error'),
  };
}

/**
 * Delete orphaned AB tests (in deployed-state but removed from spec).
 *
 * AB tests create rules on HTTP gateways, so they must be deleted before
 * the gateway can be deleted. Call this before setupHttpGateways.
 *
 * The main setupABTests deletion loop becomes a no-op for any tests
 * already cleaned up here.
 */
export async function deleteOrphanedABTests(options: {
  region: string;
  projectSpec: AgentCoreProjectSpec;
  existingABTests?: Record<string, ABTestDeployedState>;
}): Promise<{ results: ABTestSetupResult[]; hasErrors: boolean }> {
  const { region, projectSpec, existingABTests } = options;
  if (!existingABTests) return { results: [], hasErrors: false };

  const specTestNames = new Set(projectSpec.abTests.map(t => t.name));
  const results: ABTestSetupResult[] = [];

  for (const [testName, testState] of Object.entries(existingABTests)) {
    if (!specTestNames.has(testName)) {
      try {
        const deleteResult = await deleteABTest({
          region,
          abTestId: testState.abTestId,
        });

        if (deleteResult.success && testState.roleCreatedByCli && testState.roleArn) {
          await deleteABTestRole(region, testState.roleArn);
        }

        results.push({
          testName,
          status: deleteResult.success ? 'deleted' : 'error',
          error: deleteResult.error,
        });
      } catch (err) {
        results.push({
          testName,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return {
    results,
    hasErrors: results.some(r => r.status === 'error'),
  };
}

// ============================================================================
// ARN Resolution Helpers
// ============================================================================

async function findABTestByName(
  region: string,
  name: string
): Promise<{ abTestId: string; abTestArn: string } | undefined> {
  try {
    const result = await listABTests({ region, maxResults: 100 });
    return result.abTests.find(t => t.name.toLowerCase() === name.toLowerCase());
  } catch {
    return undefined;
  }
}

/**
 * Resolve variant config bundle references.
 * If bundleArn is a name (not an ARN), look it up in deployed config bundles.
 */
function resolveVariants(
  variants: {
    name: 'C' | 'T1';
    weight: number;
    variantConfiguration: { configurationBundle: { bundleArn: string; bundleVersion: string } };
  }[],
  deployedResources?: DeployedResourceState
): ABTestVariant[] {
  return variants.map(v => ({
    name: v.name,
    weight: v.weight,
    variantConfiguration: {
      configurationBundle: {
        bundleArn: resolveConfigBundleArn(v.variantConfiguration.configurationBundle.bundleArn, deployedResources),
        bundleVersion: resolveConfigBundleVersion(
          v.variantConfiguration.configurationBundle.bundleArn,
          v.variantConfiguration.configurationBundle.bundleVersion,
          deployedResources
        ),
      },
    },
  }));
}

function resolveConfigBundleArn(ref: string, deployedResources?: DeployedResourceState): string {
  if (ref.startsWith('arn:')) return ref;

  const bundles = deployedResources?.configBundles;
  if (bundles?.[ref]) {
    return bundles[ref].bundleArn;
  }

  return ref;
}

function resolveConfigBundleVersion(
  bundleRef: string,
  versionRef: string,
  deployedResources?: DeployedResourceState
): string {
  if (versionRef !== 'LATEST') return versionRef;

  // Resolve LATEST to the deployed versionId
  const bundles = deployedResources?.configBundles;
  const name = bundleRef.startsWith('arn:') ? undefined : bundleRef;
  if (name && bundles?.[name]) {
    return bundles[name].versionId;
  }

  return versionRef;
}

function resolveGatewayArn(ref: string, deployedResources?: DeployedResourceState): string {
  if (ref.startsWith('arn:')) return ref;

  // Check for placeholder pattern {{gateway:<name>}}
  const placeholderMatch = /^\{\{gateway:(.+)\}\}$/.exec(ref);
  const gwName = placeholderMatch ? placeholderMatch[1] : ref;

  const gateways = deployedResources?.mcp?.gateways;
  if (gateways && gwName && gateways[gwName]) {
    return gateways[gwName].gatewayArn;
  }

  // Check HTTP gateways (imperatively created for A/B testing)
  const httpGateways = deployedResources?.httpGateways;
  if (httpGateways && gwName && httpGateways[gwName]) {
    return httpGateways[gwName].gatewayArn;
  }

  return ref;
}

function resolveEvalConfig(
  config: { onlineEvaluationConfigArn: string },
  deployedResources?: DeployedResourceState
): ABTestEvaluationConfig {
  const ref = config.onlineEvaluationConfigArn;

  if (ref.startsWith('arn:')) return { onlineEvaluationConfigArn: ref };

  // Try to resolve from deployed online eval configs
  const configs = deployedResources?.onlineEvalConfigs;
  if (configs?.[ref]) {
    return { onlineEvaluationConfigArn: configs[ref].onlineEvaluationConfigArn };
  }

  return { onlineEvaluationConfigArn: ref };
}

// ============================================================================
// IAM Role Management
// ============================================================================

/**
 * Generate a project-scoped role name following the CDK pattern:
 * AgentCore-{ProjectName}-ABTest{TestName}-{Hash}
 */
function generateRoleName(projectName: string, testName: string): string {
  // Deterministic hash so retries produce the same role name (avoids orphaned roles)
  const hash = createHash('sha256').update(`${projectName}:${testName}`).digest('hex').slice(0, 8);
  const base = `AgentCore-${projectName}-ABTest${testName}`;
  // IAM role names max 64 chars
  return `${base.slice(0, 55)}-${hash}`;
}

/**
 * Extract role name from ARN: arn:aws:iam::123456789012:role/RoleName → RoleName
 */
function roleNameFromArn(roleArn: string): string {
  const parts = roleArn.split('/');
  return parts[parts.length - 1] ?? roleArn;
}

interface CreateABTestRoleOptions {
  region: string;
  projectName: string;
  testName: string;
  gatewayArn: string;
  onlineEvalConfigArn: string;
}

async function getOrCreateABTestRole(options: CreateABTestRoleOptions): Promise<string> {
  const { region, projectName, testName, gatewayArn, onlineEvalConfigArn } = options;
  const credentials = getCredentialProvider();
  const iamClient = new IAMClient({ region, credentials });

  // Extract account ID from gateway ARN (arn:aws:bedrock-agentcore:REGION:ACCOUNT:gateway/ID)
  const accountId = gatewayArn.split(':')[4] ?? '*';
  // Extract gateway ID for resource scoping
  const gatewayId = gatewayArn.split('/').pop() ?? '*';

  const roleName = generateRoleName(projectName, testName);

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

  let roleArn: string;
  let needsPropagationWait = false;

  try {
    const createResult = await iamClient.send(
      new CreateRoleCommand({
        RoleName: roleName,
        AssumeRolePolicyDocument: trustPolicy,
        Description: `Auto-created execution role for AgentCore AB test: ${testName}`,
        Tags: [
          { Key: 'agentcore:created-by', Value: 'agentcore-cli' },
          { Key: 'agentcore:project-name', Value: projectName },
          { Key: 'agentcore:ab-test-name', Value: testName },
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
      console.log(`IAM role "${roleName}" already exists — reusing it`);
      const existing = await iamClient.send(new GetRoleCommand({ RoleName: roleName }));
      roleArn = existing.Role?.Arn ?? '';
      if (!roleArn) {
        throw new Error(`Role "${roleName}" already exists but ARN could not be retrieved`);
      }
    } else {
      throw err;
    }
  }

  const policy = JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'GatewayRuleStatement',
        Effect: 'Allow',
        Action: [
          'bedrock-agentcore:CreateGatewayRule',
          'bedrock-agentcore:UpdateGatewayRule',
          'bedrock-agentcore:GetGatewayRule',
          'bedrock-agentcore:DeleteGatewayRule',
        ],
        Resource: [`arn:aws:bedrock-agentcore:${region}:${accountId}:gateway/${gatewayId}`],
      },
      {
        Sid: 'GatewayReadStatement',
        Effect: 'Allow',
        Action: ['bedrock-agentcore:GetGateway'],
        Resource: [`arn:aws:bedrock-agentcore:${region}:${accountId}:gateway/${gatewayId}`],
      },
      {
        Sid: 'GatewayListStatement',
        Effect: 'Allow',
        Action: ['bedrock-agentcore:ListGateways'],
        Resource: ['*'],
      },
      {
        Sid: 'OnlineEvaluationConfigStatement',
        Effect: 'Allow',
        Action: ['bedrock-agentcore:GetOnlineEvaluationConfig', 'bedrock-agentcore:UpdateOnlineEvaluationConfig'],
        Resource: [onlineEvalConfigArn],
      },
      {
        Sid: 'ConfigurationBundleReadStatement',
        Effect: 'Allow',
        Action: ['bedrock-agentcore:GetConfigurationBundle', 'bedrock-agentcore:GetConfigurationBundleVersion'],
        Resource: [`arn:aws:bedrock-agentcore:${region}:${accountId}:configuration-bundle/*`],
      },
      {
        Sid: 'CloudWatchLogReadStatement',
        Effect: 'Allow',
        Action: [
          'logs:DescribeLogGroups',
          'logs:StartQuery',
          'logs:GetQueryResults',
          'logs:StopQuery',
          'logs:FilterLogEvents',
          'logs:GetLogEvents',
        ],
        Resource: [
          `arn:aws:logs:${region}:${accountId}:log-group:/aws/bedrock-agentcore/evaluations/*`,
          `arn:aws:logs:${region}:${accountId}:log-group:/aws/bedrock-agentcore/evaluations/*:*`,
          `arn:aws:logs:${region}:${accountId}:log-group:aws/spans`,
          `arn:aws:logs:${region}:${accountId}:log-group:aws/spans:*`,
        ],
      },
      {
        Sid: 'CloudWatchIndexPolicyStatement',
        Effect: 'Allow',
        Action: ['logs:DescribeIndexPolicies', 'logs:PutIndexPolicy'],
        Resource: [
          `arn:aws:logs:${region}:${accountId}:log-group:aws/spans`,
          `arn:aws:logs:${region}:${accountId}:log-group:aws/spans:*`,
        ],
      },
    ],
  });

  // Re-apply the inline policy (idempotent — covers both new and recovered roles)
  await iamClient.send(
    new PutRolePolicyCommand({
      RoleName: roleName,
      PolicyName: AB_TEST_ROLE_POLICY_NAME,
      PolicyDocument: policy,
    })
  );

  if (needsPropagationWait) {
    console.log('Waiting for IAM role propagation (~15s)...');
    await new Promise(resolve => setTimeout(resolve, 15_000));
  }

  return roleArn;
}

async function deleteABTestRole(region: string, roleArn: string): Promise<void> {
  const credentials = getCredentialProvider();
  const iamClient = new IAMClient({ region, credentials });
  const roleName = roleNameFromArn(roleArn);

  try {
    // Must delete inline policies before deleting the role
    await iamClient.send(
      new DeleteRolePolicyCommand({
        RoleName: roleName,
        PolicyName: AB_TEST_ROLE_POLICY_NAME,
      })
    );
  } catch {
    // Policy may not exist
  }

  try {
    await iamClient.send(new DeleteRoleCommand({ RoleName: roleName }));
  } catch {
    // Role may already be deleted or in use — best effort
  }
}
