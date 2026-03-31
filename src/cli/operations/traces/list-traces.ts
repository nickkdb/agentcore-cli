import { getCredentialProvider } from '../../aws';
import { DEFAULT_ENDPOINT_NAME, SPANS_LOG_GROUP, TRACE_LIST_PREVIEW_LENGTH } from '../../constants';
import { CloudWatchLogsClient, GetQueryResultsCommand, StartQueryCommand } from '@aws-sdk/client-cloudwatch-logs';

export interface TraceEntry {
  traceId: string;
  sessionId?: string;
  spanCount: number;
  errorCount: number;
  durationMs: number;
  latestEndTimeNano: number;
  input?: string;
  output?: string;
}

export interface ListTracesOptions {
  region: string;
  runtimeId: string;
  agentName: string;
  limit?: number;
  startTime?: number;
  endTime?: number;
}

export interface ListTracesResult {
  success: boolean;
  traces?: TraceEntry[];
  error?: string;
}

interface RawSpan {
  traceId: string;
  spanId: string;
  statusCode?: string;
  durationMs?: number;
  sessionId?: string;
  startTimeUnixNano?: number;
  endTimeUnixNano?: number;
}

/** Sanitize a value for use in CloudWatch Insights query strings by removing single quotes. */
function sanitizeQueryValue(value: string): string {
  return value.replace(/'/g, '');
}

/**
 * Executes a CloudWatch Logs Insights query and polls for results.
 * Returns the raw result rows, or throws on failure/timeout.
 */
async function executeQuery(
  client: CloudWatchLogsClient,
  logGroupName: string,
  queryString: string,
  startTime: number,
  endTime: number
): Promise<{ field?: string; value?: string }[][]> {
  const startQuery = await client.send(
    new StartQueryCommand({
      logGroupName,
      startTime: Math.floor(startTime / 1000),
      endTime: Math.floor(endTime / 1000),
      queryString,
    })
  );

  if (!startQuery.queryId) {
    throw new Error('Failed to start CloudWatch Logs Insights query');
  }

  for (let i = 0; i < 60; i++) {
    await new Promise(resolve => setTimeout(resolve, 1000));

    const queryResults = await client.send(new GetQueryResultsCommand({ queryId: startQuery.queryId }));
    const status = queryResults.status ?? 'Unknown';

    if (status === 'Complete') {
      return queryResults.results ?? [];
    }
    if (status === 'Failed' || status === 'Cancelled') {
      throw new Error(`Query ${status.toLowerCase()}`);
    }
  }

  throw new Error('Query timed out after 60 seconds');
}

/**
 * Extracts a field value from a CloudWatch Logs Insights result row.
 */
function getField(row: { field?: string; value?: string }[], name: string): string | undefined {
  return row.find(f => f.field === name)?.value;
}

/**
 * Parses span rows from CloudWatch Logs Insights results.
 */
function parseSpanRows(rows: { field?: string; value?: string }[][]): RawSpan[] {
  return rows.map(row => ({
    traceId: getField(row, 'traceId') ?? 'unknown',
    spanId: getField(row, 'spanId') ?? 'unknown',
    statusCode: getField(row, 'statusCode'),
    durationMs: parseFloat(getField(row, 'durationMs') ?? '0') || undefined,
    sessionId: getField(row, 'sessionId'),
    startTimeUnixNano: parseInt(getField(row, 'startTimeUnixNano') ?? '0', 10) || undefined,
    endTimeUnixNano: parseInt(getField(row, 'endTimeUnixNano') ?? '0', 10) || undefined,
  }));
}

/**
 * Groups spans by traceId and computes per-trace aggregates.
 */
function aggregateTraces(spans: RawSpan[], limit: number): Omit<TraceEntry, 'input' | 'output'>[] {
  const grouped = new Map<string, RawSpan[]>();
  for (const span of spans) {
    const list = grouped.get(span.traceId);
    if (list) {
      list.push(span);
    } else {
      grouped.set(span.traceId, [span]);
    }
  }

  const traces: Omit<TraceEntry, 'input' | 'output'>[] = [];

  for (const [traceId, traceSpans] of grouped) {
    const startTimes = traceSpans.map(s => s.startTimeUnixNano).filter((t): t is number => t != null && t > 0);
    const endTimes = traceSpans.map(s => s.endTimeUnixNano).filter((t): t is number => t != null && t > 0);

    let durationMs = 0;
    if (startTimes.length > 0 && endTimes.length > 0) {
      durationMs = (Math.max(...endTimes) - Math.min(...startTimes)) / 1_000_000;
    } else {
      durationMs = traceSpans.reduce((sum, s) => sum + (s.durationMs ?? 0), 0);
    }

    const errorCount = traceSpans.filter(s => s.statusCode === 'ERROR').length;
    const latestEndTimeNano = endTimes.length > 0 ? Math.max(...endTimes) : 0;
    const sessionId = traceSpans.find(s => s.sessionId)?.sessionId;

    traces.push({
      traceId,
      sessionId,
      spanCount: traceSpans.length,
      errorCount,
      durationMs,
      latestEndTimeNano,
    });
  }

  // Sort by most recent first
  traces.sort((a, b) => b.latestEndTimeNano - a.latestEndTimeNano);

  return traces.slice(0, limit);
}

/**
 * Truncates a string to maxLen characters, appending "..." if truncated.
 */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

/**
 * Extracts a human-readable text string from a Strands content field.
 * Handles nested JSON strings like '[{"text": "hello"}]' and plain strings.
 */
function extractTextFromContent(content: unknown): string | undefined {
  if (typeof content === 'string') {
    // Try parsing as JSON (Strands wraps content as JSON string e.g. '[{"text": "hello"}]')
    try {
      const parsed: unknown = JSON.parse(content);
      if (Array.isArray(parsed)) {
        const texts = parsed.map((item: Record<string, unknown>) => item.text).filter(Boolean);
        if (texts.length > 0) return texts.join(' ');
      }
      if (typeof parsed === 'string') return parsed;
    } catch {
      // Not JSON — use as-is
    }
    return content;
  }
  if (content && typeof content === 'object') {
    const obj = content as Record<string, unknown>;
    // Strands output: content.message (string)
    if (typeof obj.message === 'string') return obj.message;
    // Strands output: content.content (nested string)
    if (typeof obj.content === 'string') return extractTextFromContent(obj.content);
    // Array of content blocks: [{text: "..."}]
    if (Array.isArray(content)) {
      const texts = content.map((item: Record<string, unknown>) => item.text).filter(Boolean);
      if (texts.length > 0) return texts.join(' ');
    }
  }
  return undefined;
}

/**
 * Extracts all user and assistant messages from a parsed runtime log entry.
 * Handles multiple instrumentation formats: Strands, botocore, generic OTEL.
 */
function extractMessagesFromBody(parsed: Record<string, unknown>): { role: string; content: string }[] {
  const results: { role: string; content: string }[] = [];
  const body = parsed.body as Record<string, unknown> | undefined;
  if (!body) return results;

  // Pattern 1: body.message.role + body.message.content (botocore bedrock-runtime)
  const message = body.message as Record<string, unknown> | undefined;
  if (message && typeof message.role === 'string') {
    let text: string | undefined;
    if (Array.isArray(message.content)) {
      text = message.content
        .map((c: Record<string, unknown>) => c.text)
        .filter(Boolean)
        .join(' ');
    } else if (typeof message.content === 'string') {
      text = message.content;
    }
    if (text) results.push({ role: message.role, content: text });
  }

  // Pattern 2: body.input.messages + body.output.messages (Strands telemetry)
  const bodyInput = body.input as Record<string, unknown> | undefined;
  if (bodyInput?.messages && Array.isArray(bodyInput.messages)) {
    for (const msg of bodyInput.messages as Record<string, unknown>[]) {
      if (typeof msg.role === 'string') {
        const text = extractTextFromContent(msg.content);
        if (text) results.push({ role: msg.role, content: text });
      }
    }
  }

  const bodyOutput = body.output as Record<string, unknown> | undefined;
  if (bodyOutput?.messages && Array.isArray(bodyOutput.messages)) {
    for (const msg of bodyOutput.messages as Record<string, unknown>[]) {
      if (typeof msg.role === 'string') {
        const text = extractTextFromContent(msg.content);
        if (text) results.push({ role: msg.role, content: text });
      }
    }
  }

  // Pattern 3: body.role + body.content (simple format)
  if (typeof body.role === 'string' && body.content) {
    const text = extractTextFromContent(body.content);
    if (text) results.push({ role: body.role, content: text });
  }

  return results;
}

/**
 * Parses runtime logs and extracts the last user (input) and assistant (output) messages per trace.
 */
function extractTraceMessages(
  logRows: { field?: string; value?: string }[][],
  previewLength: number
): Map<string, { input?: string; output?: string }> {
  // Collect all messages grouped by traceId
  const messagesByTrace = new Map<string, { role: string; content: string }[]>();

  for (const row of logRows) {
    const traceId = getField(row, 'traceId');
    const rawMessage = getField(row, '@message');
    if (!traceId || !rawMessage) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawMessage) as Record<string, unknown>;
    } catch {
      continue;
    }

    const msgs = extractMessagesFromBody(parsed);
    if (msgs.length === 0) continue;

    const list = messagesByTrace.get(traceId);
    if (list) {
      list.push(...msgs);
    } else {
      messagesByTrace.set(traceId, [...msgs]);
    }
  }

  // For each trace, find the last user and last assistant message
  const result = new Map<string, { input?: string; output?: string }>();

  for (const [traceId, messages] of messagesByTrace) {
    let lastUser: string | undefined;
    let lastAssistant: string | undefined;

    for (const msg of messages) {
      if (msg.role === 'user') {
        lastUser = msg.content;
      } else if (msg.role === 'assistant') {
        lastAssistant = msg.content;
      }
    }

    result.set(traceId, {
      input: lastUser ? truncate(lastUser, previewLength) : undefined,
      output: lastAssistant ? truncate(lastAssistant, previewLength) : undefined,
    });
  }

  return result;
}

/**
 * Lists recent traces for a deployed agent by querying CloudWatch Logs Insights.
 *
 * Phase 1: Query aws/spans for span-level data (duration, status, counts).
 * Phase 2: Query runtime logs for input/output message previews.
 */
export async function listTraces(options: ListTracesOptions): Promise<ListTracesResult> {
  const { region, runtimeId, limit = 20 } = options;

  const client = new CloudWatchLogsClient({
    credentials: getCredentialProvider(),
    region,
  });

  const now = Date.now();
  const endTime = options.endTime ?? now;
  const startTime = options.startTime ?? endTime - 12 * 60 * 60 * 1000;

  // Phase 1: Query spans from aws/spans log group
  const spansQuery = `fields @timestamp, @message, traceId, spanId, name as spanName,
       status.code as statusCode, durationNano/1000000 as durationMs,
       attributes.session.id as sessionId,
       startTimeUnixNano, endTimeUnixNano, parentSpanId
| parse resource.attributes.cloud.resource_id "runtime/*/" as parsedAgentId
| filter parsedAgentId = '${sanitizeQueryValue(runtimeId)}'
| sort startTimeUnixNano asc
| limit 10000`;

  try {
    const spanRows = await executeQuery(client, SPANS_LOG_GROUP, spansQuery, startTime, endTime);
    const spans = parseSpanRows(spanRows);
    const traces = aggregateTraces(spans, limit);

    if (traces.length === 0) {
      return { success: true, traces: [] };
    }

    // Phase 2: Query runtime logs for input/output messages
    const traceIds = traces.map(t => t.traceId);
    const runtimeLogGroup = `/aws/bedrock-agentcore/runtimes/${runtimeId}-${DEFAULT_ENDPOINT_NAME}`;
    const inClause = traceIds.map(id => `'${sanitizeQueryValue(id)}'`).join(', ');
    const runtimeQuery = `fields @timestamp, @message, spanId, traceId, @logStream
| filter traceId in [${inClause}]
| sort @timestamp asc
| limit 10000`;

    let messageMap = new Map<string, { input?: string; output?: string }>();

    try {
      const logRows = await executeQuery(client, runtimeLogGroup, runtimeQuery, startTime, endTime);
      messageMap = extractTraceMessages(logRows, TRACE_LIST_PREVIEW_LENGTH);
    } catch {
      // Runtime logs may not exist — proceed without messages
    }

    // Merge messages into traces
    const enrichedTraces: TraceEntry[] = traces.map(trace => {
      const messages = messageMap.get(trace.traceId);
      return {
        ...trace,
        input: messages?.input,
        output: messages?.output,
      };
    });

    return { success: true, traces: enrichedTraces };
  } catch (error: unknown) {
    const err = error as Error;
    if (err.name === 'ResourceNotFoundException') {
      return {
        success: false,
        error: `Log group '${SPANS_LOG_GROUP}' not found. The agent may not have been invoked yet, or traces may not be enabled.`,
      };
    }
    return { success: false, error: err.message ?? String(error) };
  }
}
