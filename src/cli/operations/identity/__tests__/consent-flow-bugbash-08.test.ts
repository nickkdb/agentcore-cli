/**
 * Bug-bash suite 08 — headless / paste-URL consent strategy
 *
 * Probes:
 *  1. silent:true forces headlessPasteUrl even when detectHeadless returns false
 *  2. CI=true makes detectHeadless return true on every platform
 *  3. SSH_CONNECTION / SSH_TTY present but no DISPLAY — does detectHeadless fire?
 *  4. Pasted URL with no query parameters — clean error
 *  5. Pasted URL with non-http scheme — clean error
 *  6. Pasted URL with localhost host — should succeed (paste path ignores Host header)
 *  7. Concurrent headlessPasteUrl calls on same scopeId — no ConsentLockedError
 *  8. silent:true prints authorization URL to stderr
 */
import { ConsentLockedError, detectHeadless, runConsent } from '../consent-flow.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function runWithFakeStdin(
  opts: Parameters<typeof runConsent>[0],
  pasteUrlFactory: (printedAuthUrl: string) => string
): Promise<{ result: Awaited<ReturnType<typeof runConsent>>; stderr: string }> {
  const fakeStdin = new Readable({
    read() {
      /* no-op: data is pushed synchronously via .push() */
    },
  });
  const origStdin = process.stdin;
  Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });

  const stderrChunks: Buffer[] = [];
  const origWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: unknown, ...rest: unknown[]) => {
    stderrChunks.push(Buffer.from(typeof chunk === 'string' ? chunk : (chunk as Buffer)));
    return origWrite(chunk as never, ...(rest as never[]));
  }) as typeof process.stderr.write;

  const pasteSoon = setInterval(() => {
    const all = Buffer.concat(stderrChunks).toString('utf-8');
    const m = /(https?:\/\/[^\s]+)/.exec(all);
    if (m?.[1]) {
      clearInterval(pasteSoon);
      fakeStdin.push(pasteUrlFactory(m[1]) + '\n');
      fakeStdin.push(null);
    }
  }, 5);

  try {
    const result = await runConsent(opts);
    return { result, stderr: Buffer.concat(stderrChunks).toString('utf-8') };
  } finally {
    clearInterval(pasteSoon);
    process.stderr.write = origWrite;
    Object.defineProperty(process, 'stdin', { value: origStdin, configurable: true });
  }
}

async function runWithFixedPaste(
  opts: Parameters<typeof runConsent>[0],
  fixedPaste: string
): Promise<{ error: Error; stderr: string }> {
  const fakeStdin = new Readable({
    read() {
      /* no-op: data is pushed synchronously via .push() */
    },
  });
  const origStdin = process.stdin;
  Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });

  const stderrChunks: Buffer[] = [];
  const origWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: unknown, ...rest: unknown[]) => {
    stderrChunks.push(Buffer.from(typeof chunk === 'string' ? chunk : (chunk as Buffer)));
    return origWrite(chunk as never, ...(rest as never[]));
  }) as typeof process.stderr.write;

  fakeStdin.push(fixedPaste + '\n');
  fakeStdin.push(null);

  try {
    await runConsent(opts);
    return { error: new Error('expected rejection but resolved'), stderr: '' };
  } catch (err) {
    return { error: err as Error, stderr: Buffer.concat(stderrChunks).toString('utf-8') };
  } finally {
    process.stderr.write = origWrite;
    Object.defineProperty(process, 'stdin', { value: origStdin, configurable: true });
  }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('consent-flow bugbash 08 — headless / paste-URL strategy', () => {
  let savedHome: string | undefined;
  let homeDir: string;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'agentcore-bb08-'));
    savedHome = process.env.HOME;
    process.env.HOME = homeDir;
  });

  afterEach(() => {
    if (savedHome !== undefined) process.env.HOME = savedHome;
    else delete process.env.HOME;
    rmSync(homeDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Probe 1 — silent:true selects paste-URL even when detectHeadless => false
  // -------------------------------------------------------------------------
  it('probe 1: silent:true forces headlessPasteUrl regardless of detectHeadless', async () => {
    const openBrowser = vi.fn();

    const { result } = await runWithFakeStdin(
      {
        authorizationUrl: 'https://idp.example.com/oauth/authorize?client_id=probe1',
        consentScopeId: 'bb08-probe1',
        silent: true,
        hooks: {
          openBrowser,
          detectHeadless: () => false,
        },
      },
      printedUrl => {
        const u = new URL(printedUrl);
        const state = u.searchParams.get('state') ?? '';
        return `https://app.example.com/cb?code=probe1-code&state=${encodeURIComponent(state)}`;
      }
    );

    expect(result.strategyUsed).toBe('headlessPasteUrl');
    expect(result.code).toBe('probe1-code');
    expect(openBrowser).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Probe 2 — CI=true returns headless on darwin/win32/linux
  // -------------------------------------------------------------------------
  it('probe 2: CI=true triggers headless on all platforms', () => {
    const platforms: NodeJS.Platform[] = ['darwin', 'linux', 'win32'];
    for (const plat of platforms) {
      expect(detectHeadless(plat, { CI: 'true' }), `platform=${plat}`).toBe(true);
    }
    const origCI = process.env.CI;
    try {
      process.env.CI = 'true';
      expect(detectHeadless(process.platform, process.env)).toBe(true);
    } finally {
      if (origCI === undefined) delete process.env.CI;
      else process.env.CI = origCI;
    }
  });

  // -------------------------------------------------------------------------
  // Probe 3 — SSH session detection gap:
  //   SSH_TTY / SSH_CONNECTION appear in HeadlessEnv interface but are never
  //   read by detectHeadless. On macOS/Windows an SSH session will incorrectly
  //   return false and try to open a browser.
  // -------------------------------------------------------------------------
  it('probe 3 (linux): SSH env without DISPLAY still headless via existing linux check', () => {
    expect(detectHeadless('linux', { SSH_TTY: '/dev/pts/0' })).toBe(true);
    expect(detectHeadless('linux', { SSH_CONNECTION: '10.0.0.1 55100 10.0.0.2 22' })).toBe(true);
  });

  it('probe 3 (darwin): SSH_TTY on macOS is detected as headless (BB08 finding #1 fix)', () => {
    // SSH_TTY only, no CI, no DISPLAY. A developer SSHing into a Mac build host
    // gets paste-URL — confirmed fixed in commit 3cbd1af1 by adding
    // `if (env.SSH_TTY || env.SSH_CONNECTION) return true` to detectHeadless.
    expect(detectHeadless('darwin', { SSH_TTY: '/dev/pts/0' })).toBe(true);
  });

  it('probe 3 (win32): SSH_CONNECTION on Windows is detected as headless (BB08 finding #1 fix)', () => {
    expect(detectHeadless('win32', { SSH_CONNECTION: '10.0.0.1 55100 10.0.0.2 22' })).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Probe 4 — Pasted URL with no query string => descriptive error
  // -------------------------------------------------------------------------
  it('probe 4: pasted URL with no code/state yields a descriptive error', async () => {
    const { error } = await runWithFixedPaste(
      {
        authorizationUrl: 'https://idp.example.com/oauth/authorize?client_id=probe4',
        consentScopeId: 'bb08-probe4',
        strategy: 'headlessPasteUrl',
        hooks: { detectHeadless: () => true },
      },
      'https://app.example.com/cb'
    );

    expect(error.message).toMatch(/missing.*`?code`?|`?code`?.*missing/i);
  });

  // -------------------------------------------------------------------------
  // Probe 5 — Pasted URL with non-http scheme
  // -------------------------------------------------------------------------
  it('probe 5: pasted javascript: URL is rejected with a scheme error', async () => {
    const { error } = await runWithFixedPaste(
      {
        authorizationUrl: 'https://idp.example.com/oauth/authorize?client_id=probe5',
        consentScopeId: 'bb08-probe5',
        strategy: 'headlessPasteUrl',
        hooks: { detectHeadless: () => true },
      },
      'javascript:alert(1)'
    );

    expect(error.message).toMatch(/http|scheme|protocol/i);
    // Must NOT fall through to the missing-params check
    expect(error.message).not.toMatch(/missing.*`?code`?/i);
  });

  it('probe 5b: pasted ftp: URL is rejected with a scheme error', async () => {
    const { error } = await runWithFixedPaste(
      {
        authorizationUrl: 'https://idp.example.com/oauth/authorize?client_id=probe5b',
        consentScopeId: 'bb08-probe5b',
        strategy: 'headlessPasteUrl',
        hooks: { detectHeadless: () => true },
      },
      'ftp://attacker.example/steal?code=x&state=y'
    );

    expect(error.message).toMatch(/http|scheme|protocol/i);
  });

  // -------------------------------------------------------------------------
  // Probe 6 — Pasted URL with localhost host — should succeed
  // -------------------------------------------------------------------------
  it('probe 6: pasted localhost redirect URL is accepted (no Host-header enforcement)', async () => {
    const { result } = await runWithFakeStdin(
      {
        authorizationUrl: 'https://idp.example.com/oauth/authorize?client_id=probe6',
        consentScopeId: 'bb08-probe6',
        strategy: 'headlessPasteUrl',
        hooks: { detectHeadless: () => true },
      },
      printedUrl => {
        const u = new URL(printedUrl);
        const state = u.searchParams.get('state') ?? '';
        return `http://localhost:12345/callback?code=probe6-code&state=${encodeURIComponent(state)}`;
      }
    );

    expect(result.strategyUsed).toBe('headlessPasteUrl');
    expect(result.code).toBe('probe6-code');
  });

  // -------------------------------------------------------------------------
  // Probe 7 — Concurrent headlessPasteUrl on same scopeId — no ConsentLockedError
  // -------------------------------------------------------------------------
  it('probe 7: two concurrent headlessPasteUrl calls on same scopeId both succeed', async () => {
    const makeCall = () =>
      runWithFakeStdin(
        {
          authorizationUrl: 'https://idp.example.com/oauth/authorize?client_id=probe7',
          consentScopeId: 'bb08-probe7-shared',
          strategy: 'headlessPasteUrl',
          hooks: { detectHeadless: () => true },
        },
        printedUrl => {
          const u = new URL(printedUrl);
          const state = u.searchParams.get('state') ?? '';
          return `https://app.example.com/cb?code=probe7-code&state=${encodeURIComponent(state)}`;
        }
      );

    const [r1, r2] = await Promise.allSettled([makeCall(), makeCall()]);

    if (r1.status === 'rejected') {
      expect(r1.reason, 'first call must not throw ConsentLockedError').not.toBeInstanceOf(ConsentLockedError);
    }
    if (r2.status === 'rejected') {
      expect(r2.reason, 'second call must not throw ConsentLockedError').not.toBeInstanceOf(ConsentLockedError);
    }

    // Both should complete successfully
    expect(r1.status).toBe('fulfilled');
    expect(r2.status).toBe('fulfilled');
  });

  // -------------------------------------------------------------------------
  // Probe 8 — silent:true prints authorization URL to stderr
  // -------------------------------------------------------------------------
  it('probe 8: silent:true emits the authorization URL on stderr so non-interactive callers can scrape it', async () => {
    const { result, stderr } = await runWithFakeStdin(
      {
        authorizationUrl: 'https://idp.example.com/oauth/authorize?client_id=probe8',
        consentScopeId: 'bb08-probe8',
        silent: true,
        hooks: { detectHeadless: () => true },
      },
      printedUrl => {
        const u = new URL(printedUrl);
        const state = u.searchParams.get('state') ?? '';
        return `https://app.example.com/cb?code=probe8-code&state=${encodeURIComponent(state)}`;
      }
    );

    expect(stderr).toContain('https://idp.example.com/oauth/authorize');
    expect(result.code).toBe('probe8-code');
  });
});
