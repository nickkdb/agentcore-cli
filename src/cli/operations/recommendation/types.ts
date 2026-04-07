/**
 * Shared types for the recommendation feature.
 */
import type { RecommendationResult, RecommendationType } from '../../aws/agentcore-recommendation';

export type { RecommendationType } from '../../aws/agentcore-recommendation';

/** CLI-facing input source kind (maps to API config shape). */
export type RecommendationInputSourceKind = 'config-bundle' | 'inline' | 'file';

/** CLI-facing trace source kind (maps to API agentTraces shape). */
export type TraceSourceKind = 'cloudwatch' | 'sessions' | 'spans-file';

export interface RunRecommendationCommandOptions {
  /** What to optimize */
  type: RecommendationType;
  /** Agent name (from project) */
  agent: string;
  /** Evaluator names, Builtin.* IDs, or ARNs */
  evaluators: string[];
  /** Input source kind */
  inputSource: RecommendationInputSourceKind;
  /** Config bundle name (when inputSource is 'config-bundle') */
  bundleName?: string;
  /** Config bundle version (when inputSource is 'config-bundle') */
  bundleVersion?: string;
  /** Inline content (when inputSource is 'inline') */
  inlineContent?: string;
  /** File path (when inputSource is 'file') */
  promptFile?: string;
  /** Specific tool names and descriptions (for TOOL_DESCRIPTION_RECOMMENDATION) */
  tools?: string[];
  /** Trace source kind */
  traceSource: TraceSourceKind;
  /** Lookback days (when traceSource is 'cloudwatch') */
  lookbackDays?: number;
  /** Session IDs (when traceSource is 'sessions') — used to filter CloudWatch traces */
  sessionIds?: string[];
  /** Path to JSON file containing session spans (when traceSource is 'spans-file') */
  spansFile?: string;
  /** Region override */
  region?: string;
  /** Optional recommendation name */
  recommendationName?: string;
  /** Poll interval in ms */
  pollIntervalMs?: number;
  /** Max polling duration in ms before timing out */
  maxPollDurationMs?: number;
  /** Progress callback */
  onProgress?: (status: string, message: string) => void;
}

export interface RunRecommendationCommandResult {
  success: boolean;
  error?: string;
  recommendationId?: string;
  status?: string;
  /** The recommendation result from the API (populated on COMPLETED) */
  result?: RecommendationResult;
  startedAt?: string;
  completedAt?: string;
  /** Path to the execution log file */
  logFilePath?: string;
}
