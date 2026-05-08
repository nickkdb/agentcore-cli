import { validateDeployOptions } from '../validate.js';
import { describe, expect, it } from 'vitest';

describe('validateDeployOptions', () => {
  it('returns valid with no options', () => {
    expect(validateDeployOptions({})).toEqual({ valid: true });
  });

  it('returns valid with all non-conflicting options set', () => {
    expect(validateDeployOptions({ target: 'prod', yes: true, verbose: true, json: true })).toEqual({ valid: true });
  });

  it('returns valid with target only', () => {
    expect(validateDeployOptions({ target: 'default' })).toEqual({ valid: true });
  });

  it('returns valid with --env only', () => {
    expect(validateDeployOptions({ env: 'dev' })).toEqual({ valid: true });
  });

  it('rejects --env and --target used together with a clear error', () => {
    const result = validateDeployOptions({ env: 'dev', target: 'prod' });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/--env.*--target/);
  });
});
