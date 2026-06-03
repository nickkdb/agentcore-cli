import { runCLI } from '../../../../test-utils/index.js';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('add gateway-target command', () => {
  let testDir: string;
  let projectDir: string;
  const gatewayName = 'test-gateway';

  beforeAll(async () => {
    testDir = join(tmpdir(), `agentcore-add-gateway-target-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });

    // Create project
    const projectName = 'GatewayTargetProj';
    const result = await runCLI(['create', '--name', projectName, '--no-agent'], testDir);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to create project: ${result.stdout} ${result.stderr}`);
    }
    projectDir = join(testDir, projectName);

    // Create gateway for tests
    const gwResult = await runCLI(['add', 'gateway', '--name', gatewayName, '--json'], projectDir);
    if (gwResult.exitCode !== 0) {
      throw new Error(`Failed to create gateway: ${gwResult.stdout} ${gwResult.stderr}`);
    }
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('validation', () => {
    it('requires name flag', async () => {
      const result = await runCLI(['add', 'gateway-target', '--json'], projectDir);
      expect(result.exitCode).toBe(1);
      const json = JSON.parse(result.stdout);
      expect(json.success).toBe(false);
      expect(json.error.includes('--name'), `Error: ${json.error}`).toBeTruthy();
    });

    it('requires endpoint', async () => {
      const result = await runCLI(
        ['add', 'gateway-target', '--name', 'noendpoint', '--type', 'mcp-server', '--gateway', gatewayName, '--json'],
        projectDir
      );
      expect(result.exitCode).toBe(1);
      const json = JSON.parse(result.stdout);
      expect(json.success).toBe(false);
      expect(json.error.includes('--endpoint'), `Error: ${json.error}`).toBeTruthy();
    });
  });

  describe('existing-endpoint', () => {
    it('adds existing-endpoint target to gateway', async () => {
      const targetName = `target${Date.now()}`;
      const result = await runCLI(
        [
          'add',
          'gateway-target',
          '--name',
          targetName,
          '--type',
          'mcp-server',
          '--endpoint',
          'https://mcp.exa.ai/mcp',
          '--gateway',
          gatewayName,
          '--json',
        ],
        projectDir
      );

      expect(result.exitCode, `stdout: ${result.stdout}, stderr: ${result.stderr}`).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.success).toBe(true);

      // Verify in agentcore.json
      const projectSpec = JSON.parse(await readFile(join(projectDir, 'agentcore/agentcore.json'), 'utf-8'));
      const gateway = projectSpec.agentCoreGateways.find((g: { name: string }) => g.name === gatewayName);
      const target = gateway?.targets?.find((t: { name: string }) => t.name === targetName);
      expect(target, 'Target should be in gateway targets').toBeTruthy();
    });
  });

  describe('lambda-function-arn', () => {
    const lambdaArn = 'arn:aws:lambda:us-east-1:123456789012:function:my-func';

    beforeAll(async () => {
      await writeFile(
        join(projectDir, 'tools.json'),
        JSON.stringify([{ name: 'myTool', description: 'A test tool', inputSchema: { type: 'object' } }])
      );
    });

    it('adds lambda-function-arn target successfully', async () => {
      const targetName = `lambda-target-${Date.now()}`;
      const result = await runCLI(
        [
          'add',
          'gateway-target',
          '--type',
          'lambda-function-arn',
          '--name',
          targetName,
          '--lambda-arn',
          lambdaArn,
          '--tool-schema-file',
          './tools.json',
          '--gateway',
          gatewayName,
          '--json',
        ],
        projectDir
      );

      expect(result.exitCode, `stdout: ${result.stdout}, stderr: ${result.stderr}`).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.success).toBe(true);
      expect(json.toolName).toBe(targetName);

      const projectSpec = JSON.parse(await readFile(join(projectDir, 'agentcore/agentcore.json'), 'utf-8'));
      const gateway = projectSpec.agentCoreGateways.find((g: { name: string }) => g.name === gatewayName);
      const target = gateway?.targets?.find((t: { name: string }) => t.name === targetName);
      expect(target).toBeTruthy();
      expect(target.targetType).toBe('lambdaFunctionArn');
      expect(target.lambdaFunctionArn).toEqual({ lambdaArn, toolSchemaFile: './tools.json' });
    });

    it('rejects missing --lambda-arn', async () => {
      const result = await runCLI(
        [
          'add',
          'gateway-target',
          '--type',
          'lambda-function-arn',
          '--name',
          `no-arn-${Date.now()}`,
          '--tool-schema-file',
          './tools.json',
          '--gateway',
          gatewayName,
          '--json',
        ],
        projectDir
      );

      expect(result.exitCode).toBe(1);
      const json = JSON.parse(result.stdout);
      expect(json.success).toBe(false);
      expect(json.error).toContain('--lambda-arn');
    });

    it('rejects missing --tool-schema-file', async () => {
      const result = await runCLI(
        [
          'add',
          'gateway-target',
          '--type',
          'lambda-function-arn',
          '--name',
          `no-schema-${Date.now()}`,
          '--lambda-arn',
          lambdaArn,
          '--gateway',
          gatewayName,
          '--json',
        ],
        projectDir
      );

      expect(result.exitCode).toBe(1);
      const json = JSON.parse(result.stdout);
      expect(json.success).toBe(false);
      expect(json.error).toContain('--tool-schema-file');
    });

    it('removes lambda-function-arn target', async () => {
      const targetName = `lambda-rm-${Date.now()}`;
      const addResult = await runCLI(
        [
          'add',
          'gateway-target',
          '--type',
          'lambda-function-arn',
          '--name',
          targetName,
          '--lambda-arn',
          lambdaArn,
          '--tool-schema-file',
          './tools.json',
          '--gateway',
          gatewayName,
          '--json',
        ],
        projectDir
      );
      expect(addResult.exitCode, `add stdout: ${addResult.stdout}, stderr: ${addResult.stderr}`).toBe(0);

      const removeResult = await runCLI(
        ['remove', 'gateway-target', '--name', targetName, '--yes', '--json'],
        projectDir
      );
      expect(removeResult.exitCode, `remove stdout: ${removeResult.stdout}, stderr: ${removeResult.stderr}`).toBe(0);
      const json = JSON.parse(removeResult.stdout);
      expect(json.success).toBe(true);
    });
  });

  describe('3LO outbound auth (AUTHORIZATION_CODE)', () => {
    const credName = '3lo-test-cred';
    // The BB04 BUG-2 schema rule (e4b5daff) rejects 3LO targets on gateways
    // with authorizerType: NONE. Use a dedicated CUSTOM_JWT gateway for the
    // 3LO test cases — adding the inbound JWT inline keeps these tests
    // isolated from the outer suite's authorizerType: NONE gateway.
    const threeLoGatewayName = '3lo-test-gateway';

    beforeAll(async () => {
      // Create a CUSTOM_JWT gateway so 3LO targets pass the BB04 BUG-2 rule.
      const gwResult = await runCLI(
        [
          'add',
          'gateway',
          '--name',
          threeLoGatewayName,
          '--authorizer-type',
          'CUSTOM_JWT',
          '--discovery-url',
          'https://accounts.example.com/.well-known/openid-configuration',
          '--allowed-audience',
          'my-app',
          '--json',
        ],
        projectDir
      );
      if (gwResult.exitCode !== 0) {
        throw new Error(`Failed to create 3LO gateway: ${gwResult.stdout} ${gwResult.stderr}`);
      }

      // Create an OAuth credential the 3LO targets will reference.
      const credResult = await runCLI(
        [
          'add',
          'credential',
          '--name',
          credName,
          '--type',
          'oauth',
          '--discovery-url',
          'https://accounts.example.com/.well-known/openid-configuration',
          '--client-id',
          'test-client',
          '--client-secret',
          'test-secret',
          '--json',
        ],
        projectDir
      );
      if (credResult.exitCode !== 0) {
        throw new Error(`Failed to create OAuth credential: ${credResult.stdout} ${credResult.stderr}`);
      }
    });

    it('adds a 3LO mcp-server target with grantType, scopes, defaultReturnUrl, customParams', async () => {
      const targetName = `tgt-3lo-${Date.now()}`;
      const result = await runCLI(
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
          threeLoGatewayName,
          '--outbound-auth',
          'oauth',
          '--credential-name',
          credName,
          '--grant-type',
          'authorization-code',
          '--scopes',
          'calendar.readonly,email',
          '--default-return-url',
          'https://app.example.com/oauth/return',
          '--custom-params',
          'access_type=offline,prompt=consent',
          '--json',
        ],
        projectDir
      );

      expect(result.exitCode, `stdout: ${result.stdout}, stderr: ${result.stderr}`).toBe(0);

      const projectSpec = JSON.parse(await readFile(join(projectDir, 'agentcore/agentcore.json'), 'utf-8'));
      const gateway = projectSpec.agentCoreGateways.find((g: { name: string }) => g.name === threeLoGatewayName);
      const target = gateway?.targets?.find((t: { name: string }) => t.name === targetName);
      expect(target, 'Target should be present').toBeTruthy();
      expect(target.outboundAuth.type).toBe('OAUTH');
      expect(target.outboundAuth.credentialName).toBe(credName);
      expect(target.outboundAuth.grantType).toBe('AUTHORIZATION_CODE');
      expect(target.outboundAuth.scopes).toEqual(['calendar.readonly', 'email']);
      expect(target.outboundAuth.defaultReturnUrl).toBe('https://app.example.com/oauth/return');
      expect(target.outboundAuth.customParameters).toEqual({ access_type: 'offline', prompt: 'consent' });
    });

    it('rejects invalid --grant-type value', async () => {
      const result = await runCLI(
        [
          'add',
          'gateway-target',
          '--name',
          `tgt-bad-grant-${Date.now()}`,
          '--type',
          'mcp-server',
          '--endpoint',
          'https://example.com/mcp',
          '--gateway',
          threeLoGatewayName,
          '--outbound-auth',
          'oauth',
          '--credential-name',
          credName,
          '--grant-type',
          'pin',
          '--json',
        ],
        projectDir
      );
      expect(result.exitCode).toBe(1);
      const json = JSON.parse(result.stdout);
      expect(json.success).toBe(false);
      expect(json.error.toLowerCase()).toMatch(/grant.?type/);
    });

    it('rejects malformed --custom-params entry', async () => {
      const result = await runCLI(
        [
          'add',
          'gateway-target',
          '--name',
          `tgt-bad-params-${Date.now()}`,
          '--type',
          'mcp-server',
          '--endpoint',
          'https://example.com/mcp',
          '--gateway',
          threeLoGatewayName,
          '--outbound-auth',
          'oauth',
          '--credential-name',
          credName,
          '--grant-type',
          'authorization-code',
          '--custom-params',
          'access_type', // missing =value
          '--json',
        ],
        projectDir
      );
      expect(result.exitCode).toBe(1);
      const json = JSON.parse(result.stdout);
      expect(json.success).toBe(false);
      expect(json.error).toMatch(/custom-params/);
    });

    it('defaults to 2LO when --grant-type is omitted (back-compat)', async () => {
      const targetName = `tgt-2lo-${Date.now()}`;
      const result = await runCLI(
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
          threeLoGatewayName,
          '--outbound-auth',
          'oauth',
          '--credential-name',
          credName,
          '--scopes',
          'orders.read',
          '--json',
        ],
        projectDir
      );
      expect(result.exitCode, `stdout: ${result.stdout}, stderr: ${result.stderr}`).toBe(0);

      const projectSpec = JSON.parse(await readFile(join(projectDir, 'agentcore/agentcore.json'), 'utf-8'));
      const gateway = projectSpec.agentCoreGateways.find((g: { name: string }) => g.name === threeLoGatewayName);
      const target = gateway?.targets?.find((t: { name: string }) => t.name === targetName);
      expect(target.outboundAuth.type).toBe('OAUTH');
      expect(target.outboundAuth.grantType).toBeUndefined();
      expect(target.outboundAuth.scopes).toEqual(['orders.read']);
      expect(target.outboundAuth.defaultReturnUrl).toBeUndefined();
      expect(target.outboundAuth.customParameters).toBeUndefined();
    });
  });
});
