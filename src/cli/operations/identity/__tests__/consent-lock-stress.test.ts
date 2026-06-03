/**
 * Stress / bug-bash tests for acquireConsentLock and runConsent lock lifecycle.
 * Scenarios 1-8 per the bug-bash brief.
 *
 * Run from repo root:
 *   npx vitest run --project unit \
 *     src/cli/operations/identity/__tests__/consent-lock-stress.test.ts
 */
import { ConsentLockedError, acquireConsentLock, runConsent } from '../consent-flow.js';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lockPathFor(homeDir: string, scopeId: string): string {
  const hash = createHash('sha256').update(scopeId).digest('hex').slice(0, 16);
  return join(homeDir, '.agentcore', 'identity-sessions', `.lock-${hash}`);
}

function sessionsDir(homeDir: string): string {
  return join(homeDir, '.agentcore', 'identity-sessions');
}

function ensureSessionsDir(homeDir: string): void {
  mkdirSync(sessionsDir(homeDir), { recursive: true });
}

// ---------------------------------------------------------------------------
// Main stress suite
// ---------------------------------------------------------------------------

describe('consent-lock stress scenarios', () => {
  let savedHome: string | undefined;
  let homeDir: string;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'bugbash-cl-'));
    savedHome = process.env.HOME;
    process.env.HOME = homeDir;
  });

  afterEach(() => {
    if (savedHome !== undefined) process.env.HOME = savedHome;
    else delete process.env.HOME;
    try {
      chmodSync(join(homeDir, '.agentcore'), 0o700);
    } catch {
      /* ignore */
    }
    rmSync(homeDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Scenario 1: Concurrent same-scope acquire
  // Two callers acquire the same scope — the second must get ConsentLockedError,
  // not silently succeed or deadlock.
  // -------------------------------------------------------------------------
  it('scenario 1 – second acquire of same scope throws ConsentLockedError', () => {
    const scope = 'p1/gw/tgt';
    const lock1 = acquireConsentLock(scope);
    try {
      expect(() => acquireConsentLock(scope)).toThrow(ConsentLockedError);
    } finally {
      lock1.release();
    }
    // After release the scope must be acquirable again
    const lock2 = acquireConsentLock(scope);
    lock2.release();
  });

  // -------------------------------------------------------------------------
  // Scenario 2: Stale-PID reclaim correctness
  // Lock has pid=999999 (dead) and startedAt=recent (< 5 min).
  // Clock is advanced only 1 second — timeout branch would NOT fire.
  // Reclaim must happen via the dead-PID branch.
  // -------------------------------------------------------------------------
  it('scenario 2 – stale dead-PID reclaimed even when age < timeout', () => {
    const scope = 'scope-stalePid';
    ensureSessionsDir(homeDir);
    const lockedAt = Date.now();
    writeFileSync(lockPathFor(homeDir, scope), JSON.stringify({ pid: 999999, startedAt: lockedAt }));

    // Fake clock: only 1 s elapsed — well within 5-min LOCK_TIMEOUT_MS
    const nowFake = () => lockedAt + 1_000;

    const lock = acquireConsentLock(scope, nowFake);
    lock.release();
  });

  // -------------------------------------------------------------------------
  // Scenario 3: PID-reuse hazard — timeout branch wins over live-PID check
  // Lock has pid=process.pid (live!) but startedAt 6 min ago (> 5-min limit).
  // Because the code checks age BEFORE liveness, the timeout branch fires
  // and reclaims the lock despite the PID being alive.
  // -------------------------------------------------------------------------
  it('scenario 3 – timeout-reclaim wins even when PID is live (pid-reuse safety)', () => {
    const scope = 'scope-pidReuse';
    ensureSessionsDir(homeDir);
    writeFileSync(
      lockPathFor(homeDir, scope),
      JSON.stringify({ pid: process.pid, startedAt: Date.now() - 6 * 60 * 1000 })
    );
    const lock = acquireConsentLock(scope);
    lock.release();
  });

  // -------------------------------------------------------------------------
  // Scenario 4: EACCES on mkdirSync
  // chmod 000 on ~/.agentcore so mkdirSync('.agentcore/identity-sessions')
  // fails with EACCES.  The error must propagate — not be swallowed — and
  // the caller should receive a useful error (FINDING: currently raw EACCES).
  // -------------------------------------------------------------------------
  it('scenario 4 – EACCES propagates (not silently swallowed)', () => {
    if (process.getuid?.() === 0) {
      // root ignores mode bits — skip
      return;
    }
    const agentcoreDir = join(homeDir, '.agentcore');
    mkdirSync(agentcoreDir, { recursive: true });
    chmodSync(agentcoreDir, 0o000);

    let thrown: unknown;
    try {
      acquireConsentLock('scope-eacces');
    } catch (e) {
      thrown = e;
    } finally {
      chmodSync(agentcoreDir, 0o700);
    }

    expect(thrown).toBeDefined();
    const err = thrown as Error & { cause?: unknown };
    // Error is now wrapped with agentcore-level context (BB09 #1 fix).
    expect(err.message).toMatch(/consent lock directory/i);
    // The path is preserved so the user can see which directory failed:
    expect(err.message).toContain('identity-sessions');
    // The original EACCES/EPERM is preserved as `cause` so callers that
    // need the OS error code can still get to it.
    const cause = err.cause as NodeJS.ErrnoException | undefined;
    expect(cause).toBeDefined();
    expect(cause?.code).toMatch(/^E(ACCES|PERM)$/);
  });

  // -------------------------------------------------------------------------
  // Scenario 5: EEXIST race after stale reclaim (TOCTOU)
  // Pre-write a live lock (current PID, fresh timestamp) so that
  // acquireConsentLock sees a live lock and throws ConsentLockedError.
  // Verify it is NOT a raw EEXIST — the fix in 648cfe45 wraps it.
  // -------------------------------------------------------------------------
  it('scenario 5 – TOCTOU EEXIST is wrapped in ConsentLockedError, not raw', () => {
    const scope = 'scope-toctou';
    ensureSessionsDir(homeDir);
    writeFileSync(lockPathFor(homeDir, scope), JSON.stringify({ pid: process.pid, startedAt: Date.now() }));

    let thrown: unknown;
    try {
      acquireConsentLock(scope);
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(ConsentLockedError);
    expect((thrown as NodeJS.ErrnoException).code).not.toBe('EEXIST');
  });

  // -------------------------------------------------------------------------
  // Scenario 6: Lock release after exception in runConsent
  // Use timeoutMs=100 so ConsentTimeoutError fires almost immediately.
  // The finally block in runConsent must release the lock file.
  // -------------------------------------------------------------------------
  it('scenario 6 – lock file absent after runConsent throws ConsentTimeoutError', async () => {
    const scope = 'scope-lockRelease';
    const lockFile = lockPathFor(homeDir, scope);

    await expect(
      runConsent({
        authorizationUrl: 'https://idp.example.com/oauth/authorize',
        consentScopeId: scope,
        timeoutMs: 100,
        hooks: {
          openBrowser: () => undefined, // do nothing — loopback will time out
          detectHeadless: () => false,
        },
      })
    ).rejects.toThrow('Consent flow did not complete');

    expect(existsSync(lockFile)).toBe(false);
  }, 10_000);

  // -------------------------------------------------------------------------
  // Scenario 7: Lock NOT acquired for headlessPasteUrl
  // strategy:'headlessPasteUrl' must leave no .lock-* file.
  // -------------------------------------------------------------------------
  it('scenario 7 – no lock file created for headlessPasteUrl strategy', async () => {
    const scope = 'scope-pasteNoLock';
    const sDir = sessionsDir(homeDir);

    function lockCount(): number {
      if (!existsSync(sDir)) return 0;
      return readdirSync(sDir).filter(f => f.startsWith('.lock-')).length;
    }

    expect(lockCount()).toBe(0);

    // Drive paste-URL flow with a fake stdin that echoes the state back
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
      return origWrite(chunk as never, ...(rest as []));
    }) as typeof process.stderr.write;

    const pasteSoon = setInterval(() => {
      const all = Buffer.concat(stderrChunks).toString('utf-8');
      const m = /(https:\/\/idp\.example\.com\/oauth\/authorize[^\s]*)/.exec(all);
      if (m?.[1]) {
        const u = new URL(m[1]);
        const state = u.searchParams.get('state') ?? '';
        fakeStdin.push(`https://app.example.com/cb?code=pasted&state=${encodeURIComponent(state)}\n`);
        fakeStdin.push(null);
        clearInterval(pasteSoon);
      }
    }, 5);

    try {
      await runConsent({
        authorizationUrl: 'https://idp.example.com/oauth/authorize',
        consentScopeId: scope,
        strategy: 'headlessPasteUrl',
        hooks: { detectHeadless: () => true },
      });
    } finally {
      clearInterval(pasteSoon);
      process.stderr.write = origWrite;
      Object.defineProperty(process, 'stdin', { value: origStdin, configurable: true });
    }

    expect(lockCount()).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Scenario 8: Corrupt lock file — zero bytes
  // A zero-byte file fails JSON.parse.  The catch block marks it stale.
  // Reclaim must succeed and the subsequent acquire must work.
  // -------------------------------------------------------------------------
  it('scenario 8 – zero-byte corrupt lock file is reclaimed', () => {
    const scope = 'scope-zeroByte';
    ensureSessionsDir(homeDir);
    writeFileSync(lockPathFor(homeDir, scope), '');
    const lock = acquireConsentLock(scope);
    lock.release();
  });
});
