<<<<<<< HEAD
=======
import type { Result } from '../../lib/result';
>>>>>>> origin/main
import { getErrorMessage } from '../errors';
import { TelemetryClientAccessor } from './client-accessor.js';
import type { Command, CommandAttrs } from './schemas/command-run.js';

<<<<<<< HEAD
// TODO: Replace with a generic Result<D, E> type that preserves the original error object.
export type OperationResult = { success: true } | { success: false; error: string };
=======
export type OperationResult = Result;
>>>>>>> origin/main

async function getTelemetryClient() {
  try {
    return await TelemetryClientAccessor.get();
  } catch {
    return undefined;
  }
}

/**
 * Record telemetry for an operation and return its result.
 * Use in TUI hooks and CLI paths where the caller handles output and control flow.
 *
 * If the callback returns a failure result, telemetry is recorded and the result
 * is returned to the caller. If the callback throws, telemetry is recorded and
 * the exception propagates. If telemetry is unavailable, the callback runs untracked.
 */
export async function withCommandRunTelemetry<C extends Command, R extends OperationResult>(
  command: C,
  attrs: CommandAttrs<C>,
  fn: () => Promise<R>
): Promise<R> {
  const client = await getTelemetryClient();
  if (!client) return fn();

  let result: R | undefined;
  try {
<<<<<<< HEAD
    await client.withCommandRun(command, async () => {
      result = await fn();
      if (!result.success) throw new Error(result.error);
      return attrs;
    });
=======
    await client.withCommandRun(
      command,
      async () => {
        result = await fn();
        if (!result.success) throw result.error;
        return attrs;
      },
      attrs
    );
>>>>>>> origin/main
  } catch (e) {
    // withCommandRun re-throws after recording failure telemetry.
    // If result was set, fn() returned a failure result — return it directly.
    // If not, fn() itself threw — convert to a failure result so callers
    // that don't wrap in try/catch (e.g. TUI hooks) don't leak unhandled rejections.
    if (!result) {
<<<<<<< HEAD
      return { success: false, error: getErrorMessage(e) } as R;
=======
      return { success: false, error: e instanceof Error ? e : new Error(getErrorMessage(e)) } as R;
>>>>>>> origin/main
    }
  }
  return result!;
}

/**
 * Record telemetry, print errors, and exit the process.
 * Use in CLI command handlers where the command is the final action.
 * The callback returns attrs on success and throws on failure.
<<<<<<< HEAD
=======
 * Pass knownAttrs to record command-specific attributes even on failure.
>>>>>>> origin/main
 */
export async function runCliCommand<C extends Command>(
  command: C,
  json: boolean,
<<<<<<< HEAD
  fn: () => Promise<CommandAttrs<C>>
=======
  fn: () => Promise<CommandAttrs<C>>,
  knownAttrs?: Partial<CommandAttrs<C>>
>>>>>>> origin/main
): Promise<never> {
  try {
    const client = await getTelemetryClient();
    if (!client) {
      await fn();
      process.exit(0);
    }
<<<<<<< HEAD
    await client.withCommandRun(command, fn);
=======
    await client.withCommandRun(command, fn, knownAttrs);
>>>>>>> origin/main
    process.exit(0);
  } catch (error) {
    if (json) {
      console.log(JSON.stringify({ success: false, error: getErrorMessage(error) }));
    } else {
      console.error(getErrorMessage(error));
    }
    process.exit(1);
  }
}
