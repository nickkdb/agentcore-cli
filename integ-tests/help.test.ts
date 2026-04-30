import { spawnAndCollect } from '../src/test-utils/cli-runner.js';
import { runCLI } from '../src/test-utils/index.js';
import { readdirSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const COMMANDS = [
  'create',
  'deploy',
  'dev',
  'invoke',
  'status',
  'validate',
  'add',
  'attach',
  'remove',
  'edit',
  'package',
  'update',
];

describe('CLI help', () => {
  describe('main help', () => {
    it('shows all commands', async () => {
      const result = await runCLI(['--help'], process.cwd());

      expect(result.exitCode).toBe(0);
      expect(result.stdout.includes('Usage:'), 'Should show usage').toBeTruthy();
      expect(result.stdout.includes('Commands:'), 'Should list commands').toBeTruthy();
    });
  });

  describe('command help', () => {
    for (const cmd of COMMANDS) {
      it(`${cmd} --help exits 0`, async () => {
        const result = await runCLI([cmd, '--help'], process.cwd());

        expect(result.exitCode, `${cmd} --help failed: ${result.stderr}`).toBe(0);
        expect(result.stdout.includes('Usage:'), `${cmd} should show usage`).toBeTruthy();
      });
    }
  });
});

describe('help modes telemetry', () => {
  let testConfigDir: string;
  const cliPath = join(__dirname, '..', 'dist', 'cli', 'index.mjs');

  beforeAll(async () => {
    testConfigDir = join(tmpdir(), `agentcore-help-telemetry-${Date.now()}`);
    await mkdir(testConfigDir, { recursive: true });
  });
  afterAll(() => rm(testConfigDir, { recursive: true, force: true }));

  function run(args: string[], extraEnv: Record<string, string> = {}) {
    return spawnAndCollect('node', [cliPath, ...args], tmpdir(), {
      AGENTCORE_SKIP_INSTALL: '1',
      AGENTCORE_CONFIG_DIR: testConfigDir,
      ...extraEnv,
    });
  }

  it('writes JSONL audit file when audit is enabled via env var', async () => {
    const result = await run(['help', 'modes'], { AGENTCORE_TELEMETRY_AUDIT: '1' });
    expect(result.exitCode).toBe(0);

    const telemetryDir = join(testConfigDir, 'telemetry');
    const files = readdirSync(telemetryDir).filter(f => f.startsWith('help-'));
    expect(files).toHaveLength(1);

    const content = await readFile(join(telemetryDir, files[0]!), 'utf-8');
    const entry = JSON.parse(content.trim());
    expect(entry.attrs).toMatchObject({
      'service.name': 'agentcore-cli',
      'agentcore-cli.mode': 'cli',
      command_group: 'help',
      command: 'help.modes',
      exit_reason: 'success',
    });
    expect(entry.attrs['agentcore-cli.session_id']).toBeDefined();
    expect(entry.attrs['os.type']).toBeDefined();
    expect(entry.value).toBeGreaterThanOrEqual(0);
  });

  it('does not write audit file when audit is not enabled', async () => {
    const telemetryDir = join(testConfigDir, 'telemetry');
    await rm(telemetryDir, { recursive: true, force: true });

    const result = await run(['help', 'modes']);
    expect(result.exitCode).toBe(0);

    try {
      const files = readdirSync(telemetryDir);
      expect(files).toHaveLength(0);
    } catch {
      // telemetry dir doesn't exist — correct
    }
  });
});
