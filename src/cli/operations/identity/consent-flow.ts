/**
 * 3LO consent flow.
 *
 * AgentCore Identity drives the OAuth authorization-code flow on behalf of
 * the developer's CLI: when a Gateway target with `grantType: AUTHORIZATION_CODE`
 * is invoked, the gateway returns an MCP `URLElicitationRequiredError`
 * (JSON-RPC error code -32042) carrying an `authorizationUrl`. The CLI's job
 * is to surface that URL to the developer, capture the resulting redirect, and
 * complete the session binding so the Gateway can exchange the auth code for an
 * access token server-side.
 *
 * Two strategies (chosen by `detectHeadless()` unless overridden):
 *
 *   1. **browserLoopback (default):** bind a localhost HTTP server on a
 *      random port, open the developer's default browser at the IdP
 *      authorization URL, and complete the flow when the IdP redirects to
 *      `http://localhost:<port>/callback`.
 *
 *   2. **headlessPasteUrl:** when no browser is available (CI, Linux SSH
 *      without `$DISPLAY`, `--no-browser-consent` flag, all loopback ports
 *      busy), print the URL, ask the developer to open it on a different
 *      machine, and accept the redirected URL they paste back.
 *
 * No raw OAuth tokens are stored locally — the Gateway holds the token in
 * AgentCore Identity's server-side vault. The CLI only persists a session
 * pointer (see session-pointer.ts).
 */
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as http from 'node:http';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import * as readline from 'node:readline/promises';

function sessionsDir(): string {
  return join(homedir(), '.agentcore', 'identity-sessions');
}
const LOCK_TIMEOUT_MS = 5 * 60 * 1000;
const LOOPBACK_PORT_RETRIES = 3;
const DEFAULT_CONSENT_TIMEOUT_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConsentStrategy = 'browserLoopback' | 'headlessPasteUrl';

export interface ConsentFlowInput {
  /** The authorization URL returned by the gateway / Identity service. */
  authorizationUrl: string;
  /** A stable identifier used to compute the file-lock path; usually a hash of (project, gateway, target). */
  consentScopeId: string;
  /** When true, suppress prompts that require an interactive TTY and skip browser open. */
  silent?: boolean;
  /** When provided, the IdP redirect URI to display alongside `authorizationUrl` for `redirect_uri_mismatch` recovery. */
  callbackUrl?: string;
  /** Additional contextual info shown alongside paste-URL prompts (e.g. "gateway/target"). */
  contextLabel?: string;
  /** Override the consent strategy. Useful for testing and the --no-browser-consent flag. */
  strategy?: ConsentStrategy | 'auto';
  /** How long to wait for the user to complete consent. Default: 5 minutes. */
  timeoutMs?: number;
  /** Hooks for testing — caller may inject a fake browser-open or platform reporter. */
  hooks?: ConsentHooks;
}

export interface ConsentHooks {
  openBrowser?: (url: string) => void;
  detectHeadless?: () => boolean;
  now?: () => number;
}

export interface ConsentFlowResult {
  /** OAuth `code` returned by the IdP (the gateway will exchange this for a token). */
  code: string;
  /** OAuth `state` parameter; CLI verifies it matches what was sent. */
  state: string;
  /** The strategy that completed the flow (used for logging / telemetry). */
  strategyUsed: ConsentStrategy;
  /** The loopback redirect URI that was actually used (only meaningful for browserLoopback). */
  redirectUri?: string;
}

export class ConsentTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Consent flow did not complete within ${Math.round(timeoutMs / 1000)}s`);
    this.name = 'ConsentTimeoutError';
  }
}

export class ConsentLockedError extends Error {
  constructor(public readonly lockPath: string) {
    super(`Another agentcore process holds the consent lock at ${lockPath}. Wait for it to finish or delete the lock.`);
    this.name = 'ConsentLockedError';
  }
}

export class ConsentMismatchError extends Error {
  constructor(
    public readonly expected: string,
    public readonly actual: string
  ) {
    super(`OAuth state mismatch — expected "${expected}", got "${actual}". Possible CSRF attempt; aborting.`);
    this.name = 'ConsentMismatchError';
  }
}

// ---------------------------------------------------------------------------
// PKCE — handled by AgentCore Identity service-side. The CLI does not generate
// or transmit PKCE values; the service generates its own verifier when it
// dispatches the user to the IdP and verifies it on the token exchange. The
// CLI never executes the IdP token exchange, so CLI-side PKCE would defend
// nothing the existing CSRF (`state` nonce) and TLS protections don't already
// cover.
// ---------------------------------------------------------------------------

function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ---------------------------------------------------------------------------
// Headless detection (task 2.4)
// ---------------------------------------------------------------------------

export interface HeadlessEnv {
  CI?: string;
  DISPLAY?: string;
  WAYLAND_DISPLAY?: string;
  SSH_CONNECTION?: string;
  SSH_TTY?: string;
}

/**
 * Returns true when the host can't reasonably open a browser:
 *   - CI environment (`CI=true`, `CI=1`, etc.)
 *   - Linux without `$DISPLAY` and `$WAYLAND_DISPLAY` (headless servers, SSH)
 *   - any SSH session (`$SSH_TTY` or `$SSH_CONNECTION`) — even macOS/Windows
 *     servers reached via SSH have no usable display, and `open` / `start`
 *     would silently exit 0 against a server with no desktop, leaving the
 *     loopback listener to time out 5 minutes later.
 *
 * macOS (`darwin`) and Windows (`win32`) outside CI and outside SSH return
 * false, since they ship with system browsers and `open` / `start` work
 * even without a focused desktop session.
 */
export function detectHeadless(plat: NodeJS.Platform = platform(), env: HeadlessEnv = process.env): boolean {
  if (env.CI && env.CI !== 'false' && env.CI !== '0') return true;
  if (env.SSH_TTY || env.SSH_CONNECTION) return true;
  if (plat === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Concurrent-consent file lock (task 2.6)
// ---------------------------------------------------------------------------

interface LockFileShape {
  pid: number;
  startedAt: number;
}

function lockPathFor(consentScopeId: string): string {
  const hash = createHash('sha256').update(consentScopeId).digest('hex').slice(0, 16);
  return join(sessionsDir(), `.lock-${hash}`);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but we don't have permission to signal it,
    // which still indicates the process is alive — we just can't kill it.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Acquire an exclusive consent lock keyed on `consentScopeId`.
 *
 * Throws `ConsentLockedError` if another live process holds it. Stale locks
 * (PID dead or older than 5 minutes) are reclaimed silently.
 */
export function acquireConsentLock(consentScopeId: string, now: () => number = Date.now): { release: () => void } {
  // Wrap mkdir to surface a useful error when ~/.agentcore is
  // unreadable (e.g. chmod 000 or owned by another user). Without the
  // wrapper the developer sees a raw EACCES with no mention of "consent"
  // or "lock", which makes the failure look unrelated to OAuth.
  try {
    mkdirSync(sessionsDir(), { recursive: true });
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Cannot create consent lock directory ${sessionsDir()}: ${cause}. Ensure ~/.agentcore is owned by the current user and writable.`,
      { cause: err }
    );
  }
  const lockPath = lockPathFor(consentScopeId);

  if (existsSync(lockPath)) {
    let stale = false;
    try {
      const raw = JSON.parse(readFileSync(lockPath, 'utf-8')) as LockFileShape;
      const ageMs = now() - raw.startedAt;
      // Branch ordering is load-bearing. The age check MUST come first:
      // when the kernel recycles a PID after its original process dies,
      // `isProcessAlive` returns true on a stale lock owned by an
      // unrelated process. Age-then-liveness reclaims a timed-out lock
      // regardless of who currently owns the recycled PID. Reversing
      // these two branches silently re-introduces the PID-reuse hazard.
      if (ageMs > LOCK_TIMEOUT_MS) stale = true;
      else if (!isProcessAlive(raw.pid)) stale = true;
    } catch {
      // Corrupt lock file — treat as stale.
      stale = true;
    }
    if (!stale) throw new ConsentLockedError(lockPath);
    rmSync(lockPath, { force: true });
  }

  const lockData: LockFileShape = { pid: process.pid, startedAt: now() };
  try {
    writeFileSync(lockPath, JSON.stringify(lockData), { flag: 'wx', mode: 0o600 });
  } catch (err) {
    // TOCTOU: another process won the race between our reclaim/check and our
    // create. Surface the documented `ConsentLockedError` instead of a raw
    // EEXIST so callers can retry / instruct the user.
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new ConsentLockedError(lockPath);
    }
    throw err;
  }

  return {
    release: () => {
      try {
        rmSync(lockPath, { force: true });
      } catch {
        // best-effort
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Browser-loopback strategy (task 2.2 + 2.5)
// ---------------------------------------------------------------------------

interface LoopbackHandle {
  server: http.Server;
  port: number;
  promise: Promise<{ code: string; state: string }>;
}

function listenLoopbackOnce(timeoutMs: number): Promise<LoopbackHandle> {
  return new Promise<LoopbackHandle>((resolve, reject) => {
    let responseResolver: (value: { code: string; state: string }) => void = () => undefined;
    let responseRejector: (reason: unknown) => void = () => undefined;
    const responsePromise = new Promise<{ code: string; state: string }>((res, rej) => {
      responseResolver = res;
      responseRejector = rej;
    });

    const server = http.createServer((req, res) => {
      try {
        // DNS-rebind defense: accept only loopback Host headers. Both 127.0.0.1
        // (IPv4) and ::1 (IPv6) are loopback-only at the kernel level — neither
        // resolves through DNS. Allow both so the defense doesn't break on
        // IPv6-preferring hosts.
        const rawHost = req.headers.host ?? '';
        const hostOnly = rawHost.startsWith('[')
          ? rawHost.slice(1, rawHost.indexOf(']')) // IPv6 bracketed: "[::1]:1234"
          : (rawHost.split(':')[0] ?? ''); // IPv4 or bare hostname: "127.0.0.1:1234"
        if (hostOnly !== '127.0.0.1' && hostOnly !== '::1') {
          res.writeHead(403, { 'Content-Type': 'text/plain' });
          res.end('Forbidden: loopback consent endpoint requires loopback Host (127.0.0.1 or ::1)');
          return;
        }
        // Cross-origin defense: legitimate IdP redirects are top-level
        // navigations and have no `Origin` header. A browser cross-origin
        // fetch / form post will always carry one — refuse it.
        if (req.headers.origin) {
          res.writeHead(403, { 'Content-Type': 'text/plain' });
          res.end('Forbidden: cross-origin requests are not allowed');
          return;
        }
        if (req.method !== 'GET') {
          res.writeHead(405, { 'Content-Type': 'text/plain' });
          res.end('Method not allowed');
          return;
        }
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (url.pathname !== '/callback') {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not found');
          return;
        }
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        if (!code || !state) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Missing code or state parameter');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(
          '<!doctype html><html><body style="font-family:sans-serif;text-align:center;padding:2rem">' +
            '<h2>Sign-in complete</h2><p>You can close this tab and return to your terminal.</p></body></html>'
        );
        clearTimeout(timer);
        server.close();
        responseResolver({ code, state });
      } catch (err) {
        clearTimeout(timer);
        server.close();
        responseRejector(err);
      }
    });

    const timer: NodeJS.Timeout = setTimeout(() => {
      server.close();
      responseRejector(new ConsentTimeoutError(timeoutMs));
    }, timeoutMs);

    server.once('error', err => {
      clearTimeout(timer);
      reject(err);
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ server, port, promise: responsePromise });
    });
  });
}

/**
 * Bind a loopback server on a random port. Retries up to
 * LOOPBACK_PORT_RETRIES times on `EADDRINUSE` / `EACCES`; throws on the last
 * failure so the caller can fall back to the headless paste-URL strategy.
 */
async function bindLoopback(timeoutMs: number): Promise<LoopbackHandle> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < LOOPBACK_PORT_RETRIES; attempt++) {
    try {
      return await listenLoopbackOnce(timeoutMs);
    } catch (err) {
      lastErr = err;
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EADDRINUSE' && code !== 'EACCES') break;
    }
  }
  if (lastErr instanceof Error) throw lastErr;
  throw new Error('Failed to bind loopback port');
}

// ---------------------------------------------------------------------------
// Browser launch
// ---------------------------------------------------------------------------

function openBrowserDefault(url: string): void {
  const plat = platform();
  let cmd: string;
  let args: string[];
  // `spawn` with `shell: false` (the default) is load-bearing here — it
  // prevents URLs containing shell metacharacters (`;`, `&`, backticks, `$()`,
  // etc.) from breaking out of the argv. Do NOT switch this to `exec` or
  // `spawn(..., { shell: true })`.
  if (plat === 'darwin') {
    cmd = 'open';
    args = [url];
  } else if (plat === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '""', url];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }
  const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
  child.unref();
}

// ---------------------------------------------------------------------------
// Headless paste-URL strategy (task 2.3)
// ---------------------------------------------------------------------------

async function runHeadlessPasteUrl(
  input: ConsentFlowInput,
  authorizationUrlToShow: string
): Promise<{ code: string; state: string }> {
  const ctx = input.contextLabel ? ` for ${input.contextLabel}` : '';
  const cb = input.callbackUrl
    ? `  After consent, the IdP will redirect to a URL starting with:\n    ${input.callbackUrl}\n  Copy the full redirected URL (with ?code=... &state=...) back here.\n\n`
    : '  After consent, the IdP will redirect to a URL containing ?code=... and &state=...\n  Paste that URL back here.\n\n';

  process.stderr.write(
    `\nNo browser available; complete OAuth consent${ctx} on a different machine.\n` +
      `\n  Open this URL in a browser:\n    ${authorizationUrlToShow}\n\n${cb}`
  );

  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  try {
    const pasted = (await rl.question('Paste redirect URL: ')).trim();
    // The native URL constructor surfaces TypeError [ERR_INVALID_URL] as a raw
    // Node error which is confusing to developers; wrap with a guidance string
    // pointing at the expected format.
    let url: URL;
    try {
      url = new URL(pasted);
    } catch {
      throw new Error(
        `Pasted text doesn't look like a URL. Expected something like "https://app.example.com/cb?code=...&state=...". Got: ${pasted.slice(0, 80)}`
      );
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`Pasted URL must use http(s) — got "${url.protocol}".`);
    }
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code || !state) {
      throw new Error('Pasted URL is missing required `code` or `state` query parameters.');
    }
    return { code, state };
  } finally {
    rl.close();
  }
}

// ---------------------------------------------------------------------------
// Public entry point (task 2.1)
// ---------------------------------------------------------------------------

/**
 * Drive the consent flow to completion.
 *
 * The consent lock is only acquired for the `browserLoopback` strategy
 * because that's where two concurrent CLI processes would actually
 * contend (both binding loopback ports for the same scope). The
 * `headlessPasteUrl` strategy reads from stdin and has no shared
 * kernel resource — locking it would block legitimate parallel work
 * (e.g. a developer running consent on a CI box while another runs
 * locally) for no security benefit.
 *
 * @throws ConsentLockedError when another process holds the loopback lock
 * @throws ConsentTimeoutError when the user takes too long
 * @throws ConsentMismatchError when the returned `state` doesn't match
 */
export async function runConsent(input: ConsentFlowInput): Promise<ConsentFlowResult> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_CONSENT_TIMEOUT_MS;
  const isHeadless = (input.hooks?.detectHeadless ?? detectHeadless)();
  const openBrowser = input.hooks?.openBrowser ?? openBrowserDefault;

  const explicit = input.strategy && input.strategy !== 'auto' ? input.strategy : undefined;
  // `silent` always wins over an explicit browserLoopback override — there's
  // no human attention to drive the loopback flow, so falling through to
  // paste-URL is the only way the caller can ever complete consent. This
  // matches the documented behavior of `--no-browser-consent` and `--silent` flags.
  let strategy: ConsentStrategy = explicit ?? (isHeadless || input.silent ? 'headlessPasteUrl' : 'browserLoopback');
  if (strategy === 'browserLoopback' && input.silent) {
    strategy = 'headlessPasteUrl';
  }

  // Generate a CSRF state nonce. The CLI is the proximate consumer of the
  // /callback redirect even when AgentCore Identity is the OAuth client of
  // record; appending our own `state` and verifying it on the way back
  // closes the loopback CSRF window (RFC 6749 §10.12).
  const localState = base64UrlEncode(randomBytes(32));

  if (strategy === 'browserLoopback') {
    const lock = acquireConsentLock(input.consentScopeId, input.hooks?.now);
    try {
      return await runBrowserLoopback(input, localState, timeoutMs, openBrowser);
    } finally {
      lock.release();
    }
  }

  // headlessPasteUrl — no lock needed; two concurrent stdin readers don't conflict.
  const pasteUrl = appendStateAndRedirect(input.authorizationUrl, localState, undefined);
  const pasteResult = await runHeadlessPasteUrl(input, pasteUrl);
  verifyState(localState, pasteResult.state);
  return { ...pasteResult, strategyUsed: 'headlessPasteUrl' };
}

async function runBrowserLoopback(
  input: ConsentFlowInput,
  localState: string,
  timeoutMs: number,
  openBrowser: (url: string) => void
): Promise<ConsentFlowResult> {
  let handle: LoopbackHandle;
  try {
    handle = await bindLoopback(timeoutMs);
  } catch {
    // Loopback bind exhausted (3 EADDRINUSE retries). Fall through to the
    // paste-URL strategy so the user can still complete consent — same
    // behavior the plan calls for in task 2.5. The lock is held by the
    // caller's `runConsent` for the duration; that's intentional, since
    // we already chose the loopback strategy and another process trying
    // the same scope-id should still wait.
    const pasteUrl = appendStateAndRedirect(input.authorizationUrl, localState, undefined);
    const pasteResult = await runHeadlessPasteUrl(input, pasteUrl);
    verifyState(localState, pasteResult.state);
    return { ...pasteResult, strategyUsed: 'headlessPasteUrl' };
  }

  try {
    const redirectUri = `http://127.0.0.1:${handle.port}/callback`;
    const url = appendStateAndRedirect(input.authorizationUrl, localState, redirectUri);
    if (!input.silent) {
      process.stderr.write(`Opening browser to complete OAuth consent...\n`);
      if (input.callbackUrl) {
        process.stderr.write(`  IdP redirect URI registered with AgentCore: ${input.callbackUrl}\n`);
      }
      openBrowser(url);
    } else {
      process.stderr.write(`Visit this URL to complete consent:\n  ${url}\n`);
    }
    const { code, state } = await handle.promise;
    verifyState(localState, state);
    return { code, state, strategyUsed: 'browserLoopback', redirectUri };
  } finally {
    handle.server.close();
  }
}

function verifyState(expected: string, actual: string): void {
  if (expected !== actual) {
    throw new ConsentMismatchError(expected, actual);
  }
}

/**
 * Append the locally-generated `state` to the authorization URL (always —
 * we need it back to close the CSRF window) and the loopback `redirect_uri`
 * when not already specified by AgentCore Identity.
 */
function appendStateAndRedirect(authorizationUrl: string, state: string, redirectUri: string | undefined): string {
  let u: URL;
  try {
    u = new URL(authorizationUrl);
  } catch {
    // Malformed URL — return as-is; the strategy code surfaces a clearer
    // error than this helper can.
    return authorizationUrl;
  }
  // Scheme allowlist: every consent strategy ultimately hands this URL to
  // either `xdg-open`/`open`/`start` (browser-loopback) or to the user with
  // "open this in a browser" instructions (paste-URL). Refuse anything
  // other than http(s) so a compromised SDK response or upstream
  // injection cannot push `javascript:`, `data:`, or `file:` to the
  // developer's terminal. The MCP elicitation parser enforces the same
  // rule for gateway-vended URLs (mcp-meta.ts); this is the matching
  // chokepoint for SDK-vended URLs (e.g. GetResourceOauth2Token's
  // `authorizationUrl`).
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`Authorization URL has unsupported scheme "${u.protocol}". Only http and https are allowed.`);
  }
  u.searchParams.set('state', state);
  if (redirectUri && !u.searchParams.has('redirect_uri')) {
    u.searchParams.set('redirect_uri', redirectUri);
  }
  return u.toString();
}

/**
 * Format a `redirect_uri_mismatch` recovery message (task 2.14).
 *
 * The CLI never sees raw IdP errors directly — it sees an Identity-vended
 * authorization URL. This helper builds a remediation string the caller can
 * surface alongside the URL when consent fails because the IdP's registered
 * redirect URI doesn't match the AgentCore-managed `callbackUrl`.
 */
export function buildRedirectUriMismatchHint(args: {
  callbackUrl: string;
  gatewayName: string;
  targetName: string;
}): string {
  return [
    `Looks like your IdP rejected the redirect URI. Register this URL with your IdP and retry:`,
    `  ${args.callbackUrl}`,
    ``,
    `Run \`agentcore fetch access --target ${args.gatewayName}/${args.targetName} --json\` to read the URL programmatically.`,
  ].join('\n');
}
