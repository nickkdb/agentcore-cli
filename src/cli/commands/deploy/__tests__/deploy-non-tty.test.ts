import { runCLI } from '../../../../test-utils/index.js';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Regression test for issue #982 (the command named in the bug title):
 * `agentcore deploy` (and any TUI-mode invocation) in a non-TTY context
 * must NOT crash with the Ink "Raw mode is not supported" error and must
 * NOT exit 0. It must exit 1 with a clear interactive-terminal message so
 * CI pipelines can detect the failure.
 *
 * The TUI path is reached when no flags are provided (and also for --diff).
 * Flag-bearing modes (--yes, --json, --dry-run, --target, --verbose) route
 * to the non-interactive CLI path which does not require a TTY and is not
 * the subject of this regression.
 */
describe('deploy command non-TTY behavior (issue #982)', () => {
  let testDir: string;
  let projectDir: string;

  beforeAll(async () => {
    testDir = join(tmpdir(), `agentcore-deploy-tty-${randomUUID()}`);
    projectDir = join(testDir, 'project');
    const configDir = join(projectDir, 'agentcore');
    await mkdir(configDir, { recursive: true });
    // Minimal valid project marker so requireProject() passes — guard
    // ordering means requireTTY() will fire first, but we keep a real
    // project dir so an accidental ordering regression surfaces clearly.
    await writeFile(join(configDir, 'agentcore.json'), JSON.stringify({ name: 'test', version: 1 }, null, 2), 'utf-8');
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('exits 1 with a clear message when run without flags in non-TTY (interactive path)', async () => {
    // runCLI uses stdio: ['ignore', 'pipe', 'pipe'] — both stdin and stdout
    // are non-TTY, exactly the scenario from the bug report.
    const result = await runCLI(['deploy'], projectDir);

    expect(result.exitCode).toBe(1);

    const combined = `${result.stdout}\n${result.stderr}`;
    expect(combined.toLowerCase()).toContain('requires an interactive terminal');
    expect(combined).not.toContain('Raw mode is not supported');
  });

  it('exits 1 cleanly with --diff in non-TTY (TUI diff path)', async () => {
    const result = await runCLI(['deploy', '--diff'], projectDir);

    expect(result.exitCode).toBe(1);

    const combined = `${result.stdout}\n${result.stderr}`;
    expect(combined).not.toContain('Raw mode is not supported');
  });
});
