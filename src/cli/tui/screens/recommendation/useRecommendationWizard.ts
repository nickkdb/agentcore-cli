import type {
  RecommendationInputSourceKind,
  RecommendationType,
  TraceSourceKind,
} from '../../../operations/recommendation';
import type { RecommendationStep, RecommendationWizardConfig } from './types';
import { DEFAULT_LOOKBACK_DAYS } from './types';
import { useCallback, useState } from 'react';

function getAllSteps(
  type: RecommendationType,
  inputSource: RecommendationInputSourceKind,
  traceSource: TraceSourceKind
): RecommendationStep[] {
  const steps: RecommendationStep[] = ['type', 'agent', 'evaluator', 'inputSource'];

  // Content step for inline/file; skip for config-bundle
  if (inputSource === 'inline' || inputSource === 'file') {
    steps.push('content');
  }

  // Tools step only for tool description recommendations
  if (type === 'TOOL_DESCRIPTION_RECOMMENDATION') {
    steps.push('tools');
  }

  steps.push('traceSource');

  // For tool-desc, traceSource is always 'sessions' (cloudwatch not supported server-side).
  // The effective traceSource for step logic:
  const effectiveTraceSource = type === 'TOOL_DESCRIPTION_RECOMMENDATION' ? 'sessions' : traceSource;

  if (effectiveTraceSource === 'sessions') {
    // When using session IDs: ask lookback days first (for discovery), then select sessions
    steps.push('days');
    steps.push('sessions');
  } else {
    // CloudWatch: just ask lookback days
    steps.push('days');
  }

  steps.push('confirm');
  return steps;
}

function getDefaultConfig(): RecommendationWizardConfig {
  return {
    type: 'SYSTEM_PROMPT_RECOMMENDATION',
    agent: '',
    evaluators: [],
    inputSource: 'inline',
    content: '',
    tools: '',
    traceSource: 'cloudwatch',
    days: DEFAULT_LOOKBACK_DAYS,
    sessionIds: [],
  };
}

export function useRecommendationWizard() {
  const [config, setConfig] = useState<RecommendationWizardConfig>(getDefaultConfig);
  const [step, setStep] = useState<RecommendationStep>('type');

  const allSteps = getAllSteps(config.type, config.inputSource, config.traceSource);
  const currentIndex = allSteps.indexOf(step);

  const advance = useCallback(
    (
      fromStep: RecommendationStep,
      overrides?: {
        type?: RecommendationType;
        inputSource?: RecommendationInputSourceKind;
        traceSource?: TraceSourceKind;
      }
    ) => {
      const steps = getAllSteps(
        overrides?.type ?? config.type,
        overrides?.inputSource ?? config.inputSource,
        overrides?.traceSource ?? config.traceSource
      );
      const idx = steps.indexOf(fromStep);
      const next = steps[idx + 1];
      if (next) setStep(next);
    },
    [config.type, config.inputSource, config.traceSource]
  );

  const goBack = useCallback(() => {
    const prevStep = allSteps[currentIndex - 1];
    if (prevStep) setStep(prevStep);
  }, [allSteps, currentIndex]);

  const setType = useCallback(
    (type: RecommendationType) => {
      setConfig(c => ({ ...c, type }));
      advance('type', { type });
    },
    [advance]
  );

  const setAgent = useCallback(
    (agent: string) => {
      setConfig(c => ({ ...c, agent }));
      advance('agent');
    },
    [advance]
  );

  const setEvaluators = useCallback(
    (evaluators: string[]) => {
      setConfig(c => ({ ...c, evaluators }));
      advance('evaluator');
    },
    [advance]
  );

  const setInputSource = useCallback(
    (inputSource: RecommendationInputSourceKind) => {
      setConfig(c => ({ ...c, inputSource }));
      advance('inputSource', { inputSource });
    },
    [advance]
  );

  const setContent = useCallback(
    (content: string) => {
      setConfig(c => ({ ...c, content }));
      advance('content');
    },
    [advance]
  );

  const setTools = useCallback(
    (tools: string) => {
      setConfig(c => ({ ...c, tools }));
      advance('tools');
    },
    [advance]
  );

  const setTraceSource = useCallback(
    (traceSource: TraceSourceKind) => {
      setConfig(c => ({ ...c, traceSource }));
      advance('traceSource', { traceSource });
    },
    [advance]
  );

  const setDays = useCallback(
    (days: number) => {
      setConfig(c => ({ ...c, days }));
      advance('days');
    },
    [advance]
  );

  const setSessions = useCallback(
    (sessionIds: string[]) => {
      setConfig(c => ({ ...c, sessionIds }));
      advance('sessions');
    },
    [advance]
  );

  const reset = useCallback(() => {
    setConfig(getDefaultConfig());
    setStep('type');
  }, []);

  return {
    config,
    step,
    steps: allSteps,
    currentIndex,
    goBack,
    setType,
    setAgent,
    setEvaluators,
    setInputSource,
    setContent,
    setTools,
    setTraceSource,
    setDays,
    setSessions,
    reset,
  };
}
