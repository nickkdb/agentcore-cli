import type { AgentEnvSpec, AwsDeploymentTarget, Environments } from '../../../../schema';
import { type AwsTargetsInput, mergeOverrides, resolveEnvironment } from '../environment';
import { describe, expect, it } from 'vitest';

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

const environments: Environments = {
  dev: { targets: ['dev-a', 'dev-b'], overrides: { envVars: { LOG_LEVEL: 'DEBUG' } } },
  prod: { targets: ['prod-a'] },
};

const awsTargets: AwsTargetsInput = {
  targets: [targetA, targetB, targetC],
  environments,
};

const agentBase: AgentEnvSpec = {
  name: 'my-agent',
  build: 'Container',
  entrypoint: 'agent.handler' as AgentEnvSpec['entrypoint'],
  codeLocation: './src' as AgentEnvSpec['codeLocation'],
};

describe('resolveEnvironment', () => {
  it('returns targets in declared order with overrides for a valid env', () => {
    const result = resolveEnvironment('dev', awsTargets);
    expect(result.targets).toEqual([targetA, targetB]);
    expect(result.overrides).toEqual({ envVars: { LOG_LEVEL: 'DEBUG' } });
  });

  it('returns undefined overrides when env has none', () => {
    const result = resolveEnvironment('prod', awsTargets);
    expect(result.targets).toEqual([targetC]);
    expect(result.overrides).toBeUndefined();
  });

  it('throws on unknown env name and lists available envs', () => {
    expect(() => resolveEnvironment('staging', awsTargets)).toThrowError(/Unknown environment "staging".*dev.*prod/);
  });

  it('throws when no environments are defined', () => {
    expect(() => resolveEnvironment('dev', { targets: [targetA] })).toThrowError(/No environments are defined/);
  });

  it('throws when environments map is empty', () => {
    expect(() => resolveEnvironment('dev', { targets: [targetA], environments: {} })).toThrowError(
      /No environments are defined/
    );
  });

  it('throws when env references an unknown target (defensive)', () => {
    const broken: AwsTargetsInput = {
      targets: [targetA],
      environments: { dev: { targets: ['dev-a', 'missing'] } },
    };
    expect(() => resolveEnvironment('dev', broken)).toThrowError(/unknown target "missing"/);
  });
});

describe('mergeOverrides', () => {
  it('returns the same agent config when overrides is undefined', () => {
    expect(mergeOverrides(agentBase, undefined)).toBe(agentBase);
  });

  it('returns the same agent config when overrides has no envVars', () => {
    expect(mergeOverrides(agentBase, {})).toBe(agentBase);
  });

  it('returns the same agent config when envVars override map is empty', () => {
    expect(mergeOverrides(agentBase, { envVars: {} })).toBe(agentBase);
  });

  it('appends new envVars when agent has none', () => {
    const result = mergeOverrides(agentBase, { envVars: { LOG_LEVEL: 'DEBUG', STAGE: 'dev' } });
    expect(result.envVars).toEqual([
      { name: 'LOG_LEVEL', value: 'DEBUG' },
      { name: 'STAGE', value: 'dev' },
    ]);
  });

  it('shallow-merges envVars by name (override replaces existing value)', () => {
    const agent: AgentEnvSpec = {
      ...agentBase,
      envVars: [
        { name: 'LOG_LEVEL', value: 'INFO' },
        { name: 'KEEP', value: 'unchanged' },
      ],
    };
    const result = mergeOverrides(agent, { envVars: { LOG_LEVEL: 'DEBUG', NEW: 'added' } });
    expect(result.envVars).toEqual([
      { name: 'LOG_LEVEL', value: 'DEBUG' },
      { name: 'KEEP', value: 'unchanged' },
      { name: 'NEW', value: 'added' },
    ]);
  });

  it('does not mutate the input agent config', () => {
    const agent: AgentEnvSpec = {
      ...agentBase,
      envVars: [{ name: 'LOG_LEVEL', value: 'INFO' }],
    };
    const snapshot = JSON.parse(JSON.stringify(agent));
    mergeOverrides(agent, { envVars: { LOG_LEVEL: 'DEBUG', EXTRA: 'x' } });
    expect(agent).toEqual(snapshot);
  });

  it('does not mutate the overrides input', () => {
    const overrides = { envVars: { LOG_LEVEL: 'DEBUG' } };
    const snapshot = JSON.parse(JSON.stringify(overrides));
    mergeOverrides(agentBase, overrides);
    expect(overrides).toEqual(snapshot);
  });

  it('preserves other agent config fields untouched', () => {
    const agent: AgentEnvSpec = {
      ...agentBase,
      description: 'preserved',
      runtimeVersion: 'python:3.11' as AgentEnvSpec['runtimeVersion'],
    };
    const result = mergeOverrides(agent, { envVars: { A: 'b' } });
    expect(result.name).toBe(agent.name);
    expect(result.description).toBe('preserved');
    expect(result.build).toBe(agent.build);
    expect(result.entrypoint).toBe(agent.entrypoint);
    expect(result.codeLocation).toBe(agent.codeLocation);
  });
});
