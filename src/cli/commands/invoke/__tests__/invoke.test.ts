import { createTelemetryHelper, runCLI } from '../../../../test-utils/index.js';
import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

describe('invoke command', () => {
  let testDir: string;
  let projectDir: string;
  const telemetry = createTelemetryHelper();

  beforeAll(async () => {
    testDir = join(tmpdir(), `agentcore-invoke-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });

    // Create project with agent
    const projectName = 'InvokeTestProj';
    let result = await runCLI(['create', '--name', projectName, '--no-agent'], testDir);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to create project: ${result.stdout} ${result.stderr}`);
    }
    projectDir = join(testDir, projectName);

    // Add an agent
    result = await runCLI(
      [
        'add',
        'agent',
        '--name',
        'TestAgent',
        '--language',
        'Python',
        '--framework',
        'Strands',
        '--model-provider',
        'Bedrock',
        '--memory',
        'none',
        '--json',
      ],
      projectDir
    );
    if (result.exitCode !== 0) {
      throw new Error(`Failed to create agent: ${result.stdout} ${result.stderr}`);
    }
  });

  afterEach(() => {
    telemetry.clearEntries();
  });

  afterAll(async () => {
    telemetry.destroy();
    await rm(testDir, { recursive: true, force: true });
  });

  describe('validation', () => {
    it('requires prompt for JSON output', async () => {
      const result = await runCLI(['invoke', '--json'], projectDir, { env: telemetry.env });
      expect(result.exitCode).toBe(1);
      const json = JSON.parse(result.stdout);
      expect(json.success).toBe(false);
      expect(json.error.includes('Prompt'), `Error should mention Prompt: ${json.error}`).toBeTruthy();
      telemetry.assertMetricEmitted({
        command: 'invoke',
        exit_reason: 'failure',
        has_stream: false,
        has_session_id: false,
        auth_type: 'sigv4',
      });
    });
  });

  describe('agent validation', () => {
    it('rejects non-existent agent', async () => {
      const result = await runCLI(['invoke', 'hello', '--runtime', 'nonexistent', '--json'], projectDir, {
        env: telemetry.env,
      });
      expect(result.exitCode).toBe(1);
      const json = JSON.parse(result.stdout);
      expect(json.success).toBe(false);
      expect(
        json.error.includes('not found') || json.error.includes('No deployed'),
        `Error should mention not found: ${json.error}`
      ).toBeTruthy();
      telemetry.assertMetricEmitted({
        command: 'invoke',
        exit_reason: 'failure',
        agent_protocol: 'http',
        auth_type: 'sigv4',
        has_session_id: false,
      });
    });
  });

  describe('streaming', () => {
    it('command accepts --stream flag', async () => {
      const result = await runCLI(['invoke', 'hello', '--stream', '--json'], projectDir, { env: telemetry.env });
      expect(result.exitCode).toBe(1);
      const json = JSON.parse(result.stdout);
      expect(json.success).toBe(false);
      // Should fail because not deployed, not because of invalid flags
      telemetry.assertMetricEmitted({
        command: 'invoke',
        has_stream: true,
        exit_reason: 'failure',
        auth_type: 'sigv4',
        has_session_id: false,
      });
    });

    it('--stream with invalid agent returns error', async () => {
      const result = await runCLI(['invoke', 'hello', '--stream', '--runtime', 'nonexistent', '--json'], projectDir, {
        env: telemetry.env,
      });
      expect(result.exitCode).toBe(1);
      const json = JSON.parse(result.stdout);
      expect(json.success).toBe(false);
      expect(json.error.length > 0, 'Should have error message').toBeTruthy();
      telemetry.assertMetricEmitted({
        command: 'invoke',
        has_stream: true,
        exit_reason: 'failure',
        auth_type: 'sigv4',
      });
    });

    it('requires prompt for streaming', async () => {
      const result = await runCLI(['invoke', '--stream', '--json'], projectDir, { env: telemetry.env });
      expect(result.exitCode).toBe(1);
      const json = JSON.parse(result.stdout);
      expect(json.success).toBe(false);
      expect(
        json.error.toLowerCase().includes('prompt') || json.error.toLowerCase().includes('deploy'),
        `Error should mention prompt or deployment: ${json.error}`
      ).toBeTruthy();
      telemetry.assertMetricEmitted({
        command: 'invoke',
        has_stream: true,
        exit_reason: 'failure',
        auth_type: 'sigv4',
        has_session_id: false,
      });
    });
  });

  describe('bearer token auth', () => {
    it('records auth_type bearer_token', async () => {
      const result = await runCLI(['invoke', 'hello', '--bearer-token', 'fake-token', '--json'], projectDir, {
        env: telemetry.env,
      });
      expect(result.exitCode).toBe(1);
      const json = JSON.parse(result.stdout);
      expect(json.success).toBe(false);
      telemetry.assertMetricEmitted({
        command: 'invoke',
        auth_type: 'bearer_token',
        exit_reason: 'failure',
      });
    });
  });

  describe('session id', () => {
    it('records has_session_id true', async () => {
      const result = await runCLI(['invoke', 'hello', '--session-id', 'test-session', '--json'], projectDir, {
        env: telemetry.env,
      });
      expect(result.exitCode).toBe(1);
      const json = JSON.parse(result.stdout);
      expect(json.success).toBe(false);
      telemetry.assertMetricEmitted({
        command: 'invoke',
        has_session_id: true,
        exit_reason: 'failure',
        auth_type: 'sigv4',
      });
    });
  });

  // --------------------------------------------------------------------------
  // Mode routing for payments flags.
  //
  // The spawned CLI has no TTY (cli-runner uses stdio: ['ignore','pipe','pipe']).
  // That gives us two distinguishable observable signatures:
  //   - CLI mode (forced)  -> reaches the action/validation layer; with --json
  //                           it prints structured JSON to stdout.
  //   - TUI mode (routed)  -> hits requireTTY(), printing the plain-text
  //                           "requires an interactive terminal" error (NOT JSON).
  //
  // This lets us assert the routing change without an interactive harness.
  // --------------------------------------------------------------------------
  describe('payments mode routing', () => {
    it('--auto-session still forces CLI mode (reaches action layer, not the TUI guard)', async () => {
      // With a prompt to bypass the "prompt required" check, --auto-session must
      // reach the action layer. The mutual-exclusion check there is action-layer
      // proof that we did NOT route to the interactive TUI.
      const result = await runCLI(
        ['invoke', 'hi', '--auto-session', '--payment-session-id', 's1', '--json'],
        projectDir,
        { env: telemetry.env }
      );
      expect(result.exitCode).toBe(1);
      const json = JSON.parse(result.stdout);
      expect(json.success).toBe(false);
      expect(
        json.error.includes('mutually exclusive'),
        `Expected action-layer mutual-exclusion error, got: ${json.error}`
      ).toBeTruthy();
      expect(result.stderr).not.toContain('requires an interactive terminal');
    });

    it('--auto-session without a prompt forces CLI mode (JSON error, not TUI guard)', async () => {
      const result = await runCLI(['invoke', '--auto-session', '--json'], projectDir, { env: telemetry.env });
      expect(result.exitCode).toBe(1);
      // Forced into CLI/JSON mode: stdout is structured JSON, NOT the TUI guard text.
      const json = JSON.parse(result.stdout);
      expect(json.success).toBe(false);
      expect(result.stderr).not.toContain('requires an interactive terminal');
    });

    it('a payment flag alone (no prompt/json) routes to the interactive TUI', async () => {
      // NEW behavior: explicit payment flags no longer force CLI mode on their own,
      // so this routes to the TUI -> requireTTY() fires (the spawned process has no
      // TTY). All three payment flags share this one mode-decision branch.
      const result = await runCLI(['invoke', '--payment-instrument-id', 'pi-1'], projectDir, { env: telemetry.env });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('requires an interactive terminal');
      // It did NOT take the CLI/JSON path.
      expect(result.stdout).not.toContain('"success"');
    });

    it('regression: --session-id alone (no prompt/json) still routes to the TUI', async () => {
      const result = await runCLI(['invoke', '--session-id', 's1'], projectDir, { env: telemetry.env });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('requires an interactive terminal');
    });

    it('a payment flag WITH --json is forced into CLI mode (does not route to TUI)', async () => {
      // --json is in the CLI-forcing condition, so even a payment flag + --json
      // stays on the CLI path and emits structured JSON.
      const result = await runCLI(['invoke', 'hi', '--payment-instrument-id', 'pi-1', '--json'], projectDir, {
        env: telemetry.env,
      });
      expect(result.exitCode).toBe(1);
      const json = JSON.parse(result.stdout);
      expect(json.success).toBe(false);
      expect(result.stderr).not.toContain('requires an interactive terminal');
    });
  });
});
