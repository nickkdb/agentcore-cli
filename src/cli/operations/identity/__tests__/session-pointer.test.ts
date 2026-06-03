import {
  SESSION_POINTER_SCHEMA_VERSION,
  getConsentRecord,
  getProjectIdentifier,
  recordConsent,
  sessionPointerPath,
} from '../session-pointer.js';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('session-pointer', () => {
  let tmpProject: string;
  let savedHome: string | undefined;
  let homeDir: string;

  beforeEach(() => {
    tmpProject = mkdtempSync(join(tmpdir(), 'agentcore-sp-proj-'));
    homeDir = mkdtempSync(join(tmpdir(), 'agentcore-sp-home-'));
    savedHome = process.env.HOME;
    process.env.HOME = homeDir;
  });

  afterEach(() => {
    if (savedHome !== undefined) process.env.HOME = savedHome;
    else delete process.env.HOME;
    rmSync(tmpProject, { recursive: true, force: true });
    rmSync(homeDir, { recursive: true, force: true });
  });

  it('getProjectIdentifier is deterministic', () => {
    expect(getProjectIdentifier(tmpProject)).toBe(getProjectIdentifier(tmpProject));
  });

  it('getProjectIdentifier returns 32 hex characters (128 bits)', () => {
    // Bumped from 16 to 32 hex chars to make collisions birthday-paradox-safe.
    expect(getProjectIdentifier(tmpProject)).toMatch(/^[0-9a-f]{32}$/);
  });

  it('different projects have different identifiers', () => {
    const otherProj = mkdtempSync(join(tmpdir(), 'agentcore-sp-other-'));
    try {
      expect(getProjectIdentifier(tmpProject)).not.toBe(getProjectIdentifier(otherProj));
    } finally {
      rmSync(otherProj, { recursive: true, force: true });
    }
  });

  it('records and retrieves a consent', () => {
    const fixed = new Date('2026-05-14T15:30:00Z');
    recordConsent({
      projectAbsPath: tmpProject,
      gatewayName: 'my-gw',
      targetName: 'cal-target',
      principal: 'arn:aws:iam::1:user/dev',
      strategy: 'browserLoopback',
      now: () => fixed,
    });

    const record = getConsentRecord(tmpProject, 'my-gw', 'cal-target');
    expect(record).toEqual({
      gatewayName: 'my-gw',
      targetName: 'cal-target',
      lastConsentedAt: '2026-05-14T15:30:00.000Z',
      strategy: 'browserLoopback',
    });
  });

  it('writes to the path computed from projectIdentifier', () => {
    recordConsent({
      projectAbsPath: tmpProject,
      gatewayName: 'gw',
      targetName: 'tgt',
    });
    const path = sessionPointerPath(tmpProject);
    expect(existsSync(path)).toBe(true);
    expect(path).toContain(getProjectIdentifier(tmpProject));
    expect(path).toContain(homeDir);
  });

  it('writes the file with mode 0600 (owner read/write only)', () => {
    recordConsent({ projectAbsPath: tmpProject, gatewayName: 'gw', targetName: 'tgt' });
    const stat = statSync(sessionPointerPath(tmpProject));
    // Mask off file-type bits, keep permission bits
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it('updates an existing pointer (preserves other consents)', () => {
    recordConsent({ projectAbsPath: tmpProject, gatewayName: 'gw', targetName: 'a' });
    recordConsent({ projectAbsPath: tmpProject, gatewayName: 'gw', targetName: 'b' });

    expect(getConsentRecord(tmpProject, 'gw', 'a')).toBeDefined();
    expect(getConsentRecord(tmpProject, 'gw', 'b')).toBeDefined();
  });

  it('returns undefined for a never-consented binding', () => {
    expect(getConsentRecord(tmpProject, 'gw', 'never')).toBeUndefined();
  });

  it('does NOT store any access/refresh tokens (only timestamps)', () => {
    recordConsent({ projectAbsPath: tmpProject, gatewayName: 'gw', targetName: 'tgt' });
    const raw = readFileSync(sessionPointerPath(tmpProject), 'utf-8');
    expect(raw).not.toMatch(/accessToken/i);
    expect(raw).not.toMatch(/refreshToken/i);
    expect(raw).not.toMatch(/Bearer /);
  });

  it('stamps schemaVersion on write', () => {
    recordConsent({ projectAbsPath: tmpProject, gatewayName: 'gw', targetName: 'tgt' });
    const raw = JSON.parse(readFileSync(sessionPointerPath(tmpProject), 'utf-8')) as { schemaVersion?: number };
    expect(raw.schemaVersion).toBe(SESSION_POINTER_SCHEMA_VERSION);
  });

  it('refuses to interpret a pointer file whose stored projectPath disagrees', () => {
    // Simulate either a sha256 collision or a foreign-machine pointer that
    // landed at our identifier path. Reader must NOT return it.
    const path = sessionPointerPath(tmpProject);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        schemaVersion: SESSION_POINTER_SCHEMA_VERSION,
        projectPath: '/some/other/project/that/is/not/ours',
        projectIdentifier: getProjectIdentifier(tmpProject),
        consents: { 'gw/tgt': { gatewayName: 'gw', targetName: 'tgt', lastConsentedAt: '2026-05-15T00:00:00Z' } },
      }),
      { mode: 0o600 }
    );
    expect(getConsentRecord(tmpProject, 'gw', 'tgt')).toBeUndefined();
  });

  it('refuses to interpret a pointer file from a future schemaVersion', () => {
    const path = sessionPointerPath(tmpProject);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        schemaVersion: SESSION_POINTER_SCHEMA_VERSION + 1,
        projectPath: tmpProject,
        projectIdentifier: getProjectIdentifier(tmpProject),
        consents: { 'gw/tgt': { gatewayName: 'gw', targetName: 'tgt', lastConsentedAt: '2026-05-15T00:00:00Z' } },
      }),
      { mode: 0o600 }
    );
    expect(getConsentRecord(tmpProject, 'gw', 'tgt')).toBeUndefined();
  });
});
