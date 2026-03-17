import { ConnectionError, type InvokeStreamingOptions, type SSELogger, ServerError } from './invoke-types';

let requestId = 1;

export interface A2AAgentCard {
  name?: string;
  description?: string;
  version?: string;
  url?: string;
  skills?: { id?: string; name?: string; description?: string; tags?: string[] }[];
  capabilities?: { streaming?: boolean };
  defaultInputModes?: string[];
  defaultOutputModes?: string[];
}

/**
 * Fetch the A2A agent card from /.well-known/agent.json.
 * Returns null if not available (retries on connection errors).
 */
export async function fetchA2AAgentCard(port: number, logger?: SSELogger): Promise<A2AAgentCard | null> {
  const maxRetries = 5;
  const baseDelay = 500;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(`http://localhost:${port}/.well-known/agent.json`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });

      if (!res.ok) {
        logger?.log?.('warn', `Agent card not available (${res.status})`);
        return null;
      }

      const card = (await res.json()) as A2AAgentCard;
      logger?.log?.('system', `A2A agent card: ${card.name ?? 'unnamed'}`);
      return card;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const isConnectionError = error.message.includes('fetch') || error.message.includes('ECONNREFUSED');

      if (isConnectionError && attempt < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, attempt);
        await sleep(delay);
        continue;
      }

      logger?.log?.('warn', `Failed to fetch agent card: ${error.message}`);
      return null;
    }
  }

  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Invokes an A2A agent using JSON-RPC 2.0 message/send.
 * Yields text chunks extracted from the response artifacts.
 */
export async function* invokeA2AStreaming(options: InvokeStreamingOptions): AsyncGenerator<string, void, unknown> {
  const { port, message: msg, logger } = options;
  const maxRetries = 5;
  const baseDelay = 500;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const body = {
        jsonrpc: '2.0',
        id: requestId++,
        method: 'message/send',
        params: {
          message: {
            role: 'user',
            parts: [{ type: 'text', text: msg }],
          },
        },
      };

      logger?.log?.('system', `A2A message/send: ${msg}`);

      const res = await fetch(`http://localhost:${port}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const responseBody = await res.text();
        throw new ServerError(res.status, responseBody);
      }

      const contentType = res.headers.get('content-type') ?? '';

      // Handle SSE streaming response
      if (contentType.includes('text/event-stream') && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
          while (true) {
            const result = await reader.read();
            if (result.done) break;

            buffer += decoder.decode(result.value as Uint8Array, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              const data = line.slice(6).trim();
              if (!data) continue;

              logger?.logSSEEvent(line);

              try {
                const event = JSON.parse(data) as Record<string, unknown>;
                const text = extractA2AText(event);
                if (text) yield text;
              } catch {
                // Non-JSON SSE data, yield as-is
                yield data;
              }
            }
          }
        } finally {
          reader.releaseLock();
        }
        return;
      }

      // Handle non-streaming JSON-RPC response
      const responseText = await res.text();
      logger?.logSSEEvent(responseText);

      try {
        const json = JSON.parse(responseText) as Record<string, unknown>;

        if (json.error) {
          const rpcError = json.error as { message?: string; code?: number };
          throw new ServerError(rpcError.code ?? 500, rpcError.message ?? 'A2A RPC error');
        }

        const result = json.result as Record<string, unknown> | undefined;
        if (result) {
          const text = extractA2AResultText(result);
          if (text) {
            yield text;
          } else {
            yield JSON.stringify(result, null, 2);
          }
        } else {
          yield responseText;
        }
      } catch (e) {
        if (e instanceof ServerError) throw e;
        yield responseText;
      }

      return;
    } catch (err) {
      if (err instanceof ServerError) {
        logger?.log?.('error', `Server error (${err.statusCode}): ${err.message}`);
        throw err;
      }

      lastError = err instanceof Error ? err : new Error(String(err));
      const isConnectionError = lastError.message.includes('fetch') || lastError.message.includes('ECONNREFUSED');

      if (isConnectionError) {
        const delay = baseDelay * Math.pow(2, attempt);
        logger?.log?.(
          'warn',
          `Connection failed (attempt ${attempt + 1}/${maxRetries}): ${lastError.message}. Retrying in ${delay}ms...`
        );
        await sleep(delay);
        continue;
      }

      logger?.log?.('error', `Request failed: ${lastError.stack ?? lastError.message}`);
      throw lastError;
    }
  }

  const finalError = new ConnectionError(lastError ?? new Error('Failed to connect to A2A server after retries'));
  logger?.log?.('error', `Failed to connect after ${maxRetries} attempts: ${finalError.message}`);
  throw finalError;
}

/** Extract text from an A2A SSE event (task status update or artifact) */
function extractA2AText(event: Record<string, unknown>): string | null {
  // Check for result with artifacts
  const result = event.result as Record<string, unknown> | undefined;
  if (result) {
    return extractA2AResultText(result);
  }
  return null;
}

/** Extract text from A2A result artifacts */
function extractA2AResultText(result: Record<string, unknown>): string | null {
  const artifacts = result.artifacts as { parts?: { type?: string; text?: string }[] }[] | undefined;
  if (!artifacts) return null;

  const texts: string[] = [];
  for (const artifact of artifacts) {
    if (!artifact.parts) continue;
    for (const part of artifact.parts) {
      if (part.type === 'text' && part.text) {
        texts.push(part.text);
      }
    }
  }
  return texts.length > 0 ? texts.join('') : null;
}
