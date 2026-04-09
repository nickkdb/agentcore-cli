import type {
  RecommendationInputSourceKind,
  RecommendationType,
  TraceSourceKind,
} from '../../../operations/recommendation';

export type RecommendationStep =
  | 'type'
  | 'agent'
  | 'evaluator'
  | 'inputSource'
  | 'content'
  | 'bundle'
  | 'bundleField'
  | 'tools'
  | 'traceSource'
  | 'days'
  | 'sessions'
  | 'confirm';

export interface RecommendationWizardConfig {
  type: RecommendationType;
  agent: string;
  evaluators: string[];
  inputSource: RecommendationInputSourceKind;
  content: string;
  tools: string;
  traceSource: TraceSourceKind;
  days: number;
  sessionIds: string[];
  bundleName: string;
  bundleVersion: string;
  bundleFields: string[];
}

export const RECOMMENDATION_STEP_LABELS: Record<RecommendationStep, string> = {
  type: 'Type',
  agent: 'Agent',
  evaluator: 'Evaluator',
  inputSource: 'Source',
  content: 'Content',
  bundle: 'Bundle',
  bundleField: 'Fields',
  tools: 'Tools',
  traceSource: 'Traces',
  days: 'Lookback',
  sessions: 'Sessions',
  confirm: 'Confirm',
};

export const DEFAULT_LOOKBACK_DAYS = 7;

export interface AgentItem {
  name: string;
  runtimeId: string;
  runtimeArn: string;
}

export interface EvaluatorItem {
  id: string;
  title: string;
  description: string;
}

export interface ConfigBundleItem {
  name: string;
  bundleId: string;
  bundleArn: string;
  versionId: string;
  /** All string-valued configuration fields across components, keyed by field name. */
  stringFields: Record<string, string>;
}
