/**
 * Resolves a config bundle name to its bundle ID.
 *
 * Fast path: reads deployed-state.json for known bundle IDs.
 * Fallback: calls listConfigurationBundles API to find by name.
 */
import { ConfigIO } from '../../../lib';
import { getConfigurationBundle, listConfigurationBundles } from '../../aws/agentcore-config-bundles';

export interface ResolvedBundle {
  bundleId: string;
  bundleArn?: string;
  versionId?: string;
  region: string;
}

/**
 * Resolve a bundle name to its API identifiers.
 * Tries deployed-state.json first, then falls back to list API.
 */
export async function resolveBundleByName(
  bundleName: string,
  region: string,
  configIO: ConfigIO = new ConfigIO()
): Promise<ResolvedBundle> {
  // Fast path: check deployed state
  const deployedState = await configIO.readDeployedState();
  for (const targetName of Object.keys(deployedState.targets ?? {})) {
    const target = deployedState.targets?.[targetName];
    const bundles = target?.resources?.configBundles;
    const bundle = bundles?.[bundleName];
    if (bundle) {
      return {
        bundleId: bundle.bundleId,
        bundleArn: bundle.bundleArn,
        versionId: bundle.versionId,
        region,
      };
    }
  }

  // Fallback: search via API
  const result = await listConfigurationBundles({ region, maxResults: 100 });
  const match = result.bundles.find(b => b.bundleName === bundleName);
  if (!match) {
    throw new Error(`Configuration bundle "${bundleName}" not found. Has it been deployed?`);
  }

  // Fetch the bundle to get the latest versionId (required by Recommendation API)
  const bundle = await getConfigurationBundle({ region, bundleId: match.bundleId });

  return {
    bundleId: match.bundleId,
    bundleArn: match.bundleArn,
    versionId: bundle.versionId,
    region,
  };
}
