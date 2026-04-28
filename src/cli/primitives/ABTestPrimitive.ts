import { findConfigRoot } from '../../lib';
import type { ABTest } from '../../schema/schemas/primitives/ab-test';
import { ABTestSchema } from '../../schema/schemas/primitives/ab-test';
import { getErrorMessage } from '../errors';
import type { RemovalPreview, RemovalResult, SchemaChange } from '../operations/remove/types';
import { BasePrimitive } from './BasePrimitive';
import type { AddResult, AddScreenComponent, RemovableResource } from './types';
import type { Command } from '@commander-js/extra-typings';

export type GatewayChoice = { type: 'create-new' } | { type: 'existing-http'; name: string };

export interface AddABTestOptions {
  name: string;
  description?: string;
  agent: string;
  gatewayChoice?: GatewayChoice;
  roleArn?: string;
  controlBundle: string;
  controlVersion: string;
  treatmentBundle: string;
  treatmentVersion: string;
  controlWeight: number;
  treatmentWeight: number;
  onlineEval: string;
  trafficHeaderName?: string;
  maxDurationDays?: number;
  enableOnCreate?: boolean;
}

export type RemovableABTest = RemovableResource;

/**
 * ABTestPrimitive handles all A/B test add/remove operations.
 *
 * A/B tests split traffic between two config bundle versions (control vs
 * treatment) through a gateway, with online evaluation tracking performance.
 * They are created via direct API calls (not CloudFormation) and stored in
 * agentcore.json for lifecycle management.
 */
export class ABTestPrimitive extends BasePrimitive<AddABTestOptions, RemovableABTest> {
  readonly kind = 'ab-test' as const;
  readonly label = 'AB Test';
  override readonly article = 'an';
  readonly primitiveSchema = ABTestSchema;

  async add(options: AddABTestOptions): Promise<AddResult<{ abTestName: string }>> {
    try {
      const abTest = await this.createABTest(options);
      return { success: true, abTestName: abTest.name };
    } catch (err) {
      return { success: false, error: getErrorMessage(err) };
    }
  }

  async remove(testName: string): Promise<RemovalResult> {
    try {
      const project = await this.readProjectSpec();

      const index = project.abTests.findIndex(t => t.name === testName);
      if (index === -1) {
        return { success: false, error: `AB test "${testName}" not found.` };
      }

      const removedTest = project.abTests[index]!;
      project.abTests.splice(index, 1);

      // Cascade: remove orphaned HTTP gateway
      if (removedTest?.gatewayRef) {
        const gwMatch = /^\{\{gateway:(.+)\}\}$/.exec(removedTest.gatewayRef);
        if (gwMatch) {
          const gwName = gwMatch[1];
          const stillReferenced = project.abTests.some(t => {
            const m = /^\{\{gateway:(.+)\}\}$/.exec(t.gatewayRef);
            return m && m[1] === gwName;
          });
          if (!stillReferenced) {
            const gwIndex = project.httpGateways.findIndex(gw => gw.name === gwName);
            if (gwIndex !== -1) {
              project.httpGateways.splice(gwIndex, 1);
            }
          }
        }
      }

      await this.writeProjectSpec(project);

      return { success: true };
    } catch (err) {
      return { success: false, error: getErrorMessage(err) };
    }
  }

  async previewRemove(testName: string): Promise<RemovalPreview> {
    const project = await this.readProjectSpec();

    const abTest = project.abTests.find(t => t.name === testName);
    if (!abTest) {
      throw new Error(`AB test "${testName}" not found.`);
    }

    const summary: string[] = [`Removing AB test: ${testName}`];
    const schemaChanges: SchemaChange[] = [];

    const testIndex = project.abTests.findIndex(t => t.name === testName);
    const afterSpec = {
      ...project,
      abTests: project.abTests.filter(t => t.name !== testName),
      httpGateways: [...project.httpGateways],
    };

    // Check if the gateway would be orphaned
    const test = project.abTests[testIndex];
    if (test?.gatewayRef) {
      const gwMatch = /^\{\{gateway:(.+)\}\}$/.exec(test.gatewayRef);
      if (gwMatch) {
        const gwName = gwMatch[1];
        const otherTests = project.abTests.filter((_, i) => i !== testIndex);
        const stillReferenced = otherTests.some(t => {
          const m = /^\{\{gateway:(.+)\}\}$/.exec(t.gatewayRef);
          return m && m[1] === gwName;
        });
        if (!stillReferenced) {
          summary.push(`Also removing HTTP gateway: ${gwName} (no other AB tests reference it)`);
          afterSpec.httpGateways = project.httpGateways.filter(gw => gw.name !== gwName);
        }
      }
    }

    schemaChanges.push({
      file: 'agentcore/agentcore.json',
      before: project,
      after: afterSpec,
    });

    return { summary, directoriesToDelete: [], schemaChanges };
  }

  async getRemovable(): Promise<RemovableABTest[]> {
    try {
      const project = await this.readProjectSpec();
      return project.abTests.map(t => ({ name: t.name }));
    } catch {
      return [];
    }
  }

  async getAllNames(): Promise<string[]> {
    try {
      const project = await this.readProjectSpec();
      return project.abTests.map(t => t.name);
    } catch {
      return [];
    }
  }

  registerCommands(addCmd: Command, removeCmd: Command): void {
    addCmd
      .command('ab-test')
      .description('[preview] Add an A/B test to the project')
      .option('--name <name>', 'AB test name')
      .option('--description <text>', 'AB test description')
      .option('--runtime <name>', 'Runtime agent to A/B test')
      .option('--role-arn <arn>', 'IAM role ARN for the AB test (auto-created if not provided)')
      .option('--control-bundle <name>', 'Control variant config bundle name or ARN')
      .option('--control-version <id>', 'Control variant config bundle version')
      .option('--treatment-bundle <name>', 'Treatment variant config bundle name or ARN')
      .option('--treatment-version <id>', 'Treatment variant config bundle version')
      .option('--control-weight <n>', 'Traffic weight for control (1-100)', parseInt)
      .option('--treatment-weight <n>', 'Traffic weight for treatment (1-100)', parseInt)
      .option('--gateway <name>', 'Use an existing HTTP gateway (skips auto-creation and --runtime)')
      .option('--online-eval <name>', 'Online evaluation config name (resolved from project)')
      .option('--traffic-header <name>', 'Header name for traffic routing')
      // TODO(post-preview): Re-enable --max-duration once configurable duration is launched.
      // .option('--max-duration <days>', 'Maximum duration in days (1-90)', parseInt)
      .option('--enable', 'Enable the AB test on creation')
      .option('--json', 'Output as JSON')
      .action(
        async (cliOptions: {
          name?: string;
          description?: string;
          runtime?: string;
          gateway?: string;
          roleArn?: string;
          controlBundle?: string;
          controlVersion?: string;
          treatmentBundle?: string;
          treatmentVersion?: string;
          controlWeight?: number;
          treatmentWeight?: number;
          onlineEval?: string;
          trafficHeader?: string;
          maxDuration?: number;
          enable?: boolean;
          json?: boolean;
        }) => {
          try {
            if (!findConfigRoot()) {
              console.error('No agentcore project found. Run `agentcore create` first.');
              process.exit(1);
            }

            if (cliOptions.name || cliOptions.json) {
              const fail = (error: string) => {
                if (cliOptions.json) {
                  console.log(JSON.stringify({ success: false, error }));
                } else {
                  console.error(error);
                }
                process.exit(1);
              };

              if (!cliOptions.name) fail('--name is required');
              if (!cliOptions.gateway && !cliOptions.runtime)
                fail('--runtime is required (unless --gateway is provided)');
              if (!cliOptions.controlBundle) fail('--control-bundle is required');
              if (!cliOptions.controlVersion) fail('--control-version is required');
              if (!cliOptions.treatmentBundle) fail('--treatment-bundle is required');
              if (!cliOptions.treatmentVersion) fail('--treatment-version is required');
              if (cliOptions.controlWeight === undefined) fail('--control-weight is required');
              if (cliOptions.treatmentWeight === undefined) fail('--treatment-weight is required');
              if (!cliOptions.onlineEval) fail('--online-eval is required');

              const result = await this.add({
                name: cliOptions.name!,
                description: cliOptions.description,
                agent: cliOptions.runtime ?? '',
                gatewayChoice: cliOptions.gateway
                  ? { type: 'existing-http', name: cliOptions.gateway }
                  : { type: 'create-new' },
                roleArn: cliOptions.roleArn!,
                controlBundle: cliOptions.controlBundle!,
                controlVersion: cliOptions.controlVersion!,
                treatmentBundle: cliOptions.treatmentBundle!,
                treatmentVersion: cliOptions.treatmentVersion!,
                controlWeight: cliOptions.controlWeight!,
                treatmentWeight: cliOptions.treatmentWeight!,
                onlineEval: cliOptions.onlineEval!,
                trafficHeaderName: cliOptions.trafficHeader,
                maxDurationDays: cliOptions.maxDuration,
                enableOnCreate: cliOptions.enable,
              });

              if (cliOptions.json) {
                console.log(JSON.stringify(result));
              } else if (result.success) {
                console.log(`Added AB test '${result.abTestName}'`);
              } else {
                console.error(result.error);
              }
              process.exit(result.success ? 0 : 1);
            } else {
              // TUI fallback
              const [{ render }, { default: React }, { AddFlow }] = await Promise.all([
                import('ink'),
                import('react'),
                import('../tui/screens/add/AddFlow'),
              ]);
              const { clear, unmount } = render(
                React.createElement(AddFlow, {
                  isInteractive: false,
                  onExit: () => {
                    clear();
                    unmount();
                    process.exit(0);
                  },
                })
              );
            }
          } catch (error) {
            if (cliOptions.json) {
              console.log(JSON.stringify({ success: false, error: getErrorMessage(error) }));
            } else {
              console.error(getErrorMessage(error));
            }
            process.exit(1);
          }
        }
      );

    this.registerRemoveSubcommand(removeCmd);
  }

  addScreen(): AddScreenComponent {
    return null;
  }

  private async createABTest(options: AddABTestOptions): Promise<ABTest> {
    const project = await this.readProjectSpec();

    this.checkDuplicate(project.abTests, options.name);

    // Resolve gateway reference based on the user's choice
    let gatewayRef: string;
    const choice = options.gatewayChoice ?? { type: 'create-new' };

    if (choice.type === 'existing-http') {
      // Reuse an existing HTTP gateway from the project spec
      const existing = project.httpGateways.find(gw => gw.name === choice.name);
      if (!existing) {
        throw new Error(`HTTP gateway "${choice.name}" not found in project.`);
      }
      gatewayRef = `{{gateway:${choice.name}}}`;
    } else {
      // Create new HTTP gateway — truncate name to fit 48-char limit
      const httpGwName = `${options.name.replace(/_/g, '-').slice(0, 44)}-gw`;
      const existingGw = project.httpGateways.find(gw => gw.name === httpGwName);
      if (existingGw) {
        if (existingGw.runtimeRef !== options.agent) {
          throw new Error(
            `HTTP gateway "${httpGwName}" already exists with a different runtime (${existingGw.runtimeRef}). ` +
              `Choose a different AB test name to avoid a gateway name collision.`
          );
        }
      } else {
        project.httpGateways.push({
          name: httpGwName,
          runtimeRef: options.agent,
        });
      }
      gatewayRef = `{{gateway:${httpGwName}}}`;
    }

    const abTest: ABTest = {
      name: options.name,
      ...(options.description && { description: options.description }),
      gatewayRef,
      ...(options.roleArn && { roleArn: options.roleArn }),
      variants: [
        {
          name: 'C',
          weight: options.controlWeight,
          variantConfiguration: {
            configurationBundle: {
              bundleArn: options.controlBundle,
              bundleVersion: options.controlVersion,
            },
          },
        },
        {
          name: 'T1',
          weight: options.treatmentWeight,
          variantConfiguration: {
            configurationBundle: {
              bundleArn: options.treatmentBundle,
              bundleVersion: options.treatmentVersion,
            },
          },
        },
      ],
      evaluationConfig: {
        onlineEvaluationConfigArn: options.onlineEval,
      },
      ...(options.trafficHeaderName && {
        trafficAllocationConfig: { routeOnHeader: { headerName: options.trafficHeaderName } },
      }),
      ...(options.maxDurationDays !== undefined && { maxDurationDays: options.maxDurationDays }),
      ...(options.enableOnCreate !== undefined && { enableOnCreate: options.enableOnCreate }),
    };

    project.abTests.push(abTest);
    await this.writeProjectSpec(project);

    return abTest;
  }
}
