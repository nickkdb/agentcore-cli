import { runCLI } from '../../../../test-utils/index.js';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Regression test for issue #982:
 * Running `agentcore import` (interactive TUI path) with a non-TTY stdin/stdout
 * must NOT crash with the Ink "Raw mode is not supported" error and must NOT
 * exit 0. It must exit 1 with a clear interactive-terminal message so that
 * CI pipelines can detect the failure.
 */
describe('import command non-TTY behavior (issue #982)', () => {
  let testDir: string;
  let projectDir: string;

  beforeAll(async () => {
    testDir = join(tmpdir(), `agentcore-import-tty-${randomUUID()}`);
    projectDir = join(testDir, 'project');
    const configDir = join(projectDir, 'agentcore');
    await mkdir(configDir, { recursive: true });
    // Minimal valid project marker so requireProject() passes.
    await writeFile(join(configDir, 'agentcore.json'), JSON.stringify({ name: 'test', version: 1 }, null, 2), 'utf-8');
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('exits non-zero with a clear message when stdin is not a TTY', async () => {
    // runCLI uses stdio: ['ignore', 'pipe', 'pipe'] — both stdin and stdout
    // are non-TTY, exactly the scenario from the bug report.
    const result = await runCLI(['import'], projectDir);

    expect(result.exitCode).toBe(1);

    const combined = `${result.stdout}\n${result.stderr}`;
    expect(combined.toLowerCase()).toContain('requires an interactive terminal');
    expect(combined).not.toContain('Raw mode is not supported');
  });
});
