export interface DeployOptions {
  target?: string;
  env?: string;
  parallel?: boolean;
  continueOnError?: boolean;
  yes?: boolean;
  progress?: boolean;
  verbose?: boolean;
  json?: boolean;
  plan?: boolean;
  diff?: boolean;
}

export interface DeployResult {
  success: boolean;
  targetName?: string;
  stackName?: string;
  outputs?: Record<string, string>;
  logPath?: string;
  nextSteps?: string[];
  notes?: string[];
  postDeployWarnings?: string[];
  error?: string;
}

export interface PreflightResult {
  success: boolean;
  stackNames?: string[];
  needsBootstrap?: boolean;
  error?: string;
}
