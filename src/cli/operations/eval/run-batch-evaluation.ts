/**
 * Orchestrates running a BatchEvaluation:
 *   1. Resolve agent from deployed state (for serviceNames / logGroupNames)
 *   2. Build evaluationConfig + sessionSource
 *   3. Call StartBatchEvaluation
 *   4. Poll GetBatchEvaluation until terminal status
 *   5. Return results
 */
import { ConfigIO } from '../../../lib';
import type { DeployedState } from '../../../schema';
import { generateClientToken, getBatchEvaluation, startBatchEvaluation } from '../../aws/agentcore-batch-evaluation';
import type { EvaluationResults, GetBatchEvaluationResult } from '../../aws/agentcore-batch-evaluation';
import { detectRegion } from '../../aws/region';
import { ExecLogger } from '../../logging/exec-logger';
import { CloudWatchLogsClient, GetLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';

// ============================================================================
// Types
// ============================================================================

export interface RunBatchEvaluationOptions {
  /** Agent name (from project config) */
  agent: string;
  /** Evaluator IDs (Builtin.* or custom) */
  evaluators: string[];
  /** Optional name for the batch evaluation */
  name?: string;
  /** Region override */
  region?: string;
  /** Explicit execution role ARN (falls back to agent's deployed role) */
  executionRoleArn?: string;
  /** Poll interval in ms */
  pollIntervalMs?: number;
  /** Progress callback */
  onProgress?: (status: string, message: string) => void;
}

export interface BatchEvaluationResult {
  evaluatorId: string;
  score?: number;
  label?: string;
  explanation?: string;
  error?: string;
}

export interface RunBatchEvaluationCommandResult {
  success: boolean;
  error?: string;
  batchEvaluateId?: string;
  name?: string;
  status?: string;
  results: BatchEvaluationResult[];
  evaluationResults?: EvaluationResults;
  startedAt?: string;
  completedAt?: string;
  logFilePath?: string;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_POLL_INTERVAL_MS = 10_000;
const TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED', 'STOPPED', 'CANCELLED']);

// ============================================================================
// Implementation
// ============================================================================

export async function runBatchEvaluationCommand(
  options: RunBatchEvaluationOptions
): Promise<RunBatchEvaluationCommandResult> {
  const { agent, evaluators, pollIntervalMs = DEFAULT_POLL_INTERVAL_MS, onProgress } = options;

  let logger: ExecLogger | undefined;
  try {
    logger = new ExecLogger({ command: 'batch-evaluate' });
  } catch {
    // Non-fatal
  }

  try {
    // 1. Read project config and deployed state
    logger?.startStep('Load project config');
    const configIO = new ConfigIO();
    const [projectSpec, deployedState] = await Promise.all([configIO.readProjectSpec(), configIO.readDeployedState()]);

    const { region: detectedRegion } = await detectRegion();
    const region = options.region ?? detectedRegion;
    const stage = process.env.AGENTCORE_STAGE?.toLowerCase() ?? 'prod';
    logger?.log(`Region: ${region}, Stage: ${stage}`);
    logger?.endStep('success');

    // 2. Resolve agent from deployed state
    logger?.startStep('Resolve agent');
    const agentState = resolveAgentState(deployedState, agent);
    if (!agentState) {
      const error = `Agent "${agent}" not deployed. Run \`agentcore deploy\` first.`;
      logger?.log(error, 'error');
      logger?.endStep('error', error);
      logger?.finalize(false);
      return { success: false, error, results: [], logFilePath: logger?.logFilePath };
    }

    const runtimeId = agentState.runtimeId;
    // Service name in CW logs uses project_agent format without the CDK hash suffix
    const serviceName = `${projectSpec.name}_${agent}.DEFAULT`;
    const runtimeLogGroup = `/aws/bedrock-agentcore/runtimes/${runtimeId}-DEFAULT`;

    logger?.log(`Agent: ${agent} (runtime: ${runtimeId})`);
    logger?.log(`Service name: ${serviceName}`);
    logger?.log(`Log group: ${runtimeLogGroup}`);
    logger?.endStep('success');

    // 2b. Resolve evaluator names to deployed IDs
    const targetResources = Object.values(deployedState.targets).find(t => t.resources?.runtimes?.[agent])?.resources;
    const resolvedEvaluators = evaluators.map(name => {
      if (name.startsWith('Builtin.')) return name;
      const deployed = targetResources?.evaluators?.[name];
      if (deployed?.evaluatorId) {
        logger?.log(`Resolved evaluator "${name}" → ${deployed.evaluatorId}`);
        return deployed.evaluatorId;
      }
      logger?.log(`Evaluator "${name}" not found in deployed state, passing as-is`, 'warn');
      return name;
    });

    // 3. Start the batch evaluation
    logger?.startStep('Start batch evaluation');
    const evalName = options.name ?? `${projectSpec.name}_${agent}_${Date.now()}`;

    onProgress?.('starting', `Starting batch evaluation "${evalName}"...`);

    const startPayload = {
      region,
      name: evalName,
      evaluationConfig: {
        evaluators: resolvedEvaluators.map(id => ({ evaluatorId: id })),
      },
      sessionSource: {
        cloudWatchSource: {
          serviceNames: [serviceName],
          logGroupNames: [runtimeLogGroup],
        },
      },
      ...(options.executionRoleArn ? { executionRoleArn: options.executionRoleArn } : {}),
      clientToken: generateClientToken(),
    };

    logger?.log(`Request payload:\n${JSON.stringify(startPayload, null, 2)}`);

    const startResult = await startBatchEvaluation(startPayload);

    logger?.log(`Response: ${JSON.stringify(startResult, null, 2)}`);
    logger?.endStep('success');

    onProgress?.('running', `Batch evaluation started (ID: ${startResult.batchEvaluateId})`);

    // 4. Poll for completion
    logger?.startStep('Poll for completion');
    let current: GetBatchEvaluationResult = {
      batchEvaluateId: startResult.batchEvaluateId,
      name: startResult.name,
      status: startResult.status,
    };

    while (!TERMINAL_STATUSES.has(current.status)) {
      await sleep(pollIntervalMs);

      current = await getBatchEvaluation({
        region,
        batchEvaluateId: startResult.batchEvaluateId,
      });

      onProgress?.('polling', `Status: ${current.status}`);
      logger?.log(`Poll status: ${current.status}`);
    }

    if (current.status !== 'COMPLETED') {
      const reasons = current.statusReasons?.join('; ') ?? '';
      const error = `Batch evaluation finished with status: ${current.status}${reasons ? ` — ${reasons}` : ''}`;
      logger?.log(error, 'error');
      logger?.log(`Full poll response:\n${JSON.stringify(current, null, 2)}`, 'error');
      logger?.endStep('error', error);
      logger?.finalize(false);
      return {
        success: false,
        error,
        batchEvaluateId: startResult.batchEvaluateId,
        name: evalName,
        status: current.status,
        results: [],
        logFilePath: logger?.logFilePath,
      };
    }

    logger?.endStep('success');

    // 5. Fetch results from CloudWatch output logs
    logger?.startStep('Fetch results');
    let results: BatchEvaluationResult[] = [];

    const cwDest = current.outputDataConfig?.cloudWatchDestination;
    if (cwDest) {
      try {
        results = await fetchResultsFromCloudWatch(region, cwDest.logGroupName, cwDest.logStreamName);
        logger?.log(`Fetched ${results.length} result(s) from CloudWatch`);
      } catch (cwErr: unknown) {
        logger?.log(`Failed to fetch CW results: ${cwErr instanceof Error ? cwErr.message : String(cwErr)}`, 'error');
      }
    }

    // Fall back to inline results if CW fetch returned nothing
    if (results.length === 0 && current.results?.length) {
      results = current.results.map(r => ({
        evaluatorId: r.evaluatorId,
        score: r.score,
        label: r.label,
        explanation: r.explanation,
        error: r.error,
      }));
    }
    logger?.endStep('success');

    logger?.log(`Results: ${JSON.stringify(results, null, 2)}`);
    logger?.finalize(true);

    return {
      success: true,
      batchEvaluateId: startResult.batchEvaluateId,
      name: evalName,
      status: current.status,
      results,
      evaluationResults: current.evaluationResults,
      startedAt: current.createdAt,
      completedAt: current.updatedAt ?? new Date().toISOString(),
      logFilePath: logger?.logFilePath,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger?.log(error, 'error');
    logger?.finalize(false);
    return { success: false, error, results: [], logFilePath: logger?.logFilePath };
  }
}

// ============================================================================
// Helpers
// ============================================================================

function resolveAgentState(
  deployedState: DeployedState,
  agentName: string
): { runtimeId: string; runtimeArn: string; roleArn?: string } | undefined {
  for (const target of Object.values(deployedState.targets)) {
    const agent = target.resources?.runtimes?.[agentName];
    if (agent) return agent;
  }
  return undefined;
}

async function fetchResultsFromCloudWatch(
  region: string,
  logGroupName: string,
  logStreamName: string
): Promise<BatchEvaluationResult[]> {
  const client = new CloudWatchLogsClient({ region });
  const response = await client.send(
    new GetLogEventsCommand({
      logGroupName,
      logStreamName,
      startFromHead: true,
    })
  );

  const results: BatchEvaluationResult[] = [];
  for (const event of response.events ?? []) {
    if (!event.message) continue;
    try {
      const parsed = JSON.parse(event.message) as Record<string, unknown>;
      const attrs = (parsed.attributes ?? {}) as Record<string, unknown>;
      const evaluatorId = attrs['gen_ai.evaluation.name'] as string | undefined;
      if (!evaluatorId) continue;

      results.push({
        evaluatorId,
        score: attrs['gen_ai.evaluation.score.value'] as number | undefined,
        label: attrs['gen_ai.evaluation.score.label'] as string | undefined,
        explanation: attrs['gen_ai.evaluation.explanation'] as string | undefined,
      });
    } catch {
      // Skip non-JSON or malformed entries
    }
  }
  return results;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
