import { getABTest, updateABTest } from '../../../aws/agentcore-ab-tests';
import type { GetABTestResult } from '../../../aws/agentcore-ab-tests';
import { getErrorMessage } from '../../../errors';
import { Screen } from '../../components';
import { Box, Text, useInput } from 'ink';
import React, { useCallback, useEffect, useRef, useState } from 'react';

interface ABTestDetailScreenProps {
  abTestId: string;
  region: string;
  onExit: () => void;
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

/** Pad a string to a fixed width. */
function pad(str: string, width: number): string {
  return str.length >= width ? str : str + ' '.repeat(width - str.length);
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

export function ABTestDetailScreen({ abTestId, region, onExit }: ABTestDetailScreenProps) {
  const [test, setTest] = useState<GetABTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [confirmingStop, setConfirmingStop] = useState(false);

  const hasFetched = useRef(false);
  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;
    const load = async () => {
      try {
        const result = await getABTest({ region, abTestId });
        setTest(result);
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

  const helpKeys = 'P pause · R resume · S stop · Esc exit';

  // Build status text: only show provisioning status if not ACTIVE
  const statusPrefix = test.status !== 'ACTIVE' ? `${test.status}  ` : '';

  // Duration text
  const durationText = test.maxDurationDays ? `${test.maxDurationDays} day max` : '';

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

        {/* ── Header: Line 2 — gateway ────────────────────────── */}
        <Box>
          <Text dimColor>{`Gateway: ${extractId(test.gatewayArn)}`}</Text>
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
              <Text dimColor>{rule('Results', test.results.analysisTimestamp)}</Text>
              <Box marginTop={1}>
                <Text dimColor>{`${pad('', 15)}${pad('Control', 12)}${pad('Treatment', 12)}Δ`}</Text>
              </Box>
              {test.results.evaluatorMetrics.map((metric, i) => (
                <Box key={i} flexDirection="column" marginTop={i > 0 ? 1 : 0}>
                  <Box>
                    <Text bold>{pad(extractId(metric.evaluatorArn), 15)}</Text>
                    <Text>{pad(metric.controlStats.mean.toFixed(4), 12)}</Text>
                    <Text>{pad(metric.variantResults[0]?.mean.toFixed(4) ?? '', 12)}</Text>
                    {metric.variantResults[0]?.isSignificant ? (
                      <Text color="green">{`+${(metric.variantResults[0]?.percentChange ?? 0).toFixed(2)}% ✓`}</Text>
                    ) : (
                      <Text color="red">{`${(metric.variantResults[0]?.percentChange ?? 0).toFixed(2)}% ✗`}</Text>
                    )}
                  </Box>
                  <Box>
                    <Text dimColor>{pad('', 15)}</Text>
                    <Text dimColor>{pad(`n=${metric.controlStats.sampleSize}`, 12)}</Text>
                    <Text dimColor>{pad(`n=${metric.variantResults[0]?.sampleSize ?? ''}`, 12)}</Text>
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
