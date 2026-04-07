import { ConfigIO } from '../../../../lib';
import type { DeployedState } from '../../../../schema';
import { validateAwsCredentials } from '../../../aws/account';
import { listEvaluators } from '../../../aws/agentcore-control';
import { detectRegion } from '../../../aws/region';
import { getErrorMessage } from '../../../errors';
import { runRecommendationCommand } from '../../../operations/recommendation';
import type { RunRecommendationCommandResult } from '../../../operations/recommendation';
import { saveRecommendationRun } from '../../../operations/recommendation/recommendation-storage';
import { ErrorPrompt, GradientText, Panel, Screen, StepProgress } from '../../components';
import type { Step } from '../../components';
import { HELP_TEXT } from '../../constants';
import { useListNavigation } from '../../hooks';
import { RecommendationScreen } from './RecommendationScreen';
import type { AgentItem, EvaluatorItem, RecommendationWizardConfig } from './types';
import { Box, Text } from 'ink';
import React, { useCallback, useEffect, useState } from 'react';

type FlowState =
  | { name: 'loading' }
  | { name: 'wizard'; agents: AgentItem[]; evaluators: EvaluatorItem[] }
  | { name: 'running'; config: RecommendationWizardConfig; steps: Step[]; elapsed: number }
  | { name: 'results'; result: RunRecommendationCommandResult; config: RecommendationWizardConfig; filePath?: string }
  | { name: 'creds-error'; message: string }
  | { name: 'error'; message: string };

interface RecommendationFlowProps {
  onExit: () => void;
}

export function RecommendationFlow({ onExit }: RecommendationFlowProps) {
  const [flow, setFlow] = useState<FlowState>({ name: 'loading' });

  // Load agents and evaluators
  useEffect(() => {
    if (flow.name !== 'loading') return;
    let cancelled = false;

    void (async () => {
      try {
        await validateAwsCredentials();
      } catch (err) {
        if (!cancelled) setFlow({ name: 'creds-error', message: getErrorMessage(err) });
        return;
      }

      try {
        const configIO = new ConfigIO();
        const [{ region }, deployedState] = await Promise.all([detectRegion(), configIO.readDeployedState()]);

        if (cancelled) return;

        const agents = buildAgentItems(deployedState);
        if (agents.length === 0) {
          setFlow({
            name: 'error',
            message: 'No deployed agents found. Run `agentcore deploy` first.',
          });
          return;
        }

        const evalResult = await listEvaluators({ region });
        if (cancelled) return;

        const evaluators: EvaluatorItem[] = evalResult.evaluators.map(e => ({
          id: e.evaluatorArn || e.evaluatorName,
          title: e.evaluatorName,
          description: e.description ?? e.evaluatorType,
        }));

        setFlow({ name: 'wizard', agents, evaluators });
      } catch (err) {
        if (!cancelled) setFlow({ name: 'error', message: getErrorMessage(err) });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [flow.name]);

  const handleRunComplete = useCallback((config: RecommendationWizardConfig) => {
    const isToolDescWithSessions =
      config.type === 'TOOL_DESCRIPTION_RECOMMENDATION' && config.traceSource === 'sessions';

    const initialSteps: Step[] = [
      ...(isToolDescWithSessions
        ? [{ label: 'Fetching session spans from CloudWatch...', status: 'pending' as const }]
        : []),
      { label: 'Starting recommendation...', status: 'running' },
      { label: 'Polling for results', status: 'pending' },
      { label: 'Saving results', status: 'pending' },
    ];

    // If auto-fetching, the first step is active
    if (isToolDescWithSessions) {
      initialSteps[0] = { ...initialSteps[0]!, status: 'running' };
      initialSteps[1] = { ...initialSteps[1]!, status: 'pending' };
    }

    setFlow({ name: 'running', config, steps: initialSteps, elapsed: 0 });
  }, []);

  // Execute the recommendation when entering 'running' state
  useEffect(() => {
    if (flow.name !== 'running') return;
    let cancelled = false;

    const { config } = flow;
    const startTime = Date.now();

    const timer = setInterval(() => {
      if (!cancelled) {
        setFlow(prev => {
          if (prev.name !== 'running') return prev;
          return { ...prev, elapsed: Math.floor((Date.now() - startTime) / 1000) };
        });
      }
    }, 1000);

    void (async () => {
      try {
        const result = await runRecommendationCommand({
          type: config.type,
          agent: config.agent,
          evaluators: config.evaluators,
          inputSource: config.inputSource,
          inlineContent: config.inputSource === 'inline' ? config.content : undefined,
          promptFile: config.inputSource === 'file' ? config.content : undefined,
          tools: config.tools
            ? config.tools
                .split(',')
                .map(t => t.trim())
                .filter(Boolean)
            : undefined,
          traceSource: config.traceSource,
          lookbackDays: config.days,
          sessionIds: config.sessionIds.length > 0 ? config.sessionIds : undefined,
          onProgress: (status, _message) => {
            if (cancelled) return;
            const hasFetchStep = config.type === 'TOOL_DESCRIPTION_RECOMMENDATION' && config.traceSource === 'sessions';
            const offset = hasFetchStep ? 1 : 0;

            setFlow(prev => {
              if (prev.name !== 'running') return prev;
              const steps = [...prev.steps];
              if (status === 'fetching-spans') {
                steps[0] = { ...steps[0]!, status: 'running' };
              } else if (status === 'starting') {
                if (hasFetchStep) steps[0] = { ...steps[0]!, status: 'success' };
                steps[offset] = { ...steps[offset]!, status: 'running' };
              } else if (status === 'started' || status === 'polling') {
                steps[offset] = { ...steps[offset]!, status: 'success' };
                steps[offset + 1] = { ...steps[offset + 1]!, status: 'running' };
              }
              return { ...prev, steps };
            });
          },
        });

        clearInterval(timer);
        if (cancelled) return;

        if (!result.success) {
          setFlow(prev => {
            if (prev.name !== 'running') return prev;
            const steps = prev.steps.map(s =>
              s.status === 'running' ? { ...s, status: 'error' as const, error: result.error } : s
            );
            return { ...prev, steps };
          });
          await new Promise(resolve => setTimeout(resolve, 2000));
          if (cancelled) return;
          setFlow({ name: 'error', message: result.error ?? 'Recommendation failed' });
          return;
        }

        // Mark polling success, saving running
        const hasFetchStep = config.type === 'TOOL_DESCRIPTION_RECOMMENDATION' && config.traceSource === 'sessions';
        const offset = hasFetchStep ? 1 : 0;

        setFlow(prev => {
          if (prev.name !== 'running') return prev;
          const steps = [...prev.steps];
          steps[offset + 1] = { ...steps[offset + 1]!, status: 'success' };
          steps[offset + 2] = { ...steps[offset + 2]!, status: 'running' };
          return { ...prev, steps };
        });

        // Save results locally
        let filePath: string | undefined;
        try {
          if (result.recommendationId) {
            filePath = saveRecommendationRun(
              result.recommendationId,
              result,
              config.type,
              config.agent,
              config.evaluators
            );
          }
        } catch {
          // Non-fatal
        }

        setFlow({ name: 'results', result, config, filePath });
      } catch (err) {
        clearInterval(timer);
        if (!cancelled) {
          const errorMsg = getErrorMessage(err);
          setFlow(prev => {
            if (prev.name !== 'running') return prev;
            const steps = prev.steps.map(s =>
              s.status === 'running' ? { ...s, status: 'error' as const, error: errorMsg } : s
            );
            return { ...prev, steps };
          });
          await new Promise(resolve => setTimeout(resolve, 2000));
          setFlow({ name: 'error', message: errorMsg });
        }
      }
    })();

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [flow.name]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render states ─────────────────────────────────────────────────────────

  if (flow.name === 'loading') {
    return (
      <Screen title="Run Recommendation" onExit={onExit}>
        <GradientText text="Loading agents and evaluators..." />
      </Screen>
    );
  }

  if (flow.name === 'creds-error') {
    return <ErrorPrompt message="AWS credentials required" detail={flow.message} onBack={onExit} onExit={onExit} />;
  }

  if (flow.name === 'wizard') {
    return (
      <RecommendationScreen
        agents={flow.agents}
        evaluators={flow.evaluators}
        onComplete={handleRunComplete}
        onExit={onExit}
      />
    );
  }

  if (flow.name === 'running') {
    const minutes = Math.floor(flow.elapsed / 60);
    const seconds = flow.elapsed % 60;
    const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

    return (
      <Screen title="Run Recommendation" onExit={onExit}>
        <Panel>
          <Box flexDirection="column" gap={1}>
            <Text>
              <Text bold>Agent:</Text> {flow.config.agent}
              {'  '}
              <Text bold>Evaluator(s):</Text>{' '}
              {flow.config.evaluators.map(e => (e.includes('/') ? e.split('/').pop()! : e)).join(', ')}
              {'  '}
              <Text dimColor>({timeStr})</Text>
            </Text>
            <StepProgress steps={flow.steps} />
          </Box>
        </Panel>
      </Screen>
    );
  }

  if (flow.name === 'results') {
    return (
      <ResultsView
        result={flow.result}
        config={flow.config}
        filePath={flow.filePath}
        onRunAnother={() => setFlow({ name: 'loading' })}
        onExit={onExit}
      />
    );
  }

  return (
    <ErrorPrompt
      message="Recommendation failed"
      detail={flow.message}
      onBack={() => setFlow({ name: 'loading' })}
      onExit={onExit}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Results view
// ─────────────────────────────────────────────────────────────────────────────

interface ResultsViewProps {
  result: RunRecommendationCommandResult;
  config: RecommendationWizardConfig;
  filePath?: string;
  onRunAnother: () => void;
  onExit: () => void;
}

function ResultsView({ result, config, filePath, onRunAnother, onExit }: ResultsViewProps) {
  const actions = [
    { id: 'another', title: 'Run another recommendation' },
    { id: 'back', title: 'Back' },
  ];

  const nav = useListNavigation({
    items: actions,
    onSelect: item => {
      if (item.id === 'another') onRunAnother();
      else onExit();
    },
    onExit,
    isActive: true,
  });

  const sysResult = result.result?.systemPromptRecommendationResult;
  const toolResult = result.result?.toolDescriptionRecommendationResult;

  return (
    <Screen title="Recommendation Complete" onExit={onExit} helpText={HELP_TEXT.NAVIGATE_SELECT} exitEnabled={false}>
      <Panel fullWidth>
        <Box flexDirection="column">
          <Text color="green">✓ Recommendation complete</Text>
          <Text>
            <Text bold>ID:</Text> {result.recommendationId}
            {'  '}
            <Text bold>Agent:</Text> {config.agent}
          </Text>

          {sysResult && (
            <Box marginTop={1} flexDirection="column">
              {sysResult.explanation && (
                <Text>
                  <Text bold>What changed:</Text> {sysResult.explanation}
                </Text>
              )}
              {sysResult.recommendedSystemPrompt && (
                <Box marginTop={1} flexDirection="column">
                  <Text bold color="cyan">
                    Recommended System Prompt:
                  </Text>
                  <Box marginLeft={2} marginTop={1}>
                    <Text>{sysResult.recommendedSystemPrompt}</Text>
                  </Box>
                </Box>
              )}
            </Box>
          )}

          {toolResult?.tools && toolResult.tools.length > 0 && (
            <Box marginTop={1} flexDirection="column">
              <Text bold color="cyan">
                Recommended Tool Descriptions:
              </Text>
              {toolResult.tools.map(tool => (
                <Box key={tool.toolName} marginTop={1} marginLeft={2} flexDirection="column">
                  <Text bold>{tool.toolName}</Text>
                  <Text dimColor>Explanation: {tool.explanation}</Text>
                  <Text>{tool.recommendedToolDescription}</Text>
                </Box>
              ))}
            </Box>
          )}

          {!sysResult && !toolResult && (
            <Box marginTop={1}>
              <Text dimColor>No recommendation results returned.</Text>
            </Box>
          )}

          {filePath && (
            <Box marginTop={1}>
              <Text dimColor>Results saved to: {filePath}</Text>
            </Box>
          )}

          <Box marginTop={1} flexDirection="column">
            {actions.map((action, idx) => {
              const selected = idx === nav.selectedIndex;
              return (
                <Text key={action.id}>
                  <Text color={selected ? 'cyan' : undefined}>{selected ? '❯' : ' '} </Text>
                  <Text color={selected ? 'cyan' : undefined} bold={selected}>
                    {action.title}
                  </Text>
                </Text>
              );
            })}
          </Box>
        </Box>
      </Panel>
    </Screen>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function buildAgentItems(deployedState: DeployedState): AgentItem[] {
  const agents: AgentItem[] = [];
  const seen = new Set<string>();

  for (const target of Object.values(deployedState.targets)) {
    const runtimeMap = target.resources?.runtimes;
    if (!runtimeMap) continue;
    for (const [name, state] of Object.entries(runtimeMap)) {
      if (seen.has(name)) continue;
      seen.add(name);
      agents.push({ name, runtimeId: state.runtimeId, runtimeArn: state.runtimeArn });
    }
  }

  return agents;
}
