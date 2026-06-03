import { COMMAND_DESCRIPTIONS } from '../../constants';
import { withCommandRunTelemetry } from '../../telemetry/cli-command-run.js';
import { handleValidate } from './action';
import type { Command } from '@commander-js/extra-typings';
import { Box, Text, render } from 'ink';

export const registerValidate = (program: Command) => {
  program
    .command('validate')
    .option('-d, --directory <path>', 'Project directory containing agentcore config')
    .option('--json', 'Output as JSON [non-interactive]')
    .description(COMMAND_DESCRIPTIONS.validate)
    .action(async options => {
      const result = await withCommandRunTelemetry('validate', {}, async () => handleValidate(options));

      if (options.json) {
        if (result.success) {
          console.log(
            JSON.stringify({
              success: true,
              notes: result.notes ?? [],
            })
          );
          process.exit(0);
        } else {
          console.log(JSON.stringify({ success: false, error: result.error.message }));
          process.exit(1);
        }
      }

      if (result.success) {
        render(
          <Box flexDirection="column">
            <Text color="green">Valid</Text>
            {(result.notes ?? []).map((note: string, i: number) => (
              <Text key={`note-${i}`} color="yellow">
                {note}
              </Text>
            ))}
          </Box>
        );
        process.exit(0);
      } else {
        render(<Text color="red">{result.error.message}</Text>);
        process.exit(1);
      }
    });
};
