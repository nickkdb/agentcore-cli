import { resolveUIDistDir } from '../web-server.js';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const testDir = dirname(fileURLToPath(import.meta.url));
const bundledExists = existsSync(
  join(
    testDir,
    '..',
    '..',
    '..',
    '..',
    '..',
    '..',
    'node_modules',
    '@aws',
    'agent-inspector',
    'dist-assets',
    'index.html'
  )
);

describe('resolveUIDistDir', () => {
  const originalEnv = process.env;
  let tmpDir: string;

  beforeEach(() => {
    process.env = { ...originalEnv };
    tmpDir = mkdtempSync(join(tmpdir(), 'resolve-ui-test-'));
    delete process.env.AGENT_INSPECTOR_PATH;
  });

  afterEach(() => {
    process.env = originalEnv;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it.skipIf(bundledExists)('returns null when no candidate has index.html', () => {
    // AGENT_INSPECTOR_PATH points to empty dir, bundled candidates don't exist in test env
    process.env.AGENT_INSPECTOR_PATH = join(tmpDir, 'empty');

    expect(resolveUIDistDir()).toBeNull();
  });

  it('returns AGENT_INSPECTOR_PATH when env var is set and dir has index.html', () => {
    process.env.AGENT_INSPECTOR_PATH = tmpDir;
    writeFileSync(join(tmpDir, 'index.html'), '<html></html>');

    expect(resolveUIDistDir()).toBe(tmpDir);
  });

  it.skipIf(bundledExists)('skips AGENT_INSPECTOR_PATH when env var is set but dir lacks index.html', () => {
    process.env.AGENT_INSPECTOR_PATH = tmpDir;

    expect(resolveUIDistDir()).toBeNull();
  });

  it('prefers AGENT_INSPECTOR_PATH over bundled candidates', () => {
    process.env.AGENT_INSPECTOR_PATH = tmpDir;
    writeFileSync(join(tmpDir, 'index.html'), '<html></html>');

    expect(resolveUIDistDir()).toBe(tmpDir);
  });
});
