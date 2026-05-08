import {
  AwsTargetsSchema,
  EnvironmentNameSchema,
  EnvironmentOverridesSchema,
  EnvironmentSchema,
  EnvironmentsSchema,
} from '../aws-targets.js';
import { describe, expect, it } from 'vitest';

const targetA = { name: 'dev-a', account: '111111111111', region: 'us-west-2' as const };
const targetB = { name: 'dev-b', account: '222222222222', region: 'us-east-1' as const };
const targetC = { name: 'prod-a', account: '333333333333', region: 'us-east-1' as const };

describe('EnvironmentNameSchema', () => {
  it('accepts lowercase names with digits and hyphens', () => {
    expect(EnvironmentNameSchema.safeParse('dev').success).toBe(true);
    expect(EnvironmentNameSchema.safeParse('gamma').success).toBe(true);
    expect(EnvironmentNameSchema.safeParse('prod').success).toBe(true);
    expect(EnvironmentNameSchema.safeParse('us-west-2').success).toBe(true);
    expect(EnvironmentNameSchema.safeParse('env1').success).toBe(true);
  });

  it('rejects names that do not match ^[a-z][a-z0-9-]*$', () => {
    expect(EnvironmentNameSchema.safeParse('Prod').success).toBe(false);
    expect(EnvironmentNameSchema.safeParse('1dev').success).toBe(false);
    expect(EnvironmentNameSchema.safeParse('-dev').success).toBe(false);
    expect(EnvironmentNameSchema.safeParse('dev_test').success).toBe(false);
    expect(EnvironmentNameSchema.safeParse('').success).toBe(false);
    expect(EnvironmentNameSchema.safeParse('DEV').success).toBe(false);
  });
});

describe('EnvironmentOverridesSchema', () => {
  it('accepts envVars-only overrides', () => {
    const result = EnvironmentOverridesSchema.safeParse({
      envVars: { LOG_LEVEL: 'DEBUG', STAGE: 'dev' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts an empty overrides object', () => {
    expect(EnvironmentOverridesSchema.safeParse({}).success).toBe(true);
  });

  it('rejects unknown override fields', () => {
    const result = EnvironmentOverridesSchema.safeParse({
      envVars: { A: 'b' },
      iamRoleArn: 'arn-something',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-string envVar values', () => {
    const result = EnvironmentOverridesSchema.safeParse({
      envVars: { LOG_LEVEL: 1 },
    });
    expect(result.success).toBe(false);
  });
});

describe('EnvironmentSchema', () => {
  it('accepts a minimal environment with one target', () => {
    expect(EnvironmentSchema.safeParse({ targets: ['dev-a'] }).success).toBe(true);
  });

  it('accepts an environment with overrides', () => {
    const result = EnvironmentSchema.safeParse({
      targets: ['dev-a', 'dev-b'],
      overrides: { envVars: { LOG_LEVEL: 'DEBUG' } },
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty targets array', () => {
    const result = EnvironmentSchema.safeParse({ targets: [] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some(i => /at least one target/i.test(i.message))).toBe(true);
    }
  });

  it('rejects unknown top-level fields', () => {
    const result = EnvironmentSchema.safeParse({
      targets: ['dev-a'],
      description: 'extra',
    });
    expect(result.success).toBe(false);
  });
});

describe('EnvironmentsSchema', () => {
  it('parses multiple environments', () => {
    const result = EnvironmentsSchema.safeParse({
      dev: { targets: ['dev-a'] },
      gamma: { targets: ['dev-a', 'dev-b'] },
      prod: { targets: ['prod-a'], overrides: { envVars: { LOG_LEVEL: 'INFO' } } },
    });
    expect(result.success).toBe(true);
  });

  it('rejects environments keyed by an invalid name', () => {
    const result = EnvironmentsSchema.safeParse({
      Prod: { targets: ['prod-a'] },
    });
    expect(result.success).toBe(false);
  });
});

describe('AwsTargetsSchema', () => {
  it('parses a config without environments (backward compatible)', () => {
    const result = AwsTargetsSchema.safeParse({
      targets: [targetA, targetB],
    });
    expect(result.success).toBe(true);
  });

  it('parses a config with valid environments', () => {
    const result = AwsTargetsSchema.safeParse({
      targets: [targetA, targetB, targetC],
      environments: {
        dev: { targets: ['dev-a', 'dev-b'] },
        prod: {
          targets: ['prod-a'],
          overrides: { envVars: { LOG_LEVEL: 'INFO' } },
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects an environment that references an unknown target and lists available targets', () => {
    const result = AwsTargetsSchema.safeParse({
      targets: [targetA, targetB],
      environments: {
        dev: { targets: ['dev-a', 'missing'] },
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map(i => i.message).join('\n');
      expect(messages).toMatch(/unknown target "missing"/);
      expect(messages).toMatch(/dev-a/);
      expect(messages).toMatch(/dev-b/);
    }
  });

  it('points the issue at the precise targets-array index for a bad ref', () => {
    const result = AwsTargetsSchema.safeParse({
      targets: [targetA],
      environments: {
        dev: { targets: ['dev-a', 'missing'] },
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(i => i.path.includes('environments'));
      expect(issue?.path).toEqual(['environments', 'dev', 'targets', 1]);
    }
  });

  it('rejects an environment whose targets array is empty', () => {
    const result = AwsTargetsSchema.safeParse({
      targets: [targetA],
      environments: {
        dev: { targets: [] },
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid environment name at the AwsTargets level', () => {
    const result = AwsTargetsSchema.safeParse({
      targets: [targetA],
      environments: {
        Prod: { targets: ['dev-a'] },
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects overrides with unknown fields at the AwsTargets level', () => {
    const result = AwsTargetsSchema.safeParse({
      targets: [targetA],
      environments: {
        dev: {
          targets: ['dev-a'],
          overrides: { envVars: { A: 'b' }, iamRoleArn: 'arn-x' },
        },
      },
    });
    expect(result.success).toBe(false);
  });
});
