import type { AwsDeploymentTarget } from '../../../../schema';
import { deployToTargets } from '../multi-target';
import { describe, expect, it, vi } from 'vitest';

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
const targetC: AwsDeploymentTarget = {
  name: 'prod-a',
  account: '333333333333',
  region: 'us-east-1',
};

describe('deployToTargets (sequential)', () => {
  it('calls deployFn once per target in declared order', async () => {
    const calls: string[] = [];
    const log = vi.fn();
    const deployFn = vi.fn(async (target: AwsDeploymentTarget) => {
      await Promise.resolve();
      calls.push(target.name);
      return `ok-${target.name}`;
    });

    const result = await deployToTargets([targetA, targetB, targetC], { environmentName: 'dev', log }, deployFn);

    expect(calls).toEqual(['dev-a', 'dev-b', 'prod-a']);
    expect(deployFn).toHaveBeenCalledTimes(3);
    expect(result.successes.map(s => s.target.name)).toEqual(['dev-a', 'dev-b', 'prod-a']);
    expect(result.successes.map(s => s.value)).toEqual(['ok-dev-a', 'ok-dev-b', 'ok-prod-a']);
    expect(result.failures).toEqual([]);
  });

  it('emits progress lines in the documented format', async () => {
    const lines: string[] = [];
    await deployToTargets([targetA, targetB], { environmentName: 'dev', log: line => lines.push(line) }, () =>
      Promise.resolve()
    );

    expect(lines[0]).toBe('[1/2] Deploying to dev-a (us-west-2)...');
    expect(lines[1]).toBe('[2/2] Deploying to dev-b (us-east-1)...');
  });

  it('emits success summary when all targets succeed', async () => {
    const lines: string[] = [];
    await deployToTargets([targetA, targetB], { environmentName: 'dev', log: line => lines.push(line) }, () =>
      Promise.resolve()
    );

    expect(lines[lines.length - 1]).toBe('\u2713 Environment "dev" deployed (2/2 targets)');
  });

  it('stops on first failure (fail-fast) and records the failure', async () => {
    const calls: string[] = [];
    const lines: string[] = [];
    const boom = new Error('cdk failed');
    const deployFn = vi.fn(async (target: AwsDeploymentTarget) => {
      await Promise.resolve();
      calls.push(target.name);
      if (target.name === 'dev-b') throw boom;
      return undefined;
    });

    const result = await deployToTargets(
      [targetA, targetB, targetC],
      { environmentName: 'dev', log: line => lines.push(line) },
      deployFn
    );

    expect(calls).toEqual(['dev-a', 'dev-b']);
    expect(deployFn).toHaveBeenCalledTimes(2);
    expect(result.successes.map(s => s.target.name)).toEqual(['dev-a']);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.target.name).toBe('dev-b');
    expect(result.failures[0]!.error).toBe(boom);
    // No success summary line when we bailed out.
    expect(lines.find(l => l.startsWith('\u2713 Environment'))).toBeUndefined();
  });

  it('returns empty result and emits summary when targets array is empty', async () => {
    const lines: string[] = [];
    const deployFn = vi.fn(() => Promise.resolve());

    const result = await deployToTargets([], { environmentName: 'dev', log: line => lines.push(line) }, deployFn);

    expect(deployFn).not.toHaveBeenCalled();
    expect(result.successes).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(lines).toEqual(['\u2713 Environment "dev" deployed (0/0 targets)']);
  });

  it('passes the zero-based index to deployFn', async () => {
    const indexes: number[] = [];
    await deployToTargets([targetA, targetB, targetC], { environmentName: 'dev', log: () => undefined }, (_t, idx) => {
      indexes.push(idx);
      return Promise.resolve();
    });
    expect(indexes).toEqual([0, 1, 2]);
  });
});
