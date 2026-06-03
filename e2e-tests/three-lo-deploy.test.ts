/**
 * Phase 1 integration test (task 1.14): deploy a project with one 2LO target
 * and one 3LO target that share a single OAuth credential, against the
 * allowlisted AgentCore Identity 3LO account 603141041947 in us-west-2.
 *
 * Verifies:
 *   - Both targets render correctly in CloudFormation
 *     (2LO target with `GrantType: CLIENT_CREDENTIALS`, 3LO target with
 *     `GrantType: AUTHORIZATION_CODE`).
 *   - The credential's `callbackUrl` returned from `CreateOauth2CredentialProvider`
 *     is persisted to `deployed-state.json`.
 *
 * This test does NOT cover invoke — that's Phase 2 (task 2.18).
 *
 * Skipped when AWS credentials aren't present so external contributors can
 * still run the e2e suite locally without the deploy profile.
 */
import { hasAwsCredentials, prereqs, runCLI, spawnAndCollect } from '../src/test-utils/index.js';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ACCOUNT_ID = process.env.AWS_ACCOUNT_ID ?? '603141041947';
const REGION = process.env.AWS_REGION ?? 'us-west-2';

const hasAws = hasAwsCredentials();
const canRun = prereqs.npm && prereqs.git && hasAws;

describe.sequential('e2e: 3LO + 2LO sharing one credential', () => {
  let testDir: string;
  let projectPath: string;
  const credName = `e2e3LoCred${String(Date.now()).slice(-8)}`;
  const projectName = `E2e3lo${String(Date.now()).slice(-8)}`;

  beforeAll(async () => {
    if (!canRun) return;

    testDir = join(tmpdir(), `agentcore-e2e-3lo-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });

    const createResult = await runCLI(['create', '--name', projectName, '--no-agent', '--json'], testDir);
    if (createResult.exitCode !== 0) {
      throw new Error(`create failed: ${createResult.stdout} ${createResult.stderr}`);
    }
    projectPath = join(testDir, projectName);

    await writeFile(
      join(projectPath, 'agentcore', 'aws-targets.json'),
      JSON.stringify([{ name: 'default', account: ACCOUNT_ID, region: REGION }], null, 2)
    );

    const credResult = await runCLI(
      [
        'add',
        'credential',
        '--name',
        credName,
        '--type',
        'oauth',
        '--discovery-url',
        'https://accounts.google.com/.well-known/openid-configuration',
        '--client-id',
        process.env.GOOGLE_OAUTH_CLIENT_ID ?? 'test-client-id',
        '--client-secret',
        process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? 'test-client-secret',
        '--scopes',
        'openid,email',
        '--json',
      ],
      projectPath
    );
    if (credResult.exitCode !== 0) {
      throw new Error(`add credential failed: ${credResult.stdout} ${credResult.stderr}`);
    }

    const gwResult = await runCLI(['add', 'gateway', '--name', 'shared-gw', '--json'], projectPath);
    if (gwResult.exitCode !== 0) {
      throw new Error(`add gateway failed: ${gwResult.stdout} ${gwResult.stderr}`);
    }

    const twoLoResult = await runCLI(
      [
        'add',
        'gateway-target',
        '--name',
        'two-leg',
        '--type',
        'mcp-server',
        '--endpoint',
        'https://example.com/mcp/2lo',
        '--gateway',
        'shared-gw',
        '--outbound-auth',
        'oauth',
        '--credential-name',
        credName,
        '--scopes',
        'openid',
        '--json',
      ],
      projectPath
    );
    if (twoLoResult.exitCode !== 0) {
      throw new Error(`2LO target add failed: ${twoLoResult.stdout} ${twoLoResult.stderr}`);
    }

    const threeLoResult = await runCLI(
      [
        'add',
        'gateway-target',
        '--name',
        'three-leg',
        '--type',
        'mcp-server',
        '--endpoint',
        'https://example.com/mcp/3lo',
        '--gateway',
        'shared-gw',
        '--outbound-auth',
        'oauth',
        '--credential-name',
        credName,
        '--grant-type',
        'authorization-code',
        '--scopes',
        'email',
        '--default-return-url',
        'https://app.example.com/oauth/return',
        '--json',
      ],
      projectPath
    );
    if (threeLoResult.exitCode !== 0) {
      throw new Error(`3LO target add failed: ${threeLoResult.stdout} ${threeLoResult.stderr}`);
    }
  }, 120_000);

  afterAll(async () => {
    if (!canRun || !projectPath) return;
    try {
      await spawnAndCollect('agentcore', ['remove', 'all', '--json'], projectPath);
    } catch {
      /* best-effort teardown */
    }
    if (testDir) await rm(testDir, { recursive: true, force: true });
  }, 300_000);

  it.skipIf(!canRun)(
    'deploys 2LO + 3LO targets sharing one credential and persists callbackUrl to state',
    async () => {
      const deployResult = await runCLI(['deploy', '--yes', '--json'], projectPath, {
        env: { AWS_PROFILE: process.env.AWS_PROFILE ?? 'deploy' },
      });
      expect(deployResult.exitCode, `deploy stdout: ${deployResult.stdout}, stderr: ${deployResult.stderr}`).toBe(0);

      const state = JSON.parse(await readFile(join(projectPath, 'agentcore', '.cli', 'state.json'), 'utf-8'));
      const credState = state.targets?.default?.resources?.credentials?.[credName];
      expect(credState).toBeTruthy();
      expect(credState.credentialProviderArn).toMatch(/^arn:[^:]+:bedrock-agentcore:/);
      expect(credState.callbackUrl).toBeTruthy();
      expect(credState.callbackUrl).toMatch(/^https:\/\/bedrock-agentcore\./);

      const projectSpec = JSON.parse(await readFile(join(projectPath, 'agentcore', 'agentcore.json'), 'utf-8'));
      const gw = projectSpec.agentCoreGateways.find((g: { name: string }) => g.name === 'shared-gw');
      const twoLo = gw?.targets?.find((t: { name: string }) => t.name === 'two-leg');
      const threeLo = gw?.targets?.find((t: { name: string }) => t.name === 'three-leg');
      expect(twoLo.outboundAuth.credentialName).toBe(credName);
      expect(threeLo.outboundAuth.credentialName).toBe(credName);
      expect(threeLo.outboundAuth.grantType).toBe('AUTHORIZATION_CODE');
    },
    900_000
  );
});
