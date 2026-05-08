import type { DeployToTargetsOptions } from '../../../operations/deploy/multi-target';
import { handleEnvDeploy } from '../actions';
import { describe, expect, it, vi } from 'vitest';

// Capture every call to deployToTargets so we can assert the orchestrator
// observes the parallel / continueOnError flags forwarded by handleEnvDeploy.
const deployToTargetsMock = vi.fn((_targets: unknown, _options: DeployToTargetsOptions, _fn: unknown) =>
  Promise.resolve({ successes: [], failures: [] })
);

vi.mock('../../../operations/deploy/multi-target', () => ({
  deployToTargets: (targets: unknown, options: DeployToTargetsOptions, fn: unknown) =>
    deployToTargetsMock(targets, options, fn),
}));

// Stub heavy ConfigIO + project operations so we never touch a real project.
vi.mock('../../../../lib', () => ({
  ConfigIO: class {
    readAwsTargetsFull() {
      return Promise.resolve({
        targets: [{ name: 'dev-a', account: '111111111111', region: 'us-west-2' }],
        environments: { dev: { targets: ['dev-a'] } },
      });
    }
    resolveAWSDeploymentTargets() {
      return Promise.resolve([{ name: 'dev-a', account: '111111111111', region: 'us-west-2' }]);
    }
  },
  SecureCredentials: class {},
}));

vi.mock('../../../operations/deploy', () => ({
  bootstrapEnvironment: vi.fn(),
  buildCdkProject: vi.fn(),
  checkBootstrapNeeded: vi.fn(),
  checkStackDeployability: vi.fn(),
  getAllCredentials: () => [],
  hasIdentityApiProviders: () => false,
  hasIdentityOAuthProviders: () => false,
  performStackTeardown: vi.fn(),
  setupApiKeyProviders: vi.fn(),
  setupOAuth2Providers: vi.fn(),
  setupTransactionSearch: vi.fn(),
  synthesizeCdk: vi.fn(),
  validateProject: vi.fn(),
}));

describe('handleEnvDeploy flag forwarding', () => {
  it('forwards parallel + continueOnError to deployToTargets', async () => {
    deployToTargetsMock.mockClear();
    await handleEnvDeploy({
      env: 'dev',
      parallel: true,
      continueOnError: true,
      onLog: () => undefined,
    });
    expect(deployToTargetsMock).toHaveBeenCalledTimes(1);
    const opts = deployToTargetsMock.mock.calls[0]![1];
    expect(opts.environmentName).toBe('dev');
    expect(opts.parallel).toBe(true);
    expect(opts.continueOnError).toBe(true);
  });

  it('defaults parallel + continueOnError to undefined when not provided', async () => {
    deployToTargetsMock.mockClear();
    await handleEnvDeploy({ env: 'dev', onLog: () => undefined });
    expect(deployToTargetsMock).toHaveBeenCalledTimes(1);
    const opts = deployToTargetsMock.mock.calls[0]![1];
    expect(opts.parallel).toBeUndefined();
    expect(opts.continueOnError).toBeUndefined();
  });
});
