/**
 * AWS client wrappers for BatchEvaluation operations.
 *
 * The BatchEvaluation API is a flat, stateless model — no persistent "job" resource.
 * Each batch evaluation is started, polled, and optionally stopped.
 *
 * Endpoints:
 *   POST   /evaluations/batch-evaluate                       → StartBatchEvaluation
 *   GET    /evaluations/batch-evaluate/{batchEvaluationId}    → GetBatchEvaluation
 *   GET    /evaluations/batch-evaluate                        → ListBatchEvaluations
 *   POST   /evaluations/batch-evaluate/{batchEvaluationId}/stop → StopBatchEvaluation
 *   DELETE /evaluations/batch-evaluate/{batchEvaluationId}    → DeleteBatchEvaluation
 *
 * Uses direct HTTP requests with SigV4 signing (service: bedrock-agentcore).
 *
 * LEGACY FALLBACK: The API is migrating from an old schema to a new one.
 * Each operation tries the new schema first, then falls back to the legacy
 * schema on error. Search for "LEGACY FALLBACK" to find all fallback code
 * to remove once the migration is complete.
 */
import { getCredentialProvider } from './account';
import { Sha256 } from '@aws-crypto/sha256-js';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { HttpRequest } from '@smithy/protocol-http';
import { SignatureV4 } from '@smithy/signature-v4';

// ============================================================================
// Types (new schema)
// ============================================================================

export interface SessionFilterConfig {
  startTime?: string;
  endTime?: string;
}

export interface CloudWatchFilterConfig {
  sessionIds?: string[];
  timeRange?: SessionFilterConfig;
}

export interface CloudWatchLogsSource {
  serviceNames: string[];
  logGroupNames: string[];
  filterConfig?: CloudWatchFilterConfig;
}

export interface DataSourceConfig {
  cloudWatchLogs?: CloudWatchLogsSource;
  onlineEvaluationConfigSource?: Record<string, unknown>;
}

export interface Evaluator {
  evaluatorId: string;
}

export interface GroundTruthAssertion {
  text: string;
}

export interface GroundTruthTurnInput {
  prompt: string;
}

export interface GroundTruthTurnExpectedResponse {
  text: string;
}

export interface GroundTruthTurn {
  input: GroundTruthTurnInput;
  expectedResponse: GroundTruthTurnExpectedResponse;
}

export interface ExpectedTrajectory {
  toolNames: string[];
}

export interface InlineGroundTruth {
  assertions?: GroundTruthAssertion[];
  expectedTrajectory?: ExpectedTrajectory;
  turns?: GroundTruthTurn[];
}

export interface GroundTruth {
  inline: InlineGroundTruth;
}

export interface SessionMetadataEntry {
  sessionId: string;
  testScenarioId?: string;
  groundTruth?: GroundTruth;
  metadata?: Record<string, string>;
}

export interface EvaluationMetadata {
  sessionMetadata?: SessionMetadataEntry[];
}

export interface StartBatchEvaluationOptions {
  region: string;
  name: string;
  evaluators: Evaluator[];
  dataSourceConfig: DataSourceConfig;
  evaluationMetadata?: EvaluationMetadata;
  description?: string;
  clientToken?: string;
}

export interface StartBatchEvaluationResult {
  batchEvaluationId: string;
  batchEvaluationArn: string;
  name: string;
  status: string;
  createdAt?: string;
}

export interface GetBatchEvaluationOptions {
  region: string;
  batchEvaluationId: string;
}

export interface CloudWatchOutputConfig {
  logGroupName: string;
  logStreamName: string;
}

export interface OutputConfig {
  cloudWatchConfig?: CloudWatchOutputConfig;
}

export interface EvaluatorSummary {
  evaluatorId: string;
  statistics?: {
    averageScore?: number;
    averageTokenUsage?: {
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
    };
  };
  totalEvaluated?: number;
  totalFailed?: number;
}

export interface EvaluationResults {
  evaluatorSummaries?: EvaluatorSummary[];
  numberOfSessionsCompleted?: number;
  numberOfSessionsFailed?: number;
  numberOfSessionsInProgress?: number;
  totalNumberOfSessions?: number;
  numberOfSessionsIgnored?: number;
}

export interface GetBatchEvaluationResult {
  batchEvaluationId: string;
  batchEvaluationArn: string;
  name: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  evaluators?: Evaluator[];
  dataSourceConfig?: DataSourceConfig;
  outputConfig?: OutputConfig;
  evaluationResults?: EvaluationResults;
  errorDetails?: string[];
  description?: string;
  tags?: Record<string, string>;
}

export interface BatchEvaluationResultEntry {
  evaluatorId: string;
  score?: number;
  label?: string;
  explanation?: string;
  error?: string;
}

export interface ListBatchEvaluationsOptions {
  region: string;
  maxResults?: number;
  nextToken?: string;
}

export interface BatchEvaluationSummary {
  batchEvaluationId: string;
  batchEvaluationArn: string;
  name: string;
  status: string;
  createdAt?: string;
  description?: string;
  evaluators?: Evaluator[];
  evaluationResults?: EvaluationResults;
  errorDetails?: string[];
}

export interface ListBatchEvaluationsResult {
  batchEvaluations: BatchEvaluationSummary[];
  nextToken?: string;
}

export interface StopBatchEvaluationOptions {
  region: string;
  batchEvaluationId: string;
}

export interface StopBatchEvaluationResult {
  batchEvaluationId: string;
  batchEvaluationArn: string;
  status: string;
  description?: string;
}

export interface DeleteBatchEvaluationOptions {
  region: string;
  batchEvaluationId: string;
}

export interface DeleteBatchEvaluationResult {
  batchEvaluationId: string;
  batchEvaluationArn: string;
  status: string;
}

// ============================================================================
// HTTP signing helper
// ============================================================================

function getEndpoint(region: string): string {
  const stage = process.env.AGENTCORE_STAGE?.toLowerCase();
  if (stage === 'beta') return `https://beta.${region}.elcapdp.genesis-primitives.aws.dev`;
  if (stage === 'gamma') return `https://gamma.${region}.elcapdp.genesis-primitives.aws.dev`;
  return `https://bedrock-agentcore.${region}.amazonaws.com`;
}

async function signedRequest(options: {
  region: string;
  method: string;
  path: string;
  body?: string;
}): Promise<{ data: unknown; status: number }> {
  const { region, method, path, body } = options;
  const endpoint = getEndpoint(region);
  const url = new URL(path, endpoint);

  const request = new HttpRequest({
    method,
    protocol: 'https:',
    hostname: url.hostname,
    path: url.pathname + url.search,
    headers: {
      'Content-Type': 'application/json',
      host: url.hostname,
    },
    ...(body && { body }),
  });

  const credentials = getCredentialProvider() ?? defaultProvider();
  const signer = new SignatureV4({
    service: 'bedrock-agentcore',
    region,
    credentials,
    sha256: Sha256,
  });

  const signedReq = await signer.sign(request);

  const response = await fetch(`${endpoint}${url.pathname}${url.search}`, {
    method,
    headers: signedReq.headers as Record<string, string>,
    ...(body && { body }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`BatchEvaluation API error (${response.status}): ${errorBody}`);
  }

  if (response.status === 204) return { data: {}, status: 204 };
  return { data: await response.json(), status: response.status };
}

// ============================================================================
// LEGACY FALLBACK — remove this entire section when API migration is complete
//
// The API is transitioning from an old schema to a new one. These helpers
// convert between the two so the CLI works against both old and new backends.
//
// Old schema differences:
//   - Request:  sessionSource.cloudWatchSource       → dataSourceConfig.cloudWatchLogs
//   - Request:  cloudWatchSource.sessionInput         → cloudWatchLogs.filterConfig
//   - Request:  sessionInput.sessionFilterConfig      → filterConfig.timeRange
//   - Request:  evaluationConfig: { evaluators }      → evaluators (top-level)
//   - Request:  sessionMetadata (top-level)           → evaluationMetadata.sessionMetadata
//   - Response: batchEvaluateId                       → batchEvaluationId
//   - Response: outputDataConfig.cloudWatchDestination → outputConfig.cloudWatchConfig
//   - Response: sessionsCompleted                     → numberOfSessionsCompleted (etc.)
// ============================================================================

function isLegacyFallbackError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.message.includes('(400)') || err.message.includes('(422)');
}

function toLegacyStartBody(options: StartBatchEvaluationOptions): string {
  const cw = options.dataSourceConfig.cloudWatchLogs;
  const legacySessionInput = cw?.filterConfig
    ? {
        ...(cw.filterConfig.sessionIds ? { sessionIds: cw.filterConfig.sessionIds } : {}),
        ...(cw.filterConfig.timeRange ? { sessionFilterConfig: cw.filterConfig.timeRange } : {}),
      }
    : undefined;

  const body: Record<string, unknown> = {
    name: options.name,
    evaluationConfig: {
      evaluators: options.evaluators,
    },
    sessionSource: {
      cloudWatchSource: {
        serviceNames: cw?.serviceNames ?? [],
        logGroupNames: cw?.logGroupNames ?? [],
        ...(legacySessionInput ? { sessionInput: legacySessionInput } : {}),
      },
    },
  };

  if (options.evaluationMetadata) {
    body.evaluationMetadata = options.evaluationMetadata;
  }
  if (options.clientToken) body.clientToken = options.clientToken;

  return JSON.stringify(body);
}

function normalizeStartResult(raw: Record<string, unknown>): StartBatchEvaluationResult {
  return {
    batchEvaluationId: (raw.batchEvaluationId ?? raw.batchEvaluateId ?? '') as string,
    batchEvaluationArn: (raw.batchEvaluationArn ?? raw.bundleArn ?? '') as string,
    name: (raw.batchEvaluationName ?? raw.name ?? '') as string,
    status: (raw.status ?? '') as string,
    createdAt: raw.createdAt as string | undefined,
  };
}

function normalizeGetResult(raw: Record<string, unknown>): GetBatchEvaluationResult {
  const id = (raw.batchEvaluationId ?? raw.batchEvaluateId ?? '') as string;

  // LEGACY FALLBACK: normalize outputDataConfig.cloudWatchDestination → outputConfig.cloudWatchConfig
  let outputConfig = raw.outputConfig as OutputConfig | undefined;
  if (!outputConfig) {
    const legacyOutput = raw.outputDataConfig as Record<string, unknown> | undefined;
    const legacyCw = legacyOutput?.cloudWatchDestination as CloudWatchOutputConfig | undefined;
    if (legacyCw) {
      outputConfig = { cloudWatchConfig: legacyCw };
    }
  }

  // LEGACY FALLBACK: normalize old evaluationResults field names
  let evaluationResults = raw.evaluationResults as EvaluationResults | undefined;
  if (evaluationResults) {
    const er = evaluationResults as Record<string, unknown>;
    evaluationResults = {
      evaluatorSummaries: (er.evaluatorSummaries ?? er.evaluatorSummaries) as EvaluatorSummary[] | undefined,
      numberOfSessionsCompleted: (er.numberOfSessionsCompleted ?? er.sessionsCompleted) as number | undefined,
      numberOfSessionsFailed: (er.numberOfSessionsFailed ?? er.sessionsFailed) as number | undefined,
      numberOfSessionsInProgress: (er.numberOfSessionsInProgress ?? er.sessionsInProgress) as number | undefined,
      totalNumberOfSessions: (er.totalNumberOfSessions ?? er.totalSessions) as number | undefined,
      numberOfSessionsIgnored: er.numberOfSessionsIgnored as number | undefined,
    };
  }

  return {
    batchEvaluationId: id,
    batchEvaluationArn: (raw.batchEvaluationArn ?? '') as string,
    name: (raw.batchEvaluationName ?? raw.name ?? '') as string,
    status: (raw.status ?? '') as string,
    createdAt: raw.createdAt as string | undefined,
    updatedAt: raw.updatedAt as string | undefined,
    evaluators: raw.evaluators as Evaluator[] | undefined,

    dataSourceConfig: raw.dataSourceConfig as DataSourceConfig | undefined,
    outputConfig,
    evaluationResults,
    errorDetails: (raw.errorDetails ?? raw.statusReasons) as string[] | undefined,
    description: raw.description as string | undefined,
    tags: raw.tags as Record<string, string> | undefined,
  };
}

function normalizeStopResult(raw: Record<string, unknown>): StopBatchEvaluationResult {
  return {
    batchEvaluationId: (raw.batchEvaluationId ?? raw.batchEvaluateId ?? '') as string,
    batchEvaluationArn: (raw.batchEvaluationArn ?? '') as string,
    status: (raw.status ?? '') as string,
    description: raw.description as string | undefined,
  };
}

function normalizeSummary(raw: Record<string, unknown>): BatchEvaluationSummary {
  return {
    batchEvaluationId: (raw.batchEvaluationId ?? raw.batchEvaluateId ?? '') as string,
    batchEvaluationArn: (raw.batchEvaluationArn ?? '') as string,
    name: (raw.batchEvaluationName ?? raw.name ?? '') as string,
    status: (raw.status ?? '') as string,
    createdAt: raw.createdAt as string | undefined,
    description: raw.description as string | undefined,
    evaluators: raw.evaluators as Evaluator[] | undefined,

    evaluationResults: raw.evaluationResults as EvaluationResults | undefined,
    errorDetails: raw.errorDetails as string[] | undefined,
  };
}

// ============================================================================
// API Operations
// ============================================================================

/**
 * Start a batch evaluation (async — returns immediately with an ID to poll).
 */
export async function startBatchEvaluation(options: StartBatchEvaluationOptions): Promise<StartBatchEvaluationResult> {
  const body: Record<string, unknown> = {
    batchEvaluationName: options.name,
    evaluators: options.evaluators,
    dataSourceConfig: options.dataSourceConfig,
  };
  if (options.evaluationMetadata) {
    body.evaluationMetadata = options.evaluationMetadata;
  }
  if (options.description) {
    body.description = options.description;
  }
  if (options.clientToken) {
    body.clientToken = options.clientToken;
  }

  try {
    const { data } = await signedRequest({
      region: options.region,
      method: 'POST',
      path: '/evaluations/batch-evaluate',
      body: JSON.stringify(body),
    });
    return normalizeStartResult(data as Record<string, unknown>);
  } catch (err) {
    // LEGACY FALLBACK: if new schema rejected, retry with old schema
    if (isLegacyFallbackError(err)) {
      console.error('[batch-eval] New API schema rejected — retrying with legacy schema (temporary fallback)');
      const { data } = await signedRequest({
        region: options.region,
        method: 'POST',
        path: '/evaluations/batch-evaluate',
        body: toLegacyStartBody(options),
      });
      return normalizeStartResult(data as Record<string, unknown>);
    }
    throw err;
  }
}

/**
 * Get status and results of a batch evaluation.
 */
export async function getBatchEvaluation(options: GetBatchEvaluationOptions): Promise<GetBatchEvaluationResult> {
  const { data } = await signedRequest({
    region: options.region,
    method: 'GET',
    path: `/evaluations/batch-evaluate/${options.batchEvaluationId}`,
  });

  return normalizeGetResult(data as Record<string, unknown>);
}

/**
 * List batch evaluations.
 */
export async function listBatchEvaluations(options: ListBatchEvaluationsOptions): Promise<ListBatchEvaluationsResult> {
  const params = new URLSearchParams();
  if (options.maxResults) params.set('maxResults', String(options.maxResults));
  if (options.nextToken) params.set('nextToken', options.nextToken);

  const query = params.toString();
  const path = `/evaluations/batch-evaluate${query ? `?${query}` : ''}`;

  const { data } = await signedRequest({
    region: options.region,
    method: 'GET',
    path,
  });

  const result = data as { batchEvaluations?: Record<string, unknown>[]; nextToken?: string };
  return {
    batchEvaluations: (result.batchEvaluations ?? []).map(normalizeSummary),
    nextToken: result.nextToken,
  };
}

/**
 * Stop a running batch evaluation.
 */
export async function stopBatchEvaluation(options: StopBatchEvaluationOptions): Promise<StopBatchEvaluationResult> {
  const { data } = await signedRequest({
    region: options.region,
    method: 'POST',
    path: `/evaluations/batch-evaluate/${options.batchEvaluationId}/stop`,
  });

  return normalizeStopResult(data as Record<string, unknown>);
}

/**
 * Delete a batch evaluation.
 */
export async function deleteBatchEvaluation(
  options: DeleteBatchEvaluationOptions
): Promise<DeleteBatchEvaluationResult> {
  const { data } = await signedRequest({
    region: options.region,
    method: 'DELETE',
    path: `/evaluations/batch-evaluate/${options.batchEvaluationId}`,
  });

  const raw = data as Record<string, unknown>;
  return {
    batchEvaluationId: (raw.batchEvaluationId ?? raw.batchEvaluateId ?? '') as string,
    batchEvaluationArn: (raw.batchEvaluationArn ?? '') as string,
    status: (raw.status ?? '') as string,
  };
}

/**
 * Generate a client token for idempotency.
 */
export function generateClientToken(): string {
  return crypto.randomUUID();
}
