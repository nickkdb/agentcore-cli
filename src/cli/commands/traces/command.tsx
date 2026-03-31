import { getErrorMessage } from '../../errors';
import { loadDeployedProjectConfig } from '../../operations/resolve-agent';
import { COMMAND_DESCRIPTIONS } from '../../tui/copy';
import { requireProject } from '../../tui/guards';
import { handleTracesGet, handleTracesList } from './action';
import type { TracesGetOptions, TracesListOptions } from './types';
import type { Command } from '@commander-js/extra-typings';
import { Box, Text, render } from 'ink';

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function formatAge(nanoTimestamp: number): string {
  if (nanoTimestamp === 0) return '-';
  const seconds = Math.floor((Date.now() - nanoTimestamp / 1_000_000) / 1000);
  if (seconds < 0) return 'now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function getDurationColor(ms: number): string {
  if (ms < 100) return 'green';
  if (ms < 1000) return 'yellow';
  if (ms < 5000) return 'yellowBright';
  return 'red';
}

export const registerTraces = (program: Command) => {
  const traces = program.command('traces').alias('t').description(COMMAND_DESCRIPTIONS.traces);

  traces
    .command('list')
    .description('List recent traces for a deployed runtime')
    .option('--runtime <name>', 'Select specific runtime')
    .option('--limit <n>', 'Maximum number of traces to display', '20')
    .option('--since <time>', 'Start time — defaults to 12h ago (e.g. 5m, 1h, 2d, ISO 8601, epoch ms)')
    .option('--until <time>', 'End time — defaults to now (e.g. now, 1h, ISO 8601, epoch ms)')
    .action(async (cliOptions: TracesListOptions) => {
      requireProject();

      try {
        const context = await loadDeployedProjectConfig();
        const result = await handleTracesList(context, cliOptions);

        if (!result.success) {
          render(
            <Box flexDirection="column">
              <Text color="red">Error: {result.error}</Text>
              {result.consoleUrl && <Text color="gray">Console: {result.consoleUrl}</Text>}
            </Box>
          );
          process.exit(1);
          return;
        }

        render(
          <Box flexDirection="column">
            <Text bold>
              Traces for {result.agentName} (target: {result.targetName})
            </Text>
            <Text> </Text>
            {result.traces && result.traces.length > 0 ? (
              <>
                {/* Header */}
                <Box>
                  <Box width={4}>
                    <Text bold dimColor>
                      #
                    </Text>
                  </Box>
                  <Box width={34}>
                    <Text bold>Trace ID</Text>
                  </Box>
                  <Box width={9}>
                    <Text bold>Duration</Text>
                  </Box>
                  <Box width={12}>
                    <Text bold>Status</Text>
                  </Box>
                  <Box width={25}>
                    <Text bold>Input</Text>
                  </Box>
                  <Box width={25}>
                    <Text bold>Output</Text>
                  </Box>
                  <Box width={8}>
                    <Text bold dimColor>
                      Age
                    </Text>
                  </Box>
                </Box>
                {/* Separator */}
                <Box>
                  <Text dimColor>{'─'.repeat(117)}</Text>
                </Box>
                {/* Rows */}
                {result.traces.map((trace, i) => (
                  <Box key={i} flexDirection="column">
                    <Box>
                      <Box width={4}>
                        <Text color="cyan">{String(i + 1).padStart(2)}</Text>
                      </Box>
                      <Box width={34}>
                        <Text color="blueBright">{trace.traceId}</Text>
                      </Box>
                      <Box width={9}>
                        <Text color={getDurationColor(trace.durationMs)}>{formatDuration(trace.durationMs)}</Text>
                      </Box>
                      <Box width={12}>
                        <Text dimColor>{trace.spanCount} spans</Text>
                      </Box>
                      <Box width={25}>
                        <Text color="cyan">{trace.input ?? '-'}</Text>
                      </Box>
                      <Box width={25}>
                        <Text color="green">{trace.output ?? '-'}</Text>
                      </Box>
                      <Box width={8}>
                        <Text dimColor>{formatAge(trace.latestEndTimeNano)}</Text>
                      </Box>
                    </Box>
                    {/* Second line: latest marker + status icon */}
                    <Box>
                      <Box width={4}>
                        <Text> </Text>
                      </Box>
                      <Box width={34}>{i === 0 ? <Text dimColor>(latest)</Text> : <Text> </Text>}</Box>
                      <Box width={9}>
                        <Text> </Text>
                      </Box>
                      <Box width={12}>
                        {trace.errorCount > 0 ? (
                          <Text color="red">
                            {'❌'} {trace.errorCount} err
                          </Text>
                        ) : (
                          <Text color="green">{'✓'} OK</Text>
                        )}
                      </Box>
                      <Box width={50}>
                        <Text> </Text>
                      </Box>
                      <Box width={8}>
                        <Text> </Text>
                      </Box>
                    </Box>
                  </Box>
                ))}
                <Text> </Text>
                <Text color="green">
                  {'✓'} Found {result.traces.length} traces
                </Text>
              </>
            ) : (
              <Text color="yellow">No traces found in the specified time range.</Text>
            )}
            <Text> </Text>
            {result.consoleUrl && <Text color="gray">Console: {result.consoleUrl}</Text>}
            {result.consoleUrl && <Text dimColor>Note: Traces may take 2-3 minutes to appear in CloudWatch</Text>}
          </Box>
        );
      } catch (error) {
        render(<Text color="red">Error: {getErrorMessage(error)}</Text>);
        process.exit(1);
      }
    });

  traces
    .command('get <traceId>')
    .description('Download a trace to a JSON file')
    .option('--runtime <name>', 'Select specific runtime')
    .option('--output <path>', 'Output file path')
    .option('--since <time>', 'Start time — defaults to 12h ago (e.g. 5m, 1h, 2d, ISO 8601, epoch ms)')
    .option('--until <time>', 'End time — defaults to now (e.g. now, 1h, ISO 8601, epoch ms)')
    .action(async (traceId: string, cliOptions: TracesGetOptions) => {
      requireProject();

      try {
        const context = await loadDeployedProjectConfig();
        const result = await handleTracesGet(context, traceId, cliOptions);

        if (!result.success) {
          render(
            <Box flexDirection="column">
              <Text color="red">Error: {result.error}</Text>
              {result.consoleUrl && <Text color="gray">Console: {result.consoleUrl}</Text>}
            </Box>
          );
          process.exit(1);
          return;
        }

        render(
          <Box flexDirection="column">
            <Text color="green">Trace saved to: {result.filePath}</Text>
            {result.consoleUrl && <Text color="gray">Console: {result.consoleUrl}</Text>}
          </Box>
        );
      } catch (error) {
        render(<Text color="red">Error: {getErrorMessage(error)}</Text>);
        process.exit(1);
      }
    });
};
