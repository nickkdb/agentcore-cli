import { configBundlePrimitive } from '../../primitives/registry';
import { useCallback, useState } from 'react';

interface EditConfigBundleConfig {
  bundleName: string;
  components: Record<string, { configuration: Record<string, unknown> }>;
  branchName?: string;
  commitMessage?: string;
}

export function useEditConfigBundle() {
  const [status, setStatus] = useState<{ state: 'idle' | 'loading' | 'success' | 'error'; error?: string }>({
    state: 'idle',
  });

  const editConfigBundle = useCallback(async (config: EditConfigBundleConfig) => {
    setStatus({ state: 'loading' });
    try {
      const result = await configBundlePrimitive.edit({
        bundleName: config.bundleName,
        components: config.components,
        branchName: config.branchName,
        commitMessage: config.commitMessage,
      });
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to edit configuration bundle');
      }
      setStatus({ state: 'success' });
      return { ok: true as const, bundleName: config.bundleName };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to edit configuration bundle.';
      setStatus({ state: 'error', error: message });
      return { ok: false as const, error: message };
    }
  }, []);

  const reset = useCallback(() => {
    setStatus({ state: 'idle' });
  }, []);

  return { status, editConfigBundle, reset };
}
