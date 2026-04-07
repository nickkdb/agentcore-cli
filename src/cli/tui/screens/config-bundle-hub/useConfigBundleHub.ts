/**
 * Hook for the Config Bundle Hub — fetches deployed bundles
 * and enriches them with version counts.
 */
import type {
  ConfigurationBundleSummary,
  ConfigurationBundleVersionSummary,
} from '../../../../cli/aws/agentcore-config-bundles';
import {
  listConfigurationBundleVersions,
  listConfigurationBundles,
} from '../../../../cli/aws/agentcore-config-bundles';
import { ConfigIO } from '../../../../lib';
import { useEffect, useRef, useState } from 'react';

export interface BundleWithMeta extends ConfigurationBundleSummary {
  versionCount: number;
  branches: string[];
  lastUpdated?: string;
}

export interface ConfigBundleHubState {
  bundles: BundleWithMeta[];
  isLoading: boolean;
  error?: string;
  region: string;
}

export function useConfigBundleHub(): ConfigBundleHubState {
  const [bundles, setBundles] = useState<BundleWithMeta[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [region, setRegion] = useState('us-east-1');
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    async function load() {
      setIsLoading(true);
      setError(undefined);
      try {
        const configIO = new ConfigIO();
        const targets = await configIO.resolveAWSDeploymentTargets();
        if (targets.length === 0) {
          if (mountedRef.current) {
            setError('No AWS deployment targets configured.');
            setIsLoading(false);
          }
          return;
        }
        const resolvedRegion = targets[0]!.region;
        if (mountedRef.current) setRegion(resolvedRegion);

        const result = await listConfigurationBundles({ region: resolvedRegion, maxResults: 100 });

        // Enrich each bundle with version metadata
        const enriched = await Promise.all(
          result.bundles.map(async (bundle): Promise<BundleWithMeta> => {
            try {
              const versions = await listConfigurationBundleVersions({
                region: resolvedRegion,
                bundleId: bundle.bundleId,
                maxResults: 50,
              });
              const branchSet = new Set<string>();
              let latestTs = '';
              for (const v of versions.versions) {
                if (v.lineageMetadata?.branchName) branchSet.add(v.lineageMetadata.branchName);
                if (v.versionCreatedAt > latestTs) latestTs = v.versionCreatedAt;
              }
              return {
                ...bundle,
                versionCount: versions.versions.length,
                branches: [...branchSet],
                lastUpdated: latestTs || undefined,
              };
            } catch {
              return { ...bundle, versionCount: 0, branches: [] };
            }
          })
        );

        if (mountedRef.current) {
          setBundles(enriched);
          setIsLoading(false);
        }
      } catch (err) {
        if (mountedRef.current) {
          setError(err instanceof Error ? err.message : String(err));
          setIsLoading(false);
        }
      }
    }

    void load();
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return { bundles, isLoading, error, region };
}

export function useVersionHistory(bundleId: string, region: string) {
  const [versions, setVersions] = useState<ConfigurationBundleVersionSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    async function load() {
      setIsLoading(true);
      setError(undefined);
      try {
        const allVersions: ConfigurationBundleVersionSummary[] = [];
        let nextToken: string | undefined;
        do {
          const result = await listConfigurationBundleVersions({
            region,
            bundleId,
            maxResults: 50,
            nextToken,
          });
          allVersions.push(...result.versions);
          nextToken = result.nextToken;
        } while (nextToken);

        allVersions.sort((a, b) => Number(b.versionCreatedAt) - Number(a.versionCreatedAt));
        setVersions(allVersions);
        setIsLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setIsLoading(false);
      }
    }

    void load();
  }, [bundleId, region]);

  return { versions, isLoading, error };
}
