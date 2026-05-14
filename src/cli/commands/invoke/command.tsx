<<<<<<< HEAD
=======
import { type Result, ValidationError, serializeResult } from '../../../lib';
>>>>>>> origin/main
import { getErrorMessage } from '../../errors';
import { withCommandRunTelemetry } from '../../telemetry/cli-command-run.js';
import { AuthType, Protocol, standardize } from '../../telemetry/schemas/common-shapes.js';
import { COMMAND_DESCRIPTIONS } from '../../tui/copy';
import { requireProject, requireTTY } from '../../tui/guards';
import { InvokeScreen } from '../../tui/screens/invoke';
import { parseHeaderFlags } from '../shared/header-utils';
<<<<<<< HEAD
import { handleHarnessInvokeByArn, handleInvoke, loadInvokeConfig } from './action';
=======
import { type InvokeContext, handleInvoke, loadInvokeConfig } from './action';
>>>>>>> origin/main
import { resolvePrompt } from './resolve-prompt';
import type { InvokeOptions, InvokeResult } from './types';
import { validateInvokeOptions } from './validate';
import type { Command } from '@commander-js/extra-typings';
import { Text, render } from 'ink';
import React from 'react';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function startSpinner(message: string): NodeJS.Timeout {
  let i = 0;
  process.stderr.write(`${SPINNER_FRAMES[0]} ${message}`);
  return setInterval(() => {
    i = (i + 1) % SPINNER_FRAMES.length;
    process.stderr.write(`\r${SPINNER_FRAMES[i]} ${message}`);
  }, 80);
}

function stopSpinner(spinner: NodeJS.Timeout): void {
  clearInterval(spinner);
  process.stderr.write('\r\x1b[K'); // Clear line
}

function resolveProtocol(options: InvokeOptions, projectProtocol?: string): string {
  if (projectProtocol) return projectProtocol.toLowerCase();
  if (options.tool) return 'mcp';
  return 'http';
}

async function handleInvokeCLI(options: InvokeOptions, preloadedContext?: InvokeContext): Promise<InvokeResult> {
  const validation = validateInvokeOptions(options);
  if (!validation.valid) {
    return { success: false, error: new ValidationError(validation.error ?? 'Validation failed') };
  }

  let spinner: NodeJS.Timeout | undefined;

  try {
<<<<<<< HEAD
    if (options.harnessArn) {
      const region = options.region ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION;
      if (!region) {
        const msg = '--region is required with --harness-arn (or set AWS_REGION)';
        if (options.json) {
          console.log(JSON.stringify({ success: false, error: msg }));
        } else {
          console.error(msg);
        }
        process.exit(1);
      }
      const result = await handleHarnessInvokeByArn(options.harnessArn, region, options);
      if (options.json) {
        console.log(JSON.stringify(result));
      } else if (!result.success && result.error) {
        console.error(result.error);
      }
      process.exit(result.success ? 0 : 1);
    }

    const context = await loadInvokeConfig();
=======
    const context = preloadedContext ?? (await loadInvokeConfig());
>>>>>>> origin/main

    // Show spinner for non-streaming, non-json, non-exec invocations
    // Harness invoke always streams directly to stdout, so skip spinner for harness
    const isHarness =
      options.harnessName != null ||
      ((context.project.harnesses ?? []).length > 0 && context.project.runtimes.length === 0);
    if (!options.stream && !options.json && !options.exec && !isHarness) {
      spinner = startSpinner('Invoking agent...');
    }

    const result = await handleInvoke(context, options);

    if (spinner) {
      stopSpinner(spinner);
    }

<<<<<<< HEAD
    if (options.json) {
      console.log(JSON.stringify(result));
    } else if (options.stream) {
      // Streaming already wrote to stdout, just show session and log path
      if (result.sessionId) {
        console.error(`\nSession: ${result.sessionId}`);
        console.error(`To resume: agentcore invoke --session-id ${result.sessionId}`);
      }
      if (result.logFilePath) {
        console.error(`Log: ${result.logFilePath}`);
      }
    } else {
      // Non-streaming, non-json: print provider info and response or error
      if (result.success && result.response) {
        console.log(result.response);
      } else if (!result.success && result.error) {
        console.error(result.error);
      }
      if (result.sessionId) {
        console.error(`\nSession: ${result.sessionId}`);
        console.error(`To resume: agentcore invoke --session-id ${result.sessionId}`);
      }
      if (result.logFilePath) {
        console.error(`Log: ${result.logFilePath}`);
      }
    }

    process.exit(result.success ? 0 : 1);
=======
    return result;
>>>>>>> origin/main
  } catch (err) {
    if (spinner) {
      stopSpinner(spinner);
    }
    throw err;
  }
}

function printInvokeResult(result: InvokeResult, options: InvokeOptions): void {
  if (options.json) {
    console.log(JSON.stringify(serializeResult(result)));
  } else if (options.stream) {
    // Streaming already wrote to stdout, just show session and log path
    if (result.sessionId) {
      console.error(`\nSession: ${result.sessionId}`);
      console.error(`To resume: agentcore invoke --session-id ${result.sessionId}`);
    }
    if (result.logFilePath) {
      console.error(`Log: ${result.logFilePath}`);
    }
  } else {
    // Non-streaming, non-json: print provider info and response or error
    if (result.success && result.response) {
      console.log(result.response);
    } else if (!result.success && result.error) {
      console.error(result.error.message);
    }
    if (result.sessionId) {
      console.error(`\nSession: ${result.sessionId}`);
      console.error(`To resume: agentcore invoke --session-id ${result.sessionId}`);
    }
    if (result.logFilePath) {
      console.error(`Log: ${result.logFilePath}`);
    }
  }
}

export const registerInvoke = (program: Command) => {
  program
    .command('invoke')
    .alias('i')
    .description(COMMAND_DESCRIPTIONS.invoke)
    .argument(
      '[prompt]',
      'Prompt to send to the agent. Also accepts piped stdin when no prompt is provided and stdin is not a TTY [non-interactive]'
    )
    .option('--prompt <text>', 'Prompt to send to the agent [non-interactive]')
    .option(
      '--prompt-file <path>',
      'Read the prompt from a file (for long or structured payloads that exceed shell arg limits) [non-interactive]'
    )
    .option('--runtime <name>', 'Select specific runtime [non-interactive]')
    .option('--target <name>', 'Select deployment target [non-interactive]')
    .option('--session-id <id>', 'Use specific session ID for conversation continuity')
    .option('--user-id <id>', 'User ID for runtime invocation (default: "default-user")')
    .option('--json', 'Output as JSON [non-interactive]')
    .option('--stream', 'Stream response in real-time (TUI streams by default) [non-interactive]')
    .option('--tool <name>', 'MCP tool name (use with "call-tool" prompt) [non-interactive]')
    .option('--input <json>', 'MCP tool arguments as JSON (use with --tool) [non-interactive]')
    .option('--exec', 'Execute a shell command in the runtime container [non-interactive]')
    .option('--timeout <seconds>', 'Timeout in seconds for --exec commands [non-interactive]', parseInt)
    .option(
      '-H, --header <header>',
      'Custom header to forward to the agent (format: "Name: Value", repeatable) [non-interactive]',
      (val: string, prev: string[]) => [...prev, val],
      [] as string[]
    )
    .option('--bearer-token <token>', 'Bearer token for CUSTOM_JWT auth (bypasses SigV4) [non-interactive]')
    .option('--harness <name>', 'Select specific harness to invoke [non-interactive]')
    .option('--harness-arn <arn>', 'Invoke a harness by ARN (no project required) [non-interactive]')
    .option('--region <region>', 'AWS region (required with --harness-arn when no project) [non-interactive]')
    .option('--verbose', 'Print verbose streaming JSON events (harness only) [non-interactive]')
    .option('--model-id <id>', 'Override model for this invocation (harness only) [non-interactive]')
    .option(
      '--model-provider <provider>',
      'Override model provider: bedrock, open_ai, gemini (harness only) [non-interactive]'
    )
    .option('--api-key-arn <arn>', 'Override API key ARN for open_ai/gemini (harness only) [non-interactive]')
    .option('--tools <tools>', 'Override tools, comma-separated (harness only) [non-interactive]')
    .option('--max-iterations <n>', 'Override max iterations (harness only) [non-interactive]', parseInt)
    .option('--max-tokens <n>', 'Override max tokens (harness only) [non-interactive]', parseInt)
    .option('--harness-timeout <seconds>', 'Override timeout seconds (harness only) [non-interactive]', parseInt)
    .option('--skills <paths>', 'Skills to use, comma-separated paths (harness only) [non-interactive]')
    .option('--system-prompt <text>', 'Override system prompt (harness only) [non-interactive]')
    .option('--allowed-tools <tools>', 'Override allowed tools, comma-separated (harness only) [non-interactive]')
    .option('--actor-id <id>', 'Override memory actor ID (harness only) [non-interactive]')
    .action(
      async (
        positionalPrompt: string | undefined,
        cliOptions: {
          prompt?: string;
          promptFile?: string;
          runtime?: string;
          target?: string;
          sessionId?: string;
          userId?: string;
          json?: boolean;
          stream?: boolean;
          tool?: string;
          input?: string;
          exec?: boolean;
          timeout?: number;
          header?: string[];
          bearerToken?: string;
          harness?: string;
          harnessArn?: string;
          region?: string;
          verbose?: boolean;
          modelId?: string;
          modelProvider?: string;
          apiKeyArn?: string;
          tools?: string;
          maxIterations?: number;
          maxTokens?: number;
          harnessTimeout?: number;
          skills?: string;
          systemPrompt?: string;
          allowedTools?: string;
          actorId?: string;
        }
      ) => {
        try {
<<<<<<< HEAD
          if (!cliOptions.harnessArn) {
            requireProject();
          }
=======
          requireProject();

          // Load config once for protocol resolution and to pass into handleInvokeCLI
          let invokeContext: InvokeContext | undefined;
          let agentProtocol: string | undefined;
          try {
            invokeContext = await loadInvokeConfig();
            const agent = cliOptions.runtime
              ? invokeContext.project.runtimes.find(a => a.name === cliOptions.runtime)
              : invokeContext.project.runtimes[0];
            agentProtocol = agent?.protocol;
          } catch {
            // Config load failure will be caught again inside handleInvokeCLI
          }

>>>>>>> origin/main
          // Resolve prompt from flag / positional / --prompt-file / stdin
          const resolved = await resolvePrompt({
            flag: cliOptions.prompt,
            positional: positionalPrompt,
            file: cliOptions.promptFile,
            stdinPiped: !process.stdin.isTTY,
          });

          // CLI mode if any CLI-specific options provided, prompt resolved, or prompt resolution failed
          // (follows deploy command pattern)
          if (
            !resolved.success ||
            resolved.prompt !== undefined ||
            cliOptions.json ||
            cliOptions.target ||
            cliOptions.stream ||
            cliOptions.runtime ||
            cliOptions.tool ||
            cliOptions.exec ||
            cliOptions.bearerToken ||
            cliOptions.harness ||
            cliOptions.harnessArn ||
            cliOptions.verbose
          ) {
<<<<<<< HEAD
            await handleInvokeCLI({
              prompt,
              agentName: cliOptions.runtime,
              harnessName: cliOptions.harness,
              harnessArn: cliOptions.harnessArn,
              region: cliOptions.region,
              targetName: cliOptions.target ?? 'default',
              sessionId: cliOptions.sessionId,
              userId: cliOptions.userId,
              json: cliOptions.json,
              stream: cliOptions.stream,
              tool: cliOptions.tool,
              input: cliOptions.input,
              exec: cliOptions.exec,
              timeout: cliOptions.timeout,
              headers,
              bearerToken: cliOptions.bearerToken,
              verbose: cliOptions.verbose,
              modelId: cliOptions.modelId,
              modelProvider: cliOptions.modelProvider,
              apiKeyArn: cliOptions.apiKeyArn,
              tools: cliOptions.tools,
              maxIterations: cliOptions.maxIterations,
              maxTokens: cliOptions.maxTokens,
              harnessTimeout: cliOptions.harnessTimeout,
              skills: cliOptions.skills,
              systemPrompt: cliOptions.systemPrompt,
              allowedTools: cliOptions.allowedTools,
              actorId: cliOptions.actorId,
=======
            const result = await withCommandRunTelemetry(
              'invoke',
              {
                has_stream: cliOptions.stream ?? false,
                has_session_id: !!cliOptions.sessionId,
                auth_type: standardize(AuthType, cliOptions.bearerToken ? 'bearer_token' : 'sigv4'),
                protocol: standardize(
                  Protocol,
                  resolveProtocol({ tool: cliOptions.tool } as InvokeOptions, agentProtocol)
                ),
              },
              async (): Promise<InvokeResult> => {
                if (!resolved.success) {
                  return { success: false, error: new ValidationError(resolved.error ?? 'Prompt resolution failed') };
                }

                // Parse custom headers
                let headers: Record<string, string> | undefined;
                if (cliOptions.header && cliOptions.header.length > 0) {
                  headers = parseHeaderFlags(cliOptions.header);
                }

                const options: InvokeOptions = {
                  prompt: resolved.prompt,
                  agentName: cliOptions.runtime,
                  targetName: cliOptions.target ?? 'default',
                  sessionId: cliOptions.sessionId,
                  userId: cliOptions.userId,
                  json: cliOptions.json,
                  stream: cliOptions.stream,
                  tool: cliOptions.tool,
                  input: cliOptions.input,
                  exec: cliOptions.exec,
                  timeout: cliOptions.timeout,
                  headers,
                  bearerToken: cliOptions.bearerToken,
                };

                return handleInvokeCLI(options, invokeContext);
              }
            );

            printInvokeResult(result, {
              json: cliOptions.json,
              stream: cliOptions.stream,
>>>>>>> origin/main
            });
            process.exit(result.success ? 0 : 1);
          } else {
            // No CLI options - interactive TUI mode (headers still passed if provided)
            requireTTY();
<<<<<<< HEAD
            const ENTER_ALT_SCREEN = '\x1B[?1049h\x1B[H';
            const EXIT_ALT_SCREEN = '\x1B[?1049l';
            const SHOW_CURSOR = '\x1B[?25h';

            process.stdout.write(ENTER_ALT_SCREEN);

            const exitAltScreen = () => {
              process.stdout.write(EXIT_ALT_SCREEN);
              process.stdout.write(SHOW_CURSOR);
            };

            const { waitUntilExit, unmount } = render(
              <InvokeScreen
                isInteractive={true}
                onExit={() => {
                  exitAltScreen();
                  unmount();
                }}
                initialSessionId={cliOptions.sessionId}
                initialUserId={cliOptions.userId}
                initialHeaders={headers}
                initialBearerToken={cliOptions.bearerToken}
              />
=======

            // Parse custom headers for TUI mode
            let headers: Record<string, string> | undefined;
            if (cliOptions.header && cliOptions.header.length > 0) {
              headers = parseHeaderFlags(cliOptions.header);
            }

            const tuiResult = await withCommandRunTelemetry(
              'invoke',
              {
                has_stream: true,
                has_session_id: !!cliOptions.sessionId,
                auth_type: standardize(AuthType, cliOptions.bearerToken ? 'bearer_token' : 'sigv4'),
                protocol: standardize(Protocol, resolveProtocol({}, agentProtocol)),
              },
              async (): Promise<Result> => {
                const { waitUntilExit, unmount } = render(
                  <InvokeScreen
                    isInteractive={true}
                    onExit={() => unmount()}
                    initialSessionId={cliOptions.sessionId}
                    initialUserId={cliOptions.userId}
                    initialHeaders={headers}
                    initialBearerToken={cliOptions.bearerToken}
                  />
                );
                await waitUntilExit();
                return { success: true };
              }
>>>>>>> origin/main
            );
            if (!tuiResult.success) {
              render(<Text color="red">Error: {getErrorMessage(tuiResult.error)}</Text>);
              process.exit(1);
            }
          }
        } catch (error) {
          if (cliOptions.json) {
            console.log(JSON.stringify({ success: false, error: getErrorMessage(error) }));
          } else {
            render(<Text color="red">Error: {getErrorMessage(error)}</Text>);
          }
          process.exit(1);
        }
      }
    );
};
