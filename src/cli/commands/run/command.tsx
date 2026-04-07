import type { RecommendationType } from '../../aws/agentcore-recommendation';
import { getErrorMessage } from '../../errors';
import { handleRunEval } from '../../operations/eval';
import type { RunEvalOptions } from '../../operations/eval';
import { runRecommendationCommand, saveRecommendationRun } from '../../operations/recommendation';
import { COMMAND_DESCRIPTIONS } from '../../tui/copy';
import { requireProject } from '../../tui/guards';
import type { Command } from '@commander-js/extra-typings';
import { Text, render } from 'ink';
import React from 'react';

const RECOMMENDATION_TYPE_MAP: Record<string, RecommendationType> = {
  'system-prompt': 'SYSTEM_PROMPT_RECOMMENDATION',
  'tool-description': 'TOOL_DESCRIPTION_RECOMMENDATION',
};

function formatRunOutput(result: Awaited<ReturnType<typeof handleRunEval>>): void {
  if (!result.run) return;

  const { run } = result;
  const date = new Date(run.timestamp).toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  console.log(`\nAgent: ${run.agent} | ${date} | Sessions: ${run.sessionCount} | Lookback: ${run.lookbackDays}d`);

  if (run.referenceInputs) {
    const parts: string[] = [];
    if (run.referenceInputs.assertions?.length) {
      parts.push(`${run.referenceInputs.assertions.length} assertion(s)`);
    }
    if (run.referenceInputs.expectedResponse) {
      parts.push('expected response');
    }
    if (run.referenceInputs.expectedTrajectory?.length) {
      parts.push(`${run.referenceInputs.expectedTrajectory.length} trajectory step(s)`);
    }
    if (parts.length > 0) {
      console.log(`Reference inputs: ${parts.join(', ')}`);
    }
  }
  console.log('');

  for (const r of run.results) {
    const score = r.aggregateScore.toFixed(2);
    const errors = r.sessionScores.filter(s => s.errorMessage).length;
    const errorSuffix = errors > 0 ? ` (${errors} errors)` : '';
    console.log(`  ${r.evaluator}: ${score}${errorSuffix}`);
  }

  if (result.filePath) {
    console.log(`\nResults saved to: ${result.filePath}`);
  }
}

export const registerRun = (program: Command) => {
  const runCmd = program.command('run').description(COMMAND_DESCRIPTIONS.run);

  runCmd
    .command('eval')
    .description(
      'Run on-demand evaluation of runtime traces. Use --runtime-arn to evaluate runtimes outside the project.'
    )
    .option('-r, --runtime <name>', 'Runtime name from project config')
    .option('--runtime-arn <arn>', 'Runtime ARN — run outside a project directory')
    .option('-e, --evaluator <names...>', 'Evaluator name(s) from project or Builtin.* IDs')
    .option('--evaluator-arn <arns...>', 'Evaluator ARN(s) — use with --runtime-arn for standalone mode')
    .option('--region <region>', 'AWS region (required with --runtime-arn, auto-detected otherwise)')
    .option('-s, --session-id <id>', 'Evaluate a specific session only')
    .option('-t, --trace-id <id>', 'Evaluate a specific trace only')
    .option(
      '--endpoint <name>',
      'Runtime endpoint name (e.g. PROMPT_V1). Defaults to AGENTCORE_RUNTIME_ENDPOINT env var, then DEFAULT'
    )
    .option('--days <days>', 'Lookback window in days', '7')
    .option('-A, --assertion <text...>', 'Assertion the agent should satisfy (repeatable)')
    .option('--expected-trajectory <names>', 'Expected tool calls in order (comma-separated)')
    .option('--expected-response <text>', 'Expected agent response text')
    .option('--output <path>', 'Custom output file path for results')
    .option('--json', 'Output as JSON')
    .action(
      async (cliOptions: {
        runtime?: string;
        runtimeArn?: string;
        evaluator?: string[];
        evaluatorArn?: string[];
        region?: string;
        sessionId?: string;
        traceId?: string;
        endpoint?: string;
        assertion?: string[];
        expectedTrajectory?: string;
        expectedResponse?: string;
        days: string;
        output?: string;
        json?: boolean;
      }) => {
        const isArnMode = !!(cliOptions.runtimeArn && cliOptions.evaluatorArn);
        if (!isArnMode) {
          requireProject();
        }

        if (!cliOptions.evaluator && !cliOptions.evaluatorArn) {
          const error = 'At least one --evaluator or --evaluator-arn is required';
          if (cliOptions.json) {
            console.log(JSON.stringify({ success: false, error }));
          } else {
            render(<Text color="red">{error}</Text>);
          }
          process.exit(1);
        }

        const options: RunEvalOptions = {
          agent: cliOptions.runtime,
          agentArn: cliOptions.runtimeArn,
          evaluator: cliOptions.evaluator ?? [],
          evaluatorArn: cliOptions.evaluatorArn,
          region: cliOptions.region,
          sessionId: cliOptions.sessionId,
          traceId: cliOptions.traceId,
          endpoint: cliOptions.endpoint,
          assertions: cliOptions.assertion,
          expectedTrajectory: cliOptions.expectedTrajectory
            ? cliOptions.expectedTrajectory.split(',').map(s => s.trim())
            : undefined,
          expectedResponse: cliOptions.expectedResponse,
          days: parseInt(cliOptions.days, 10),
          output: cliOptions.output,
          json: cliOptions.json,
        };

        try {
          const result = await handleRunEval(options);

          if (cliOptions.json) {
            console.log(JSON.stringify(result));
          } else if (result.success) {
            formatRunOutput(result);
          } else {
            formatRunOutput(result);
            render(<Text color="red">{result.error}</Text>);
          }

          process.exit(result.success ? 0 : 1);
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

  runCmd
    .command('recommendation')
    .description('Run an optimization recommendation for system prompt or tool descriptions')
    .option('-t, --type <type>', 'What to optimize: system-prompt or tool-description')
    .option('-a, --agent <name>', 'Agent name from project')
    .option('-e, --evaluator <names...>', 'Evaluator name(s) or Builtin.* ID(s) (repeatable)')
    .option('--prompt-file <path>', 'Load system prompt from file')
    .option('--inline <content>', 'Provide content inline')
    .option('--bundle-name <name>', 'Config bundle name')
    .option('--bundle-version <version>', 'Config bundle version')
    .option('--tools <names>', 'Comma-separated toolName:description pairs (for tool-description type)')
    .option('--spans-file <path>', 'JSON file with session spans (inline traces instead of CloudWatch)')
    .option('--lookback <days>', 'Lookback window in days', '7')
    .option('-s, --session-id <ids...>', 'Specific session IDs for traces')
    .option('-r, --run <name>', 'Run name prefix')
    .option('--region <region>', 'AWS region')
    .option('--json', 'Output as JSON')
    .action(
      async (cliOptions: {
        type?: string;
        agent?: string;
        evaluator?: string[];
        promptFile?: string;
        inline?: string;
        bundleName?: string;
        bundleVersion?: string;
        tools?: string;
        spansFile?: string;
        lookback: string;
        sessionId?: string[];
        run?: string;
        region?: string;
        json?: boolean;
      }) => {
        requireProject();

        const typeKey = cliOptions.type ?? 'system-prompt';
        const recType = RECOMMENDATION_TYPE_MAP[typeKey];
        if (!recType) {
          const error = `Invalid --type "${typeKey}". Must be one of: ${Object.keys(RECOMMENDATION_TYPE_MAP).join(', ')}`;
          if (cliOptions.json) {
            console.log(JSON.stringify({ success: false, error }));
          } else {
            render(<Text color="red">{error}</Text>);
          }
          process.exit(1);
        }

        const agent = cliOptions.agent;
        const evaluators = cliOptions.evaluator;

        if (!agent) {
          const error = '--agent is required';
          if (cliOptions.json) {
            console.log(JSON.stringify({ success: false, error }));
          } else {
            render(<Text color="red">{error}</Text>);
          }
          process.exit(1);
        }

        if (!evaluators || evaluators.length === 0) {
          const error = '--evaluator is required (at least one)';
          if (cliOptions.json) {
            console.log(JSON.stringify({ success: false, error }));
          } else {
            render(<Text color="red">{error}</Text>);
          }
          process.exit(1);
        }

        try {
          const inputSource = cliOptions.promptFile
            ? ('file' as const)
            : cliOptions.inline
              ? ('inline' as const)
              : cliOptions.bundleName
                ? ('config-bundle' as const)
                : ('inline' as const);

          const traceSource = cliOptions.spansFile
            ? ('spans-file' as const)
            : cliOptions.sessionId
              ? ('sessions' as const)
              : ('cloudwatch' as const);

          const result = await runRecommendationCommand({
            type: recType,
            agent,
            evaluators,
            promptFile: cliOptions.promptFile,
            inlineContent: cliOptions.inline,
            bundleName: cliOptions.bundleName,
            bundleVersion: cliOptions.bundleVersion,
            tools: cliOptions.tools ? cliOptions.tools.split(',').map(t => t.trim()) : undefined,
            lookbackDays: parseInt(cliOptions.lookback, 10),
            sessionIds: cliOptions.sessionId,
            spansFile: cliOptions.spansFile,
            recommendationName: cliOptions.run,
            region: cliOptions.region,
            inputSource,
            traceSource,
          });

          if (!result.success) {
            if (cliOptions.json) {
              console.log(JSON.stringify(result));
            } else {
              render(<Text color="red">{result.error}</Text>);
            }
            process.exit(1);
          }

          // Save results locally
          try {
            if (result.recommendationId) {
              saveRecommendationRun(result.recommendationId, result, recType, agent, evaluators);
            }
          } catch {
            // Non-fatal — skip saving
          }

          if (cliOptions.json) {
            console.log(JSON.stringify(result));
          } else {
            console.log(`\nRecommendation ID: ${result.recommendationId}`);

            if (result.result) {
              const sysResult = result.result.systemPromptRecommendationResult;
              const toolResult = result.result.toolDescriptionRecommendationResult;

              if (sysResult) {
                if (sysResult.explanation) {
                  console.log(`\nWhat changed: ${sysResult.explanation}`);
                }
                if (sysResult.recommendedSystemPrompt) {
                  console.log('\n+++ Recommended System Prompt +++');
                  console.log(sysResult.recommendedSystemPrompt);
                }
              } else if (toolResult?.tools) {
                for (const tool of toolResult.tools) {
                  console.log(`\nTool: ${tool.toolName}`);
                  console.log(`Explanation: ${tool.explanation}`);
                  console.log(`Recommended: ${tool.recommendedToolDescription}`);
                }
              }
            }

            console.log('');
          }

          process.exit(0);
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
