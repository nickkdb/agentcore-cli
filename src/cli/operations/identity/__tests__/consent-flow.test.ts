/**
 * Tests for the consent-flow module — covers headless detection, the
 * concurrent-consent file lock with stale-PID reclaim and timeout, the
 * URL-mismatch hint builder, runConsent strategy selection, and the
 * loopback security defenses (DNS rebind / cross-origin / CSRF state).
 */
import {
  ConsentLockedError,
  acquireConsentLock,
  buildRedirectUriMismatchHint,
  detectHeadless,
  runConsent,
} from '../consent-flow.js';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('detectHeadless', () => {
  it('returns true in CI on any platform', () => {
    expect(detectHeadless('darwin', { CI: 'true' })).toBe(true);
    expect(detectHeadless('linux', { CI: '1' })).toBe(true);
    expect(detectHeadless('win32', { CI: 'true' })).toBe(true);
  });

  it('returns false on macOS without CI', () => {
    expect(detectHeadless('darwin', {})).toBe(false);
  });

  it('returns false on Windows without CI', () => {
    expect(detectHeadless('win32', {})).toBe(false);
  });

  it('returns true on Linux without DISPLAY/WAYLAND_DISPLAY', () => {
    expect(detectHeadless('linux', {})).toBe(true);
  });

  it('returns false on Linux with DISPLAY', () => {
    expect(detectHeadless('linux', { DISPLAY: ':0' })).toBe(false);
  });

  it('returns false on Linux with WAYLAND_DISPLAY', () => {
    expect(detectHeadless('linux', { WAYLAND_DISPLAY: 'wayland-0' })).toBe(false);
  });

  it('treats CI=false as not-CI', () => {
    expect(detectHeadless('darwin', { CI: 'false' })).toBe(false);
    expect(detectHeadless('darwin', { CI: '0' })).toBe(false);
  });

  it('treats SSH_TTY as headless on every platform (BB08 finding #1)', () => {
    expect(detectHeadless('darwin', { SSH_TTY: '/dev/pts/0' })).toBe(true);
    expect(detectHeadless('win32', { SSH_TTY: '/dev/pts/0' })).toBe(true);
    expect(detectHeadless('linux', { SSH_TTY: '/dev/pts/0', DISPLAY: ':0' })).toBe(true);
  });

  it('treats SSH_CONNECTION as headless on every platform (BB08 finding #1)', () => {
    expect(detectHeadless('darwin', { SSH_CONNECTION: '1.2.3.4 22 5.6.7.8 22' })).toBe(true);
    expect(detectHeadless('linux', { SSH_CONNECTION: '1.2.3.4 22 5.6.7.8 22', DISPLAY: ':0' })).toBe(true);
  });
});

describe('acquireConsentLock', () => {
  let savedHome: string | undefined;
  let homeDir: string;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'agentcore-cl-'));
    savedHome = process.env.HOME;
    process.env.HOME = homeDir;
  });
  afterEach(() => {
    if (savedHome !== undefined) process.env.HOME = savedHome;
    else delete process.env.HOME;
    rmSync(homeDir, { recursive: true, force: true });
  });

  it('first acquire succeeds; releases cleanly', () => {
    const lock = acquireConsentLock('scope-A');
    lock.release();
  });

  it('second acquire by a different scope succeeds (locks are per-scope)', () => {
    const a = acquireConsentLock('scope-A');
    const b = acquireConsentLock('scope-B');
    a.release();
    b.release();
  });

  it('second acquire of the same scope by a live process throws ConsentLockedError', () => {
    const a = acquireConsentLock('scope-A');
    try {
      expect(() => acquireConsentLock('scope-A')).toThrow(ConsentLockedError);
    } finally {
      a.release();
    }
  });

  it('reclaims a stale lock whose PID is dead', () => {
    const sessionsDir = join(homeDir, '.agentcore', 'identity-sessions');
    mkdirSync(sessionsDir, { recursive: true });
    const hash = createHash('sha256').update('scope-A').digest('hex').slice(0, 16);
    const lockPath = join(sessionsDir, `.lock-${hash}`);
    writeFileSync(lockPath, JSON.stringify({ pid: 999999, startedAt: Date.now() }));
    const lock = acquireConsentLock('scope-A');
    lock.release();
  });

  it('reclaims a lock older than 5 minutes', () => {
    const sessionsDir = join(homeDir, '.agentcore', 'identity-sessions');
    mkdirSync(sessionsDir, { recursive: true });
    const hash = createHash('sha256').update('scope-A').digest('hex').slice(0, 16);
    const lockPath = join(sessionsDir, `.lock-${hash}`);
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: Date.now() - 10 * 60 * 1000 }));
    const lock = acquireConsentLock('scope-A');
    lock.release();
  });

  it('reclaims a corrupt lock file', () => {
    const sessionsDir = join(homeDir, '.agentcore', 'identity-sessions');
    mkdirSync(sessionsDir, { recursive: true });
    const hash = createHash('sha256').update('scope-A').digest('hex').slice(0, 16);
    const lockPath = join(sessionsDir, `.lock-${hash}`);
    writeFileSync(lockPath, '{ this is not json');
    const lock = acquireConsentLock('scope-A');
    lock.release();
  });

  it('TOCTOU race: another process creates the lock between reclaim and write — surfaces ConsentLockedError, not raw EEXIST', () => {
    const sessionsDir = join(homeDir, '.agentcore', 'identity-sessions');
    mkdirSync(sessionsDir, { recursive: true });
    const hash = createHash('sha256').update('scope-A').digest('hex').slice(0, 16);
    const lockPath = join(sessionsDir, `.lock-${hash}`);
    // Pre-existing live lock simulating the race: stale-reclaim path runs,
    // unlinks it, but a sibling process beats us to the wx write.
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
    expect(() => acquireConsentLock('scope-A')).toThrow(ConsentLockedError);
  });
});

describe('buildRedirectUriMismatchHint', () => {
  it('surfaces the callback URL, the fetch-access command, and the gateway/target', () => {
    const msg = buildRedirectUriMismatchHint({
      callbackUrl: 'https://bedrock-agentcore.us-west-2.amazonaws.com/identities/oauth2/callback/abc',
      gatewayName: 'gw',
      targetName: 'cal',
    });
    expect(msg).toContain('https://bedrock-agentcore.us-west-2.amazonaws.com/identities/oauth2/callback/abc');
    expect(msg).toContain('agentcore fetch access');
    expect(msg).toContain('gw/cal');
  });
});

// ---------------------------------------------------------------------------
// runConsent — strategy selection (mocked)
//
// `state` is generated locally by runConsent and verified on the way back.
// Tests echo whatever state they observe in the opened/printed URL, so the
// CSRF round-trip succeeds without hard-coding a value.
// ---------------------------------------------------------------------------

describe('runConsent — strategy selection (mocked)', () => {
  let savedHome: string | undefined;
  let homeDir: string;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'agentcore-rc-'));
    savedHome = process.env.HOME;
    process.env.HOME = homeDir;
  });
  afterEach(() => {
    if (savedHome !== undefined) process.env.HOME = savedHome;
    else delete process.env.HOME;
    rmSync(homeDir, { recursive: true, force: true });
  });

  it('uses browserLoopback when not headless and silent is false (state round-trip)', async () => {
    let openedUrl: string | undefined;
    const openBrowser = vi.fn((url: string) => {
      openedUrl = url;
      const idp = new URL(url);
      const redirectUri = idp.searchParams.get('redirect_uri');
      const expectedState = idp.searchParams.get('state');
      if (!redirectUri || !expectedState) return;
      const cb = new URL(redirectUri);
      const req = http.request(
        {
          method: 'GET',
          host: '127.0.0.1',
          port: cb.port,
          path: `/callback?code=test-code&state=${encodeURIComponent(expectedState)}`,
        },
        res => res.resume()
      );
      req.on('error', () => undefined);
      req.end();
    });

    const result = await runConsent({
      authorizationUrl: 'https://idp.example.com/oauth/authorize?client_id=abc',
      consentScopeId: 'p1/gw/loopback',
      hooks: { openBrowser, detectHeadless: () => false },
    });

    expect(result.strategyUsed).toBe('browserLoopback');
    expect(result.code).toBe('test-code');
    expect(result.state).toBe(new URL(openedUrl!).searchParams.get('state'));
    expect(openedUrl).toContain('redirect_uri=');
    expect(openedUrl).toContain('state=');
  });

  it('throws ConsentMismatchError when callback state does not match local state', async () => {
    const openBrowser = vi.fn((url: string) => {
      const idp = new URL(url);
      const redirectUri = idp.searchParams.get('redirect_uri');
      if (!redirectUri) return;
      const cb = new URL(redirectUri);
      const req = http.request(
        {
          method: 'GET',
          host: '127.0.0.1',
          port: cb.port,
          path: '/callback?code=attacker-code&state=attacker-state',
        },
        res => res.resume()
      );
      req.on('error', () => undefined);
      req.end();
    });

    await expect(
      runConsent({
        authorizationUrl: 'https://idp.example.com/oauth/authorize',
        consentScopeId: 'csrf-test',
        hooks: { openBrowser, detectHeadless: () => false },
      })
    ).rejects.toThrow(/state mismatch/i);
  });

  async function pasteUrlConsent(scopeId: string, opts?: { strategy?: 'headlessPasteUrl' }) {
    const openBrowser = vi.fn();
    const fakeStdin = new Readable({
      read() {
        // no-op — content is pushed externally below
      },
    });
    const origStdin = process.stdin;
    Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });

    const stderrChunks: Buffer[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: unknown, ...rest: unknown[]) => {
      stderrChunks.push(Buffer.from(typeof chunk === 'string' ? chunk : (chunk as Buffer)));
      return origWrite(chunk as never, ...(rest as []));
    }) as typeof process.stderr.write;

    const pasteSoon = setInterval(() => {
      const all = Buffer.concat(stderrChunks).toString('utf-8');
      const m = /(https:\/\/idp\.example\.com\/oauth\/authorize[^\s]*)/.exec(all);
      if (m?.[1]) {
        const u = new URL(m[1]);
        const state = u.searchParams.get('state') ?? '';
        fakeStdin.push(`https://app.example.com/cb?code=pasted-code&state=${encodeURIComponent(state)}\n`);
        fakeStdin.push(null);
        clearInterval(pasteSoon);
      }
    }, 5);

    try {
      const result = await runConsent({
        authorizationUrl: 'https://idp.example.com/oauth/authorize',
        consentScopeId: scopeId,
        ...(opts?.strategy ? { strategy: opts.strategy } : {}),
        hooks: { openBrowser, detectHeadless: () => true },
      });
      return { result, openBrowserCalls: openBrowser.mock.calls.length };
    } finally {
      clearInterval(pasteSoon);
      process.stderr.write = origWrite;
      Object.defineProperty(process, 'stdin', { value: origStdin, configurable: true });
    }
  }

  it('chooses headlessPasteUrl when detectHeadless returns true (does not open browser)', async () => {
    const { result, openBrowserCalls } = await pasteUrlConsent('p1/gw/headless');
    expect(result.strategyUsed).toBe('headlessPasteUrl');
    expect(result.code).toBe('pasted-code');
    expect(openBrowserCalls).toBe(0);
  });

  it('honors explicit strategy override (headlessPasteUrl on a non-headless host)', async () => {
    const { result, openBrowserCalls } = await pasteUrlConsent('p1/gw/explicit', { strategy: 'headlessPasteUrl' });
    expect(result.strategyUsed).toBe('headlessPasteUrl');
    expect(openBrowserCalls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Loopback security: DNS rebind, cross-origin, method, paste-URL scheme
// ---------------------------------------------------------------------------

describe('Loopback security', () => {
  let savedHome: string | undefined;
  let homeDir: string;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'agentcore-loopsec-'));
    savedHome = process.env.HOME;
    process.env.HOME = homeDir;
  });
  afterEach(() => {
    if (savedHome !== undefined) process.env.HOME = savedHome;
    else delete process.env.HOME;
    rmSync(homeDir, { recursive: true, force: true });
  });

  /**
   * Spin up runConsent, capture the loopback port from the URL the fake
   * browser is asked to open, run an attack request, then satisfy the flow
   * with a correct callback so the listener exits.
   */
  async function probeLoopback(attack: (port: number) => Promise<number>): Promise<number> {
    let attackStatus = 0;
    const openBrowser = vi.fn((url: string) => {
      const idp = new URL(url);
      const redirectUri = idp.searchParams.get('redirect_uri') ?? '';
      const expectedState = idp.searchParams.get('state') ?? '';
      const port = parseInt(new URL(redirectUri).port, 10);
      // Run the attack request and the legitimate callback in fire-and-forget
      // mode — runConsent's awaited promise will resolve once a valid callback
      // arrives.
      void (async () => {
        attackStatus = await attack(port);
        const finishReq = http.request({
          method: 'GET',
          host: '127.0.0.1',
          port,
          path: `/callback?code=ok&state=${encodeURIComponent(expectedState)}`,
        });
        finishReq.on('error', () => undefined);
        finishReq.end();
      })();
    });
    await runConsent({
      authorizationUrl: 'https://idp.example.com/oauth/authorize',
      consentScopeId: `loopsec-${Math.random()}`,
      hooks: { openBrowser, detectHeadless: () => false },
    });
    return attackStatus;
  }

  it('rejects requests with a non-loopback Host header (DNS rebind defense)', async () => {
    const status = await probeLoopback(
      port =>
        new Promise<number>((resolve, reject) => {
          const req = http.request(
            {
              method: 'GET',
              host: '127.0.0.1',
              port,
              path: '/callback?code=x&state=y',
              headers: { Host: 'attacker.example' },
            },
            res => {
              res.resume();
              resolve(res.statusCode ?? 0);
            }
          );
          req.on('error', reject);
          req.end();
        })
    );
    expect(status).toBe(403);
  });

  it('rejects requests carrying an Origin header (cross-origin defense)', async () => {
    const status = await probeLoopback(
      port =>
        new Promise<number>((resolve, reject) => {
          const req = http.request(
            {
              method: 'GET',
              host: '127.0.0.1',
              port,
              path: '/callback?code=x&state=y',
              headers: { Origin: 'http://attacker.example' },
            },
            res => {
              res.resume();
              resolve(res.statusCode ?? 0);
            }
          );
          req.on('error', reject);
          req.end();
        })
    );
    expect(status).toBe(403);
  });

  it('rejects POST requests (method allowlist)', async () => {
    const status = await probeLoopback(
      port =>
        new Promise<number>((resolve, reject) => {
          const req = http.request(
            {
              method: 'POST',
              host: '127.0.0.1',
              port,
              path: '/callback?code=x&state=y',
            },
            res => {
              res.resume();
              resolve(res.statusCode ?? 0);
            }
          );
          req.on('error', reject);
          req.end();
        })
    );
    expect(status).toBe(405);
  });

  it('rejects non-http(s) authorization URL ("javascript:") before opening a browser', async () => {
    const openBrowser = vi.fn();
    await expect(
      runConsent({
        authorizationUrl: 'javascript:alert(1)',
        consentScopeId: 'p1/gw/jsscheme',
        hooks: { openBrowser, detectHeadless: () => false },
      })
    ).rejects.toThrow(/unsupported scheme/i);
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it('rejects non-http(s) authorization URL ("data:") before opening a browser', async () => {
    const openBrowser = vi.fn();
    await expect(
      runConsent({
        authorizationUrl: 'data:text/html,<script>alert(1)</script>',
        consentScopeId: 'p1/gw/dataScheme',
        hooks: { openBrowser, detectHeadless: () => false },
      })
    ).rejects.toThrow(/unsupported scheme/i);
    expect(openBrowser).not.toHaveBeenCalled();
  });
});
