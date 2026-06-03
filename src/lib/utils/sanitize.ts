/**
 * Strip ANSI/control characters from a string and cap its length so a
 * remote-vended payload (gateway error message, IdP authorization URL,
 * bearer token) cannot flood the terminal or smuggle terminal-control
 * sequences when the CLI echoes it to a human-readable surface.
 *
 * Defense-in-depth: the gateway and AgentCore Identity service are still
 * inside the trust boundary, but a clipped/scrubbed echo costs nothing
 * and removes a paste-into-terminal injection vector if either is ever
 * compromised or misconfigured.
 *
 * Use only on TTY/Ink-rendered output. JSON output (`--json`) does not
 * need sanitization because `JSON.stringify` already escapes control
 * characters; sanitizing JSON-bound strings would corrupt legitimate
 * payloads downstream consumers expect to round-trip unchanged.
 */
const DEFAULT_MAX_LEN = 200;

export function sanitizeForTerminal(
  value: string | Error | null | undefined,
  maxLen: number = DEFAULT_MAX_LEN
): string {
  const raw = value instanceof Error ? value.message : (value ?? '');
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\x00-\x1f\x7f]/g, '').slice(0, maxLen);
}

/**
 * Higher cap variant for fields that are legitimately long but still
 * remote-sourced — chiefly authorization URLs (often 1-2 KB) and bearer
 * tokens. The 8 KB cap lines up with `mcp-meta.ts`'s
 * MAX_URL_LEN, so a value that fits the gateway's elicitation contract
 * also fits this echo path.
 */
const LONG_FIELD_MAX_LEN = 8192;

export function sanitizeLongFieldForTerminal(value: string | Error | null | undefined): string {
  return sanitizeForTerminal(value, LONG_FIELD_MAX_LEN);
}
