import type { AwsDeploymentTarget } from '../../../../schema';
import type { StackInfoFetcher } from '../action';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const targetA: AwsDeploymentTarget = {
  name: 'dev-a',
  account: '111111111111',
  region: 'us-west-2',
};
const targetB: AwsDeploymentTarget = {
  name: 'dev-b',
  account: '222222222222',
  region: 'us-east-1',
};

interface FakePathResolver {
  getAWSTargetsConfigPath(): string;
}

interface FakeConfigIO {
  getPathResolver(): FakePathResolver;
}

function makeFakeConfigIO(awsTargetsPath: string): FakeConfigIO {
  return {
    getPathResolver: () => ({ getAWSTargetsConfigPath: () => awsTargetsPath }),
  };
}

describe('handleEnvStatus', () => {
  let tmpDir: string;
  let awsTargetsPath: string;
  const loadedContext = {
    project: { name: 'proj' } as never,
    awsTargets: [targetA, targetB],
    deployedState: {
      targets: {
        'dev-a': { resources: { stackName: 'stack-dev-a' } },
        'dev-b': { resources: { stackName: 'stack-dev-b' } },
      },
    },
  };

  beforeEach(async () => {
    tmpDir = await mkdir(path.join(os.tmpdir(), `status-env-${Date.now()}-${Math.random().toString(36).slice(2)}`), {
      recursive: true,
    }).then(p => p ?? path.join(os.tmpdir(), `status-env-${Date.now()}`));
    awsTargetsPath = path.join(tmpDir, 'aws-targets.json');
    // Mock loadStatusConfig by wiring a fake ConfigIO with no I/O for project/state.
    vi.doMock('../action', async importOriginal => {
      const actual = await importOriginal<typeof import('../action')>();
      return {
        ...actual,
        loadStatusConfig: vi.fn().mockResolvedValue(loadedContext),
      };
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.doUnmock('../action');
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it('resolves env and returns one row per target with status + last deployed', async () => {
    await writeFile(
      awsTargetsPath,
      JSON.stringify({
        targets: [targetA, targetB],
        environments: { dev: { targets: ['dev-a', 'dev-b'] } },
      })
    );

    const { handleEnvStatus: handleEnvStatusReloaded } = await import('../action');

    const fetchStackInfo: StackInfoFetcher = vi.fn(async (region, stackName) => {
      await Promise.resolve();
      if (stackName === 'stack-dev-a') {
        return { status: 'CREATE_COMPLETE', lastUpdated: new Date('2025-01-01T00:00:00Z') };
      }
      return { status: 'UPDATE_COMPLETE', lastUpdated: new Date('2025-02-02T00:00:00Z') };
    });

    const result = await handleEnvStatusReloaded('dev', {
      configIO: makeFakeConfigIO(awsTargetsPath) as never,
      fetchStackInfo,
    });

    expect(result.success).toBe(true);
    expect(result.envName).toBe('dev');
    expect(result.rows).toEqual([
      {
        target: 'dev-a',
        region: 'us-west-2',
        status: 'CREATE_COMPLETE',
        lastDeployed: '2025-01-01T00:00:00.000Z',
      },
      {
        target: 'dev-b',
        region: 'us-east-1',
        status: 'UPDATE_COMPLETE',
        lastDeployed: '2025-02-02T00:00:00.000Z',
      },
    ]);
    expect(fetchStackInfo).toHaveBeenCalledTimes(2);
    expect(fetchStackInfo).toHaveBeenCalledWith('us-west-2', 'stack-dev-a');
    expect(fetchStackInfo).toHaveBeenCalledWith('us-east-1', 'stack-dev-b');
  });

  it('returns NOT_DEPLOYED row when no stack name is recorded for a target', async () => {
    await writeFile(
      awsTargetsPath,
      JSON.stringify({
        targets: [targetA, targetB],
        environments: { dev: { targets: ['dev-a', 'dev-b'] } },
      })
    );

    // Reload to pick up fresh module mocks for this test file.
    vi.doMock('../action', async importOriginal => {
      const actual = await importOriginal<typeof import('../action')>();
      return {
        ...actual,
        loadStatusConfig: vi.fn().mockResolvedValue({
          ...loadedContext,
          deployedState: { targets: { 'dev-a': { resources: { stackName: 'stack-dev-a' } } } },
        }),
      };
    });
    const { handleEnvStatus: reloaded } = await import('../action');

    const fetchStackInfo: StackInfoFetcher = vi.fn(async () => {
      await Promise.resolve();
      return { status: 'CREATE_COMPLETE', lastUpdated: new Date('2025-01-01T00:00:00Z') };
    });

    const result = await reloaded('dev', {
      configIO: makeFakeConfigIO(awsTargetsPath) as never,
      fetchStackInfo,
    });

    expect(result.success).toBe(true);
    expect(result.rows).toHaveLength(2);
    const devB = result.rows.find(r => r.target === 'dev-b');
    expect(devB?.status).toBe('NOT_DEPLOYED');
    expect(devB?.lastDeployed).toBe('\u2014');
    // Stack info fetcher only called for dev-a.
    expect(fetchStackInfo).toHaveBeenCalledTimes(1);
  });

  it('returns a failure result with the unknown-env error when env does not exist', async () => {
    await writeFile(
      awsTargetsPath,
      JSON.stringify({
        targets: [targetA, targetB],
        environments: { dev: { targets: ['dev-a'] } },
      })
    );
    const { handleEnvStatus: reloaded } = await import('../action');

    const result = await reloaded('staging', {
      configIO: makeFakeConfigIO(awsTargetsPath) as never,
      fetchStackInfo: () => Promise.resolve({}),
    });

    expect(result.success).toBe(false);
    expect(result.rows).toEqual([]);
    expect(result.error).toMatch(/Unknown environment "staging"/);
  });

  it('returns a failure result when aws-targets.json has no environments', async () => {
    // Legacy array shape (no environments).
    await writeFile(awsTargetsPath, JSON.stringify([targetA, targetB]));
    const { handleEnvStatus: reloaded } = await import('../action');

    const result = await reloaded('dev', {
      configIO: makeFakeConfigIO(awsTargetsPath) as never,
      fetchStackInfo: () => Promise.resolve({}),
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No environments are defined/);
  });
});
