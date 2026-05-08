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
  return { valid: true };
}
