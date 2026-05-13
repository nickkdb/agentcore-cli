import type { Result } from '../../../lib/result';

export interface DeployOptions {
  target?: string;
  yes?: boolean;
  progress?: boolean;
  verbose?: boolean;
  json?: boolean;
  plan?: boolean;
  diff?: boolean;
}

export type DeployResult = Result<{
  targetName?: string;
  stackName?: string;
  outputs?: Record<string, string>;
  nextSteps?: string[];
  notes?: string[];
  postDeployWarnings?: string[];
<<<<<<< HEAD
  error?: string;
}
=======
}> & { logPath?: string };
>>>>>>> origin/main

export type PreflightResult = Result<{
  stackNames?: string[];
  needsBootstrap?: boolean;
}>;
