import type { AgentCoreProjectSpec, ConfigBundleDeployedState } from '../../../schema';
import {
  createConfigurationBundle,
  deleteConfigurationBundle,
  listConfigurationBundles,
  updateConfigurationBundle,
} from '../../aws/agentcore-config-bundles';
import type { ComponentConfigurationMap } from '../../aws/agentcore-config-bundles';

// ============================================================================
// Types
// ============================================================================

export interface SetupConfigBundlesOptions {
  region: string;
  projectSpec: AgentCoreProjectSpec;
  /** Existing config bundle deployed state (from deployed-state.json) */
  existingBundles?: Record<string, ConfigBundleDeployedState>;
}

export interface ConfigBundleSetupResult {
  bundleName: string;
  status: 'created' | 'updated' | 'deleted' | 'skipped' | 'error';
  bundleId?: string;
  bundleArn?: string;
  versionId?: string;
  error?: string;
}

export interface SetupConfigBundlesResult {
  results: ConfigBundleSetupResult[];
  /** Deployed state entries for config bundles (to merge into deployed-state.json) */
  configBundles: Record<string, ConfigBundleDeployedState>;
  hasErrors: boolean;
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Create, update, or delete configuration bundles post-deploy.
 *
 * Pattern:
 * 1. For each configBundle in project spec → create or update
 * 2. For each bundle in deployed-state but NOT in project spec → delete (reconciliation)
 * 3. Return updated deployed state entries
 */
export async function setupConfigBundles(options: SetupConfigBundlesOptions): Promise<SetupConfigBundlesResult> {
  const { region, projectSpec, existingBundles } = options;
  const results: ConfigBundleSetupResult[] = [];
  const configBundles: Record<string, ConfigBundleDeployedState> = {};

  const specBundleNames = new Set(projectSpec.configBundles.map(b => b.name));

  // Create or update bundles from the spec
  for (const bundleSpec of projectSpec.configBundles) {
    try {
      const existingBundle = existingBundles?.[bundleSpec.name];

      if (existingBundle) {
        // Update existing bundle (creates a new version)
        const result = await updateConfigurationBundle({
          region,
          bundleId: existingBundle.bundleId,
          description: bundleSpec.description,
          components: bundleSpec.components as ComponentConfigurationMap,
          branchName: bundleSpec.branchName,
          commitMessage: bundleSpec.commitMessage,
        });

        configBundles[bundleSpec.name] = {
          bundleId: result.bundleId,
          bundleArn: result.bundleArn,
          versionId: result.versionId,
        };

        results.push({
          bundleName: bundleSpec.name,
          status: 'updated',
          bundleId: result.bundleId,
          bundleArn: result.bundleArn,
          versionId: result.versionId,
        });
      } else {
        // Try to find by name via list (handles re-creation after state loss)
        const existingByName = await findBundleByName(region, bundleSpec.name);

        if (existingByName) {
          // Update the existing one and track it
          const result = await updateConfigurationBundle({
            region,
            bundleId: existingByName.bundleId,
            description: bundleSpec.description,
            components: bundleSpec.components as ComponentConfigurationMap,
            branchName: bundleSpec.branchName,
            commitMessage: bundleSpec.commitMessage,
          });

          configBundles[bundleSpec.name] = {
            bundleId: result.bundleId,
            bundleArn: result.bundleArn,
            versionId: result.versionId,
          };

          results.push({
            bundleName: bundleSpec.name,
            status: 'updated',
            bundleId: result.bundleId,
            bundleArn: result.bundleArn,
            versionId: result.versionId,
          });
        } else {
          // Create new
          const result = await createConfigurationBundle({
            region,
            bundleName: bundleSpec.name,
            description: bundleSpec.description,
            components: bundleSpec.components as ComponentConfigurationMap,
            branchName: bundleSpec.branchName,
            commitMessage: bundleSpec.commitMessage,
          });

          configBundles[bundleSpec.name] = {
            bundleId: result.bundleId,
            bundleArn: result.bundleArn,
            versionId: result.versionId,
          };

          results.push({
            bundleName: bundleSpec.name,
            status: 'created',
            bundleId: result.bundleId,
            bundleArn: result.bundleArn,
            versionId: result.versionId,
          });
        }
      }
    } catch (err) {
      results.push({
        bundleName: bundleSpec.name,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Delete orphaned bundles (in deployed-state but removed from spec)
  if (existingBundles) {
    for (const [bundleName, bundleState] of Object.entries(existingBundles)) {
      if (!specBundleNames.has(bundleName)) {
        try {
          const deleteResult = await deleteConfigurationBundle({
            region,
            bundleId: bundleState.bundleId,
          });

          results.push({
            bundleName,
            status: deleteResult.success ? 'deleted' : 'error',
            error: deleteResult.error,
          });
        } catch (err) {
          results.push({
            bundleName,
            status: 'error',
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }

  return {
    results,
    configBundles,
    hasErrors: results.some(r => r.status === 'error'),
  };
}

// ============================================================================
// Helpers
// ============================================================================

async function findBundleByName(region: string, bundleName: string): Promise<{ bundleId: string } | undefined> {
  try {
    const result = await listConfigurationBundles({ region, maxResults: 100 });
    return result.bundles.find(b => b.bundleName === bundleName);
  } catch {
    return undefined;
  }
}
