import type { AwsDeploymentTarget } from '../../../schema';

export interface DeployToTargetsOptions {
  /** Environment name used in progress / summary output. */
  environmentName: string;
  /** Run targets concurrently via Promise.allSettled. */
  parallel?: boolean;
  /** In sequential mode, keep going past per-target failures. Ignored in parallel mode (allSettled already does this). */
  continueOnError?: boolean;
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

const SUCCESS_MARK = '\u2713';
const FAILURE_MARK = '\u2717';

/**
 * Run `deployFn` per target with one of three execution policies:
 *  - default (sequential, fail-fast): stop on first error.
 *  - `continueOnError` (sequential): catch per-target errors and keep going.
 *  - `parallel`: launch all in flight via Promise.allSettled; one failure
 *    does not cancel the rest.
 *
 * The orchestrator never throws; it always resolves with a summary aggregate
 * so callers can decide on exit code (0 if `failures.length === 0`, else 1).
 */
export async function deployToTargets(
  targets: AwsDeploymentTarget[],
  options: DeployToTargetsOptions,
  deployFn: TargetDeployFn
): Promise<DeployToTargetsResult> {
  const log = options.log ?? ((line: string) => console.log(line));
  const successes: TargetDeployResult[] = [];
  const failures: TargetDeployResult[] = [];

  if (options.parallel) {
    targets.forEach((target, i) => {
      log(`[${i + 1}/${targets.length}] Deploying to ${target.name} (${target.region})...`);
    });
    const settled = await Promise.allSettled(targets.map((target, i) => deployFn(target, i)));
    settled.forEach((result, i) => {
      const target = targets[i]!;
      if (result.status === 'fulfilled') {
        successes.push({ target, value: result.value });
      } else {
        failures.push({ target, error: result.reason });
      }
    });
  } else {
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i]!;
      log(`[${i + 1}/${targets.length}] Deploying to ${target.name} (${target.region})...`);
      try {
        const value = await deployFn(target, i);
        successes.push({ target, value });
      } catch (error) {
        failures.push({ target, error });
        if (!options.continueOnError) {
          // Fail-fast: stop iterating on first error.
          emitSummary(log, options.environmentName, targets.length, successes, failures);
          return { successes, failures };
        }
      }
    }
  }

  emitSummary(log, options.environmentName, targets.length, successes, failures);
  return { successes, failures };
}

function emitSummary(
  log: (line: string) => void,
  environmentName: string,
  totalCount: number,
  successes: TargetDeployResult[],
  failures: TargetDeployResult[]
): void {
  if (failures.length === 0) {
    log(`${SUCCESS_MARK} Environment "${environmentName}" deployed (${successes.length}/${totalCount} targets)`);
    return;
  }

  log(
    `${FAILURE_MARK} Environment "${environmentName}" deploy had ${failures.length} failure(s) (${successes.length}/${totalCount} succeeded)`
  );
  log('Failed targets:');
  for (const failure of failures) {
    const reason = errorMessage(failure.error);
    log(`  - ${failure.target.name} (${failure.target.region}): ${reason}`);
  }
  log(`Run \`agentcore status --env ${environmentName}\` to inspect deployed state.`);
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
