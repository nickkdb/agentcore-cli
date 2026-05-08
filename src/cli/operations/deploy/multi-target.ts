import type { AwsDeploymentTarget } from '../../../schema';

export interface DeployToTargetsOptions {
  /** Environment name used in progress / summary output. */
  environmentName: string;
  /** Sink for progress + summary lines. Defaults to `console.log`. */
  log?: (line: string) => void;
}

export interface TargetDeployResult {
  target: AwsDeploymentTarget;
  /** Result returned by the deployFn on success. */
  value?: unknown;
  /** Error caught from a failing deployFn. */
  error?: unknown;
}

export interface DeployToTargetsResult {
  successes: TargetDeployResult[];
  failures: TargetDeployResult[];
}

export type TargetDeployFn = (target: AwsDeploymentTarget, index: number) => Promise<unknown>;

/**
 * Run `deployFn` per target sequentially, fail-fast on first error.
 *
 * Parallel and continue-on-error paths are layered on in T9.
 */
export async function deployToTargets(
  targets: AwsDeploymentTarget[],
  options: DeployToTargetsOptions,
  deployFn: TargetDeployFn
): Promise<DeployToTargetsResult> {
  const log = options.log ?? ((line: string) => console.log(line));
  const successes: TargetDeployResult[] = [];
  const failures: TargetDeployResult[] = [];

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i]!;
    log(`[${i + 1}/${targets.length}] Deploying to ${target.name} (${target.region})...`);
    try {
      const value = await deployFn(target, i);
      successes.push({ target, value });
    } catch (error) {
      failures.push({ target, error });
      // Fail-fast: stop iterating on first error.
      return { successes, failures };
    }
  }

  log(`\u2713 Environment "${options.environmentName}" deployed (${successes.length}/${targets.length} targets)`);
  return { successes, failures };
}
