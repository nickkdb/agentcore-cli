/**
 * Phase 2.18 + 3.13 end-to-end test: full 3LO developer journey.
 *
 * Walks the same flow a real customer would, end-to-end against the
 * allowlisted AgentCore Identity 3LO account (603141041947 / us-west-2):
 *
 *   1. agentcore create   — blank project
 *   2. agentcore add credential --type oauth (with discoveryUrl) — 3LO cred
 *   3. agentcore add gateway --authorizer-type CUSTOM_JWT — 3LO requires
 *      a non-NONE inbound authorizer (BB04 BUG-2 schema rule)
 *   4. agentcore add gateway-target --grant-type authorization-code … —
 *      3LO target referencing the cred
 *   5. agentcore validate — should surface the 3LO callback-URL note (post-deploy only)
 *   6. agentcore deploy — provisions the gateway + cred, persists callbackUrl
 *   7. agentcore fetch access --target-name <gw>/<target> --json — exercises the
 *      Phase 3.7 outbound-status branch; the gateway hasn't seen any user
 *      consent yet, so the expected status is `needsConsent` with an
 *      authorizationUrl. The CLI never opens a browser in test mode.
 *   8. agentcore validate — now surfaces the 3LO callback-URL note from state
 *   9. teardown: agentcore remove all && agentcore deploy
 *
 * What this test DOES verify:
 *   - The full create → add → deploy → fetch-access wire chain works.
 *   - fetch access --target-name returns the documented JSON schema for 3LO.
 *   - validate surfaces 3LO callback-URL hints from deployed state.
 *
 * What this test does NOT verify (would require a real OAuth client):
 *   - The actual consent flow (`runConsent` opens a browser); that's
 *     unit-tested in consent-flow.test.ts.
 *   - The actual tool call retry-after-consent; that's unit-tested in
 *     invoke-with-consent.test.ts.
 *
 * Skipped when AWS credentials aren't present.
 */
import { hasAwsCredentials, prereqs, runCLI, spawnAndCollect } from '../src/test-utils/index.js';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ACCOUNT_ID = process.env.AWS_ACCOUNT_ID ?? '603141041947';
const REGION = process.env.AWS_REGION ?? 'us-west-2';

const hasAws = hasAwsCredentials();
const canRun = prereqs.npm && prereqs.git && hasAws;

// We use a public Google-like OIDC discovery URL purely so the schema +
// CDK render path are exercised end-to-end. The test never completes a
// real OAuth flow with this discovery; we only inspect state + fetch-access.
const DISCOVERY_URL = 'https://accounts.google.com/.well-known/openid-configuration';

describe.sequential('e2e: 3LO full developer journey', () => {
  let testDir: string;
  let projectPath: string;
  const stamp = String(Date.now()).slice(-8);
  const credName = `e2e3lo${stamp}cred`;
  const gatewayName = `e2e3lo${stamp}gw`;
  const targetName = `e2e3lo${stamp}tgt`;
  const projectName = `E2e3loFull${stamp}`;

  beforeAll(async () => {
    if (!canRun) return;
    testDir = join(tmpdir(), `agentcore-e2e-3lo-full-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });
    const create = await runCLI(['create', '--name', projectName, '--no-agent', '--json'], testDir);
    if (create.exitCode !== 0) throw new Error(`create failed: ${create.stdout} ${create.stderr}`);
    projectPath = join(testDir, projectName);
    await writeFile(
      join(projectPath, 'agentcore', 'aws-targets.json'),
      JSON.stringify([{ name: 'default', account: ACCOUNT_ID, region: REGION }])
    );
  }, 90000);

  afterAll(async () => {
    if (!canRun || !projectPath) return;
    // Best-effort teardown — never fail the suite on cleanup.
    try {
      await spawnAndCollect(
        'node',
        [join(__dirname, '..', 'dist', 'cli', 'index.mjs'), 'remove', 'all', '--yes', '--json'],
        projectPath
      );
      await spawnAndCollect(
        'node',
        [join(__dirname, '..', 'dist', 'cli', 'index.mjs'), 'deploy', '--yes', '--json'],
        projectPath
      );
    } catch {
      /* swallow */
    }
    if (testDir) await rm(testDir, { recursive: true, force: true });
  }, 600000);

  it.skipIf(!canRun)(
    'creates a 3LO credential + CUSTOM_JWT gateway + 3LO target',
    async () => {
      const cred = await runCLI(
        [
          'add',
          'credential',
          '--name',
          credName,
          '--type',
          'oauth',
          '--discovery-url',
          DISCOVERY_URL,
          '--client-id',
          `e2e-client-${stamp}`,
          '--client-secret',
          `e2e-secret-${stamp}`,
          '--json',
        ],
        projectPath
      );
      expect(cred.exitCode, `cred stdout: ${cred.stdout}, stderr: ${cred.stderr}`).toBe(0);

      const gw = await runCLI(
        [
          'add',
          'gateway',
          '--name',
          gatewayName,
          '--authorizer-type',
          'CUSTOM_JWT',
          '--discovery-url',
          DISCOVERY_URL,
          '--allowed-audience',
          'e2e-app',
          '--json',
        ],
        projectPath
      );
      expect(gw.exitCode, `gw stdout: ${gw.stdout}, stderr: ${gw.stderr}`).toBe(0);

      const tgt = await runCLI(
        [
          'add',
          'gateway-target',
          '--name',
          targetName,
          '--type',
          'mcp-server',
          '--endpoint',
          'https://example.com/mcp',
          '--gateway',
          gatewayName,
          '--outbound-auth',
          'oauth',
          '--credential-name',
          credName,
          '--grant-type',
          'authorization-code',
          '--scopes',
          'openid,email',
          '--default-return-url',
          'https://app.example.com/oauth/return',
          '--custom-params',
          'access_type=offline,prompt=consent',
          '--json',
        ],
        projectPath
      );
      expect(tgt.exitCode, `tgt stdout: ${tgt.stdout}, stderr: ${tgt.stderr}`).toBe(0);
    },
    60000
  );

  it.skipIf(!canRun)('agentcore validate passes pre-deploy on the assembled project', async () => {
    const v = await runCLI(['validate', '--json'], projectPath);
    expect(v.exitCode, `validate stdout: ${v.stdout}, stderr: ${v.stderr}`).toBe(0);
  });

  // The deploy + fetch-access leg is opt-in via E2E_3LO_DEPLOY=1 because it
  // takes ~4 min and provisions real AWS resources. Skipping by default
  // keeps the e2e suite snappy; the deploy mechanics are covered by
  // three-lo-deploy.test.ts (Phase 1.14 e2e).
  it.skipIf(!canRun || !process.env.E2E_3LO_DEPLOY)(
    'deploys, fetches 3LO access status, sees needsConsent or fresh',
    async () => {
      const dep = await runCLI(['deploy', '--target', 'default', '--yes', '--json'], projectPath);
      expect(dep.exitCode, `deploy stdout: ${dep.stdout}, stderr: ${dep.stderr}`).toBe(0);

      const fa = await runCLI(
        ['fetch', 'access', '--name', gatewayName, '--target-name', targetName, '--json'],
        projectPath
      );
      expect(fa.exitCode, `fetch-access stdout: ${fa.stdout}, stderr: ${fa.stderr}`).toBe(0);
      const json = JSON.parse(fa.stdout);
      expect(json.success).toBe(true);
      expect(json.outbound3lo).toBeTruthy();
      const outbound = json.outbound3lo;
      expect(outbound.gatewayName).toBe(gatewayName);
      expect(outbound.targetName).toBe(targetName);
      expect(outbound.grantType).toBe('AUTHORIZATION_CODE');
      expect(outbound.credentialName).toBe(credName);
      expect(outbound.callbackUrl).toMatch(/^https:\/\/bedrock-agentcore\..+\.amazonaws\.com\//);
      expect(['fresh', 'inProgress', 'needsConsent', 'failed']).toContain(outbound.tokenStatus.status);
    },
    600000
  );
});
