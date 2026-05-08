import type { DeployOptions } from './types';

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function validateDeployOptions(options: DeployOptions): ValidationResult {
  if (options.env && options.target) {
    return {
      valid: false,
      error: 'Cannot use --env and --target together. Pick one.',
    };
  }
  if (options.parallel && !options.env) {
    return {
      valid: false,
      error: '--parallel requires --env. Specify an environment to deploy in parallel.',
    };
  }
  if (options.continueOnError && !options.env) {
    return {
      valid: false,
      error: '--continue-on-error requires --env. Specify an environment to deploy.',
    };
  }
  return { valid: true };
}
