import { getCredentialProvider } from '../../../aws/account';
import { getABTest, updateABTest } from '../../../aws/agentcore-ab-tests';
import type { GetABTestResult } from '../../../aws/agentcore-ab-tests';
import { getOnlineEvaluationConfig } from '../../../aws/agentcore-control';
import { getHttpGateway, listHttpGatewayTargets } from '../../../aws/agentcore-http-gateways';
import { getErrorMessage } from '../../../errors';
import { GradientText, Screen } from '../../components';
import {
  CloudWatchLogsClient,
  DescribeDeliveriesCommand,
  DescribeDeliverySourcesCommand,
  FilterLogEventsCommand,
} from '@aws-sdk/client-cloudwatch-logs';
import { Box, Text, useInput } from 'ink';
import React, { useCallback, useEffect, useRef, useState } from 'react';

interface ABTestDetailScreenProps {
  abTestId: string;
  region: string;
  onExit: () => void;
}

/** Derive the gateway URL from a gateway ARN. */
function gatewayUrlFromArn(arn: string): string {
  const parts = arn.split(':');
  const region = parts[3];
  const gatewayId = parts[5]?.split('/')[1];
  if (region && gatewayId) {
    return `https://${gatewayId}.gateway.bedrock-agentcore.${region}.amazonaws.com`;
  }
  return arn;
}

/** Extract the resource ID from an ARN (last segment after / or :). */
function extractId(arn: string): string {
  const slashIdx = arn.lastIndexOf('/');
  if (slashIdx !== -1) return arn.slice(slashIdx + 1);
  const colonIdx = arn.lastIndexOf(':');
  if (colonIdx !== -1) return arn.slice(colonIdx + 1);
  return arn;
}

/** Truncate a version ID to 8 characters. */
function shortVersion(version: string): string {
  return version.slice(0, 8);
}

/** Format a Unix epoch timestamp (seconds) to a UTC date string. */
function formatTimestamp(ts: string | number): string {
  const ms = typeof ts === 'string' ? parseFloat(ts) * 1000 : ts * 1000;
  const d = new Date(ms);
  return d
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d+Z$/, ' UTC');
}

/** Build a horizontal rule with optional left label and right label. */
function rule(left?: string, right?: string, width = 48): string {
  if (!left && !right) return '─'.repeat(width);
  const leftPart = left ? `── ${left} ` : '──';
  const rightPart = right ? ` ${right} ──` : '';
  const fillLen = width - leftPart.length - rightPart.length;
  const fill = fillLen > 0 ? '─'.repeat(fillLen) : '';
  return `${leftPart}${fill}${rightPart}`;
}

interface DebugCheckResult {
  label: string;
  status: 'pass' | 'fail' | 'warn';
  detail: string;
}

async function runDebugChecks(test: GetABTestResult, region: string): Promise<DebugCheckResult[]> {
  const results: DebugCheckResult[] = [];
  const logsClient = new CloudWatchLogsClient({ region, credentials: getCredentialProvider() });

  // 1. AB Test Status
  results.push({
    label: 'AB Test Status',
    status: test.status === 'ACTIVE' && test.executionStatus === 'RUNNING' ? 'pass' : 'warn',
    detail: `${test.status} / ${test.executionStatus}`,
  });

  // 1b. AB Test Role
  results.push({
    label: 'AB Test Role',
    status: test.roleArn ? 'pass' : 'warn',
    detail: test.roleArn ?? 'No role ARN',
  });

  // 2. Online Eval Config
  const evalConfigArn = test.evaluationConfig.onlineEvaluationConfigArn;
  const evalConfigId = extractId(evalConfigArn);
  try {
    const evalConfig = await getOnlineEvaluationConfig({ region, configId: evalConfigId });
    results.push({
      label: 'Online Eval Config',
      status: evalConfig.executionStatus === 'ENABLED' ? 'pass' : 'fail',
      detail: `${evalConfig.configName} — ${evalConfig.executionStatus}`,
    });
  } catch (err) {
    results.push({ label: 'Online Eval Config', status: 'fail', detail: getErrorMessage(err) });
  }

  // 2b. Gateway Role
  const gatewayId = extractId(test.gatewayArn);
  try {
    const gateway = await getHttpGateway({ region, gatewayId });
    results.push({
      label: 'Gateway Role',
      status: gateway.roleArn ? 'pass' : 'warn',
      detail: gateway.roleArn ?? 'No role ARN',
    });
  } catch (err) {
    results.push({ label: 'Gateway Role', status: 'fail', detail: getErrorMessage(err) });
  }

  // 3. Gateway Trace Delivery (source + destination + delivery)
  try {
    const [sources, deliveries] = await Promise.all([
      logsClient.send(new DescribeDeliverySourcesCommand({})),
      logsClient.send(new DescribeDeliveriesCommand({})),
    ]);

    const source = (sources.deliverySources ?? []).find(
      s => s.resourceArns?.some(a => a.includes(gatewayId)) && s.logType === 'TRACES'
    );
    const delivery = source ? (deliveries.deliveries ?? []).find(d => d.deliverySourceName === source.name) : undefined;

    const hasSource = !!source;
    const hasDelivery = !!delivery;

    if (hasSource && hasDelivery) {
      results.push({
        label: 'Gateway Trace Delivery',
        status: 'pass',
        detail: `Source: ${source.name} → Delivery: ${delivery.id}`,
      });
    } else if (hasSource) {
      results.push({
        label: 'Gateway Trace Delivery',
        status: 'fail',
        detail: `Source exists (${source.name}) but no delivery/destination — traces not flowing`,
      });
    } else {
      results.push({
        label: 'Gateway Trace Delivery',
        status: 'fail',
        detail: 'Not enabled — gateway spans will not flow to aws/spans',
      });
    }
  } catch (err) {
    results.push({ label: 'Gateway Trace Delivery', status: 'fail', detail: getErrorMessage(err) });
  }

  // 4. Gateway Spans in aws/spans
  const fiveMinAgo = Date.now() - 5 * 60 * 1000;
  try {
    const spanEvents = await logsClient.send(
      new FilterLogEventsCommand({
        logGroupName: 'aws/spans',
        startTime: fiveMinAgo,
        filterPattern: `"${gatewayId}"`,
        limit: 50,
      })
    );
    const count = spanEvents.events?.length ?? 0;
    results.push({
      label: 'Gateway Spans (last 5m)',
      status: count > 0 ? 'pass' : 'warn',
      detail: count > 0 ? `${count} spans found` : 'No recent spans — send traffic through the gateway',
    });
  } catch (err) {
    results.push({ label: 'Gateway Spans', status: 'fail', detail: getErrorMessage(err) });
  }

  // 5. Eval Results with variant breakdown
  try {
    const evalLogGroup = `/aws/bedrock-agentcore/evaluations/results/${evalConfigId}`;
    const thirtyMinAgo = Date.now() - 30 * 60 * 1000;

    const [allEvents, controlEvents, treatmentEvents] = await Promise.all([
      logsClient.send(new FilterLogEventsCommand({ logGroupName: evalLogGroup, startTime: thirtyMinAgo, limit: 1 })),
      logsClient.send(
        new FilterLogEventsCommand({
          logGroupName: evalLogGroup,
          startTime: thirtyMinAgo,
          filterPattern: `"experiment.treatment_name" "C" "${test.abTestArn}"`,
          limit: 100,
        })
      ),
      logsClient.send(
        new FilterLogEventsCommand({
          logGroupName: evalLogGroup,
          startTime: thirtyMinAgo,
          filterPattern: `"experiment.treatment_name" "T1" "${test.abTestArn}"`,
          limit: 100,
        })
      ),
    ]);

    const hasResults = (allEvents.events?.length ?? 0) > 0;
    const controlCount = controlEvents.events?.length ?? 0;
    const treatmentCount = treatmentEvents.events?.length ?? 0;

    if (!hasResults) {
      results.push({
        label: 'Eval Results (last 30m)',
        status: 'warn',
        detail: 'No eval results yet — wait ~5m after session timeout for evaluator to process',
      });
    } else {
      const tagged = controlCount + treatmentCount;
      results.push({
        label: 'Eval Results (last 30m)',
        status: tagged > 0 ? 'pass' : 'warn',
        detail:
          tagged > 0
            ? `C: ${controlCount}, T1: ${treatmentCount}`
            : 'Results exist but none tagged with variant — check gateway trace delivery',
      });
    }
  } catch (err) {
    const msg = getErrorMessage(err);
    results.push({
      label: 'Eval Results',
      status: msg.includes('ResourceNotFoundException') ? 'warn' : 'fail',
      detail: msg.includes('ResourceNotFoundException') ? 'Log group not found — evaluator has not run yet' : msg,
    });
  }

  // 6. Aggregation Results
  const metrics = test.results?.evaluatorMetrics ?? [];
  const reporting = metrics.filter(m => m.controlStats?.sampleSize > 0);
  results.push({
    label: 'Aggregation Results',
    status: reporting.length > 0 ? 'pass' : 'warn',
    detail:
      reporting.length > 0
        ? `${reporting.length} evaluator(s) reporting`
        : 'No aggregation data yet — wait ~12-15m after traffic',
  });

  return results;
}

export function ABTestDetailScreen({ abTestId, region, onExit }: ABTestDetailScreenProps) {
  const [test, setTest] = useState<GetABTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [confirmingStop, setConfirmingStop] = useState(false);
  const [debugResults, setDebugResults] = useState<DebugCheckResult[] | null>(null);
  const [debugLoading, setDebugLoading] = useState(false);
  const [targetName, setTargetName] = useState<string>('');

  const hasFetched = useRef(false);
  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;
    const load = async () => {
      try {
        const result = await getABTest({ region, abTestId });
        setTest(result);

        // Fetch gateway target name for invocation URL
        const gwId = extractId(result.gatewayArn);
        try {
          const targets = await listHttpGatewayTargets({ region, gatewayId: gwId, maxResults: 1 });
          const firstTarget = targets.targets[0];
          if (firstTarget) setTargetName(firstTarget.name);
        } catch {
          // Best-effort — URL will show without target path
        }
      } catch (err) {
        setError(getErrorMessage(err));
      }
    };
    void load();
  }, [region, abTestId]);

  const performAction = useCallback(
    async (targetStatus: 'PAUSED' | 'RUNNING' | 'STOPPED', label: string) => {
      setActionMessage(`${label}...`);
      try {
        await updateABTest({ region, abTestId, executionStatus: targetStatus });
        // Poll until status updates or max attempts reached
        for (let i = 0; i < 5; i++) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          const result = await getABTest({ region, abTestId });
          setTest(result);
          if (result.executionStatus === targetStatus) {
            setActionMessage(label.replace('...', 'd').replace('ing', 'ed'));
            return;
          }
        }
        // Final fetch even if status didn't converge
        setActionMessage(label.replace('ing', 'ed'));
      } catch (err: unknown) {
        setActionMessage(`Error: ${getErrorMessage(err)}`);
      }
    },
    [region, abTestId]
  );

  useInput((input, _key) => {
    if (!test) return;

    if (confirmingStop) {
      if (input === 'y' || input === 'Y') {
        setConfirmingStop(false);
        void performAction('STOPPED', 'Stopping');
      } else {
        setConfirmingStop(false);
      }
      return;
    }

    if (input === 'p' || input === 'P') {
      void performAction('PAUSED', 'Pausing');
    }

    if (input === 'r' || input === 'R') {
      void performAction('RUNNING', 'Resuming');
    }

    if (input === 's' || input === 'S') {
      setConfirmingStop(true);
      setActionMessage(null);
    }

    if (input === 'd' || input === 'D') {
      setDebugLoading(true);
      setDebugResults(null);
      void runDebugChecks(test, region)
        .then(results => {
          setDebugResults(results);
          setDebugLoading(false);
        })
        .catch(() => {
          setDebugResults([{ label: 'Debug', status: 'fail' as const, detail: 'Diagnostics failed to run' }]);
          setDebugLoading(false);
        });
    }
  });

  if (error) {
    return (
      <Screen title="AB Test" onExit={onExit} helpText="Esc exit">
        <Text color="red">{`Error: ${error}`}</Text>
      </Screen>
    );
  }

  if (!test) {
    return (
      <Screen title="AB Test" onExit={onExit} helpText="Esc exit">
        <Text dimColor>Loading...</Text>
      </Screen>
    );
  }

  const controlVariant = test.variants.find(v => v.name === 'C');
  const treatmentVariant = test.variants.find(v => v.name === 'T1');

  const executionColor =
    test.executionStatus === 'RUNNING' ? 'green' : test.executionStatus === 'PAUSED' ? 'yellow' : 'red';

  const helpKeys = 'P pause · R resume · S stop · D debug · Esc exit';

  // Build status text: only show provisioning status if not ACTIVE
  const statusPrefix = test.status !== 'ACTIVE' ? `${test.status}  ` : '';

  // TODO(post-preview): Re-enable duration display once configurable duration is launched.
  const durationText = '';

  // Column width for side-by-side variants
  const colW = 28;

  return (
    <Screen title={`AB Test: ${test.name}`} onExit={onExit} helpText={helpKeys}>
      <Box flexDirection="column" paddingX={1}>
        {/* ── Header: Line 1 — status ─────────────────────────── */}
        <Box>
          <Box flexGrow={1}>
            {statusPrefix && <Text bold>{statusPrefix}</Text>}
            <Text color={executionColor} bold>{`● ${test.executionStatus}`}</Text>
          </Box>
          {durationText && <Text dimColor>{durationText}</Text>}
        </Box>

        {/* ── Header: Line 2 — invocation URL ────────────────────── */}
        {targetName ? (
          <Box>
            <Text dimColor>{`Invocation URL: ${gatewayUrlFromArn(test.gatewayArn)}/${targetName}/invocations`}</Text>
          </Box>
        ) : (
          <Box>
            <Text dimColor>Invocation URL: loading...</Text>
          </Box>
        )}

        {/* ── Header: Line 3 — online eval ────────────────────── */}
        <Box>
          <Text dimColor>{`Online Eval: ${extractId(test.evaluationConfig.onlineEvaluationConfigArn)}`}</Text>
        </Box>

        {/* ── Description (if present) ────────────────────────── */}
        {test.description && (
          <Box>
            <Text dimColor>{`Description: ${test.description}`}</Text>
          </Box>
        )}

        {/* ── Variants: side-by-side ──────────────────────────── */}
        <Box marginTop={1}>
          <Box flexDirection="column" minWidth={colW} marginRight={2}>
            <Text bold>{'CONTROL (C)'}</Text>
            <Text color="cyan">{`${String(controlVariant?.weight ?? 'N/A')}% traffic`}</Text>
            <Text
              dimColor
            >{`${extractId(controlVariant?.variantConfiguration.configurationBundle.bundleArn ?? '')} @ ${shortVersion(controlVariant?.variantConfiguration.configurationBundle.bundleVersion ?? '')}`}</Text>
          </Box>
          <Box flexDirection="column">
            <Text bold>{'TREATMENT (T1)'}</Text>
            <Text color="cyan">{`${String(treatmentVariant?.weight ?? 'N/A')}% traffic`}</Text>
            <Text
              dimColor
            >{`${extractId(treatmentVariant?.variantConfiguration.configurationBundle.bundleArn ?? '')} @ ${shortVersion(treatmentVariant?.variantConfiguration.configurationBundle.bundleVersion ?? '')}`}</Text>
          </Box>
        </Box>

        {/* ── Evaluation Results ───────────────────────────────── */}
        <Box marginTop={1} flexDirection="column">
          {test.results ? (
            <>
              <Text dimColor>
                {rule(
                  'Results',
                  test.results.analysisTimestamp ? formatTimestamp(test.results.analysisTimestamp) : undefined
                )}
              </Text>
              <Box marginTop={1}>
                <Box minWidth={24}>
                  <Text dimColor>{''}</Text>
                </Box>
                <Box minWidth={12}>
                  <Text dimColor>{'Control'}</Text>
                </Box>
                <Box minWidth={12}>
                  <Text dimColor>{'Treatment'}</Text>
                </Box>
                <Text dimColor>{'Δ'}</Text>
              </Box>
              {test.results.evaluatorMetrics.map((metric, i) => (
                <Box key={i} flexDirection="column" marginTop={i > 0 ? 1 : 0}>
                  <Box>
                    <Box minWidth={24}>
                      <Text bold>{extractId(metric.evaluatorArn)}</Text>
                    </Box>
                    <Box minWidth={12}>
                      <Text>{metric.controlStats.mean.toFixed(4)}</Text>
                    </Box>
                    <Box minWidth={12}>
                      <Text>{metric.variantResults[0]?.mean.toFixed(4) ?? ''}</Text>
                    </Box>
                    {metric.variantResults[0]?.isSignificant ? (
                      <Text color="green">{`+${(metric.variantResults[0]?.percentChange ?? 0).toFixed(2)}% ✓`}</Text>
                    ) : (
                      <Text color="red">{`${(metric.variantResults[0]?.percentChange ?? 0).toFixed(2)}% ✗`}</Text>
                    )}
                  </Box>
                  <Box>
                    <Box minWidth={24}>
                      <Text>{''}</Text>
                    </Box>
                    <Box minWidth={12}>
                      <Text dimColor>{`n=${metric.controlStats.sampleSize}`}</Text>
                    </Box>
                    <Box minWidth={12}>
                      <Text dimColor>{`n=${metric.variantResults[0]?.sampleSize ?? ''}`}</Text>
                    </Box>
                    <Text dimColor>{`p=${metric.variantResults[0]?.pValue?.toFixed(3) ?? 'N/A'}`}</Text>
                  </Box>
                </Box>
              ))}
            </>
          ) : (
            <>
              <Text dimColor>{rule('Results')}</Text>
              <Box marginTop={1}>
                <Text dimColor>No evaluation results yet.</Text>
              </Box>
            </>
          )}
        </Box>

        {/* ── Debug Panel ─────────────────────────────────────── */}
        {debugLoading && (
          <Box marginTop={1}>
            <GradientText text="Running pipeline diagnostics..." />
          </Box>
        )}
        {debugResults && (
          <Box marginTop={1} flexDirection="column">
            <Text dimColor>{rule('Pipeline Debug')}</Text>
            {debugResults.map((check, i) => {
              const icon = check.status === 'pass' ? '✓' : check.status === 'fail' ? '✗' : '⚠';
              const color = check.status === 'pass' ? 'green' : check.status === 'fail' ? 'red' : 'yellow';
              return (
                <Box key={i}>
                  <Text color={color}>{`  ${icon} `}</Text>
                  <Text bold>{check.label}</Text>
                  <Text dimColor>{`  ${check.detail}`}</Text>
                </Box>
              );
            })}
          </Box>
        )}

        {/* ── Stop confirmation ────────────────────────────────── */}
        {confirmingStop && (
          <Box marginTop={1}>
            <Text color="yellow" bold>
              {'Stop this AB test permanently? This cannot be undone. (Y/n)'}
            </Text>
          </Box>
        )}

        {/* ── Action feedback ──────────────────────────────────── */}
        {actionMessage && !confirmingStop && (
          <Box marginTop={1}>
            <Text color="cyan">{actionMessage}</Text>
          </Box>
        )}
      </Box>
    </Screen>
  );
}
