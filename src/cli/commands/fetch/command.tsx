import { sanitizeLongFieldForTerminal } from '../../../lib/utils/sanitize';
import { COMMAND_DESCRIPTIONS } from '../../constants';
import { getErrorMessage } from '../../errors';
import { requireProject } from '../../tui/guards';
import { handleFetchAccess } from './action';
import type { FetchAccessResult } from './action';
import type { FetchAccessOptions } from './types';
import type { Command } from '@commander-js/extra-typings';
import { Box, Text, render } from 'ink';

export const registerFetch = (program: Command) => {
  const fetchCmd = program.command('fetch').description(COMMAND_DESCRIPTIONS.fetch);

  fetchCmd
    .command('access')
    .description('Fetch access info (URL, token, auth guidance) for a deployed gateway or agent.')
    .option('--name <resource>', 'Gateway or agent name [non-interactive]')
    .option('--type <type>', 'Resource type: gateway (default) or agent [non-interactive]', 'gateway')
    .option('--target <target>', 'Deployment target [non-interactive]')
    .option(
      '--target-name <gateway-target>',
      'Gateway-target name. When set with --name, returns the 3LO outbound-auth status (token / authorizationUrl / sessionUri / callbackUrl) for that target. [non-interactive]'
    )
    .option(
      '--force-reauth',
      'Force a fresh consent flow on the next 3LO invocation by setting forceAuthentication=true [non-interactive]'
    )
    .option('--identity-name <name>', 'Identity credential name for token fetch [non-interactive]')
    .option('--json', 'Output as JSON [non-interactive]')
    .action(async (cliOptions: Record<string, unknown>) => {
      const options = cliOptions as unknown as FetchAccessOptions;
      requireProject();

      let result: FetchAccessResult;
      try {
        result = await handleFetchAccess(options);
      } catch (error) {
        if (options.json) {
          console.log(JSON.stringify({ success: false, error: getErrorMessage(error) }));
        } else {
          render(<Text color="red">Error: {getErrorMessage(error)}</Text>);
        }
        process.exit(1);
        return;
      }

      if (!result.success) {
        if (options.json) {
          console.log(
            JSON.stringify({
              success: false,
              error: result.error,
              ...(result.availableGateways && { availableGateways: result.availableGateways }),
            })
          );
        } else if (!result.availableGateways) {
          render(<Text color="red">{result.error}</Text>);
        } else {
          render(
            <Box flexDirection="column">
              <Text color="red">{result.error}</Text>
              <Text>Available gateways:</Text>
              {result.availableGateways.map(gw => (
                <Text key={gw.name}>
                  {'  '}
                  {gw.name} [{gw.authType}]
                </Text>
              ))}
            </Box>
          );
        }
        process.exit(1);
        return;
      }

      if (options.json) {
        if (result.outbound3lo) {
          console.log(JSON.stringify({ success: true, outbound3lo: result.outbound3lo }, null, 2));
        } else {
          console.log(JSON.stringify({ success: true, ...result.result }, null, 2));
        }
        return;
      }

      // 3LO outbound-status branch (when --target-name was supplied).
      if (result.outbound3lo) {
        const o = result.outbound3lo;
        render(
          <Box flexDirection="column">
            <Text>
              <Text bold>Gateway/Target:</Text>
              <Text color="green">
                {' '}
                {o.gatewayName}/{o.targetName}
              </Text>
            </Text>
            <Text>
              <Text bold>Grant type:</Text> {o.grantType}
            </Text>
            {o.credentialName && (
              <Text>
                <Text bold>Credential:</Text> {o.credentialName}
              </Text>
            )}
            <Text>
              <Text bold>Status:</Text>{' '}
              <Text
                color={
                  o.tokenStatus.status === 'fresh'
                    ? 'green'
                    : o.tokenStatus.status === 'inProgress'
                      ? 'yellow'
                      : o.tokenStatus.status === 'needsConsent'
                        ? 'cyan'
                        : 'red'
                }
              >
                {o.tokenStatus.status}
              </Text>
            </Text>
            {'authorizationUrl' in o.tokenStatus && o.tokenStatus.authorizationUrl && (
              <Text>
                <Text bold>Open this URL to consent:</Text>{' '}
                <Text color="green">{sanitizeLongFieldForTerminal(o.tokenStatus.authorizationUrl)}</Text>
              </Text>
            )}
            {o.callbackUrl && (
              <Text>
                <Text bold>Callback URL (register with IdP):</Text> {o.callbackUrl}
              </Text>
            )}
            {o.tokenStatus.status === 'failed' && (
              <Text color="red">
                <Text bold>Reason:</Text> {o.tokenStatus.reason}
              </Text>
            )}
          </Box>
        );
        return;
      }

      const r = result.result!;
      render(
        <Box flexDirection="column">
          <Text>
            <Text bold>URL:</Text>
            <Text color="green"> {r.url}</Text>
          </Text>
          <Text>
            <Text bold>Auth:</Text> {r.authType}
          </Text>
          {r.message && <Text>{r.message}</Text>}
          {r.token && (
            <Text>
              <Text bold>Token:</Text> {sanitizeLongFieldForTerminal(r.token)}
            </Text>
          )}
          {r.expiresIn !== undefined && (
            <Text>
              <Text bold>Expires in:</Text> {r.expiresIn}s
            </Text>
          )}
        </Box>
      );
    });
};
