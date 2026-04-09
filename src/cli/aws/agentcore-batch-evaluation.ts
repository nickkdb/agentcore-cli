/**
 * AWS client wrappers for BatchEvaluation operations.
 *
 * The BatchEvaluation API is a flat, stateless model — no persistent "job" resource.
 * Each batch evaluation is started, polled, and optionally stopped.
 *
 * Endpoints:
 *   POST   /evaluations/batch-evaluate              → StartBatchEvaluation
 *   GET    /evaluations/batch-evaluate/{id}          → GetBatchEvaluation
 *   GET    /evaluations/batch-evaluate               → ListBatchEvaluations
 *   POST   /evaluations/batch-evaluate/{id}/stop     → StopBatchEvaluation
 *
 * Uses direct HTTP requests with SigV4 signing (service: bedrock-agentcore).
 */
import { getCredentialProvider } from './account';
import { Sha256 } from '@aws-crypto/sha256-js';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { HttpRequest } from '@smithy/protocol-http';
import { SignatureV4 } from '@smithy/signature-v4';

// ============================================================================
// Types
// ============================================================================

export interface SessionFilterConfig {
  startTime?: string;
  endTime?: string;
}

export interface CloudWatchSessionInput {
  sessionIds?: string[];
  sessionFilterConfig?: SessionFilterConfig;
}

export interface CloudWatchSource {
  serviceNames: string[];
  logGroupNames: string[];
  sessionInput?: CloudWatchSessionInput;
}

export interface BatchEvaluationConfig {
  evaluators: { evaluatorId: string }[];
}

export interface StartBatchEvaluationOptions {
  region: string;
  name: string;
  evaluationConfig: BatchEvaluationConfig;
  sessionSource: {
    cloudWatchSource: CloudWatchSource;
  };
  executionRoleArn?: string;
  clientToken?: string;
}

export interface StartBatchEvaluationResult {
  batchEvaluateId: string;
  name: string;
  status: string;
  createdAt?: string;
}

export interface GetBatchEvaluationOptions {
  region: string;
  batchEvaluateId: string;
}

export interface GetBatchEvaluationResult {
  batchEvaluateId: string;
  name: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  evaluationConfig?: BatchEvaluationConfig;
  sessionSource?: {
    cloudWatchSource?: CloudWatchSource;
  };
  outputDataConfig?: {
    cloudWatchDestination?: {
      logGroupName: string;
      logStreamName: string;
    };
  };
  evaluationResults?: EvaluationResults;
  results?: BatchEvaluationResultEntry[];
  errorDetails?: string[];
  statusReasons?: string[];
}

export interface BatchEvaluationResultEntry {
  evaluatorId: string;
  score?: number;
  label?: string;
  explanation?: string;
  error?: string;
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
  sessionsCompleted?: number;
  sessionsFailed?: number;
  sessionsInProgress?: number;
  totalSessions?: number;
}

export interface ListBatchEvaluationsOptions {
  region: string;
  maxResults?: number;
  nextToken?: string;
}

export interface BatchEvaluationSummary {
  batchEvaluateId: string;
  name: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ListBatchEvaluationsResult {
  batchEvaluations: BatchEvaluationSummary[];
  nextToken?: string;
}

export interface StopBatchEvaluationOptions {
  region: string;
  batchEvaluateId: string;
}

export interface StopBatchEvaluationResult {
  batchEvaluateId: string;
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
// API Operations
// ============================================================================

/**
 * Start a batch evaluation (async — returns immediately with an ID to poll).
 */
export async function startBatchEvaluation(options: StartBatchEvaluationOptions): Promise<StartBatchEvaluationResult> {
  const body: Record<string, unknown> = {
    name: options.name,
    evaluationConfig: options.evaluationConfig,
    sessionSource: options.sessionSource,
  };
  if (options.executionRoleArn) {
    body.executionRoleArn = options.executionRoleArn;
  }
  if (options.clientToken) {
    body.clientToken = options.clientToken;
  }

  const { data } = await signedRequest({
    region: options.region,
    method: 'POST',
    path: '/evaluations/batch-evaluate',
    body: JSON.stringify(body),
  });

  return data as StartBatchEvaluationResult;
}

/**
 * Get status and results of a batch evaluation.
 */
export async function getBatchEvaluation(options: GetBatchEvaluationOptions): Promise<GetBatchEvaluationResult> {
  const { data } = await signedRequest({
    region: options.region,
    method: 'GET',
    path: `/evaluations/batch-evaluate/${options.batchEvaluateId}`,
  });

  return data as GetBatchEvaluationResult;
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

  const result = data as ListBatchEvaluationsResult;
  return {
    batchEvaluations: result.batchEvaluations ?? [],
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
    path: `/evaluations/batch-evaluate/${options.batchEvaluateId}/stop`,
  });

  return data as StopBatchEvaluationResult;
}

/**
 * Generate a client token for idempotency.
 */
export function generateClientToken(): string {
  return crypto.randomUUID();
}
