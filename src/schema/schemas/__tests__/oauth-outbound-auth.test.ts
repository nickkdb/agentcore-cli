/**
 * Unit tests for the 3LO outbound auth schema additions:
 *
 * - `OAuthGrantTypeSchema` enumerates `CLIENT_CREDENTIALS | AUTHORIZATION_CODE`
 * - `OutboundAuthSchema` accepts the new optional `grantType`,
 *   `defaultReturnUrl`, `customParameters` fields with `superRefine` guards
 * - `AgentCoreGatewayTargetSchema` rejects `AUTHORIZATION_CODE` on
 *   `lambda` / `apiGateway` targets
 * - `AgentCoreProjectSpecSchema` enforces credential resolution rules and
 *   the "CustomOauth2 3LO needs URLs" rule
 */
import { AgentCoreProjectSpecSchema } from '../agentcore-project.js';
import { AgentCoreGatewayTargetSchema, OAuthGrantTypeSchema, OutboundAuthSchema } from '../mcp.js';
import { describe, expect, it } from 'vitest';

describe('OAuthGrantTypeSchema', () => {
  it('enumerates CLIENT_CREDENTIALS and AUTHORIZATION_CODE', () => {
    expect(OAuthGrantTypeSchema.options).toEqual(['CLIENT_CREDENTIALS', 'AUTHORIZATION_CODE']);
  });

  it('does NOT include TOKEN_EXCHANGE (RFC 8693 / OBO is server-side)', () => {
    expect(OAuthGrantTypeSchema.options).not.toContain('TOKEN_EXCHANGE');
  });
});

describe('OutboundAuthSchema — backwards compatibility', () => {
  it('accepts a 2LO target without any new fields', () => {
    const result = OutboundAuthSchema.safeParse({
      type: 'OAUTH',
      credentialName: 'my-cred',
      scopes: ['orders.read'],
    });
    expect(result.success).toBe(true);
  });

  it('accepts API_KEY without grantType', () => {
    const result = OutboundAuthSchema.safeParse({ type: 'API_KEY', credentialName: 'my-cred' });
    expect(result.success).toBe(true);
  });

  it('accepts NONE without anything else', () => {
    const result = OutboundAuthSchema.safeParse({ type: 'NONE' });
    expect(result.success).toBe(true);
  });
});

describe('OutboundAuthSchema — 3LO acceptance', () => {
  it('accepts the minimal 3LO config', () => {
    const result = OutboundAuthSchema.safeParse({
      type: 'OAUTH',
      credentialName: 'google-cred',
      grantType: 'AUTHORIZATION_CODE',
      defaultReturnUrl: 'https://app.example.com/oauth/return',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a fully populated 3LO config', () => {
    const result = OutboundAuthSchema.safeParse({
      type: 'OAUTH',
      credentialName: 'google-cred',
      scopes: ['calendar.readonly', 'email'],
      grantType: 'AUTHORIZATION_CODE',
      defaultReturnUrl: 'https://app.example.com/oauth/return',
      customParameters: { access_type: 'offline', prompt: 'consent' },
    });
    expect(result.success).toBe(true);
  });
});

describe('OutboundAuthSchema — superRefine rejections', () => {
  it('rejects defaultReturnUrl on 2LO', () => {
    const result = OutboundAuthSchema.safeParse({
      type: 'OAUTH',
      credentialName: 'my-cred',
      grantType: 'CLIENT_CREDENTIALS',
      defaultReturnUrl: 'https://example.com/cb',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some(i => i.message.includes('defaultReturnUrl'))).toBe(true);
    }
  });

  it('rejects customParameters on 2LO', () => {
    const result = OutboundAuthSchema.safeParse({
      type: 'OAUTH',
      credentialName: 'my-cred',
      grantType: 'CLIENT_CREDENTIALS',
      customParameters: { foo: 'bar' },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some(i => i.message.includes('customParameters'))).toBe(true);
    }
  });

  it('rejects grantType on API_KEY', () => {
    const result = OutboundAuthSchema.safeParse({
      type: 'API_KEY',
      credentialName: 'my-cred',
      grantType: 'AUTHORIZATION_CODE',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some(i => i.message.includes('only applicable when outbound auth type is OAUTH'))
      ).toBe(true);
    }
  });

  it('rejects defaultReturnUrl when grantType is omitted (defaults to 2LO)', () => {
    const result = OutboundAuthSchema.safeParse({
      type: 'OAUTH',
      credentialName: 'my-cred',
      defaultReturnUrl: 'https://example.com/cb',
    });
    expect(result.success).toBe(false);
  });

  it('accepts an invalid URL on defaultReturnUrl as a separate field-level error', () => {
    const result = OutboundAuthSchema.safeParse({
      type: 'OAUTH',
      credentialName: 'my-cred',
      grantType: 'AUTHORIZATION_CODE',
      defaultReturnUrl: 'not-a-url',
    });
    expect(result.success).toBe(false);
  });
});

describe('AgentCoreGatewayTargetSchema — 3LO target-type guard', () => {
  it('rejects AUTHORIZATION_CODE on lambda targets', () => {
    const result = AgentCoreGatewayTargetSchema.safeParse({
      name: 'my-tool',
      targetType: 'lambda',
      compute: {
        host: 'Lambda',
        implementation: { language: 'Python', path: './tools', handler: 'h.handle' },
        pythonVersion: 'PYTHON_3_12',
      },
      toolDefinitions: [{ name: 't', description: 'd', inputSchema: { type: 'object', properties: {} } }],
      outboundAuth: {
        type: 'OAUTH',
        credentialName: 'cred',
        grantType: 'AUTHORIZATION_CODE',
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some(i => i.message.includes('do not support AUTHORIZATION_CODE'))).toBe(true);
    }
  });

  it('rejects AUTHORIZATION_CODE on apiGateway targets', () => {
    const result = AgentCoreGatewayTargetSchema.safeParse({
      name: 'my-api',
      targetType: 'apiGateway',
      apiGateway: {
        restApiId: 'abc123',
        stage: 'prod',
        apiGatewayToolConfiguration: {
          toolFilters: [{ filterPath: '/pets', methods: ['GET'] }],
        },
      },
      outboundAuth: {
        type: 'OAUTH',
        credentialName: 'cred',
        grantType: 'AUTHORIZATION_CODE',
      },
    });
    // apiGateway targets don't support OAUTH outbound auth at all per
    // TARGET_TYPE_AUTH_CONFIG, so the failure may surface either via the
    // generic auth-type guard or via the 3LO-specific guard. Either is fine —
    // the important thing is that the schema rejects.
    expect(result.success).toBe(false);
  });

  it('accepts AUTHORIZATION_CODE on mcpServer targets', () => {
    const result = AgentCoreGatewayTargetSchema.safeParse({
      name: 'cal-server',
      targetType: 'mcpServer',
      endpoint: 'https://calendar.example.com/mcp',
      outboundAuth: {
        type: 'OAUTH',
        credentialName: 'google-cred',
        grantType: 'AUTHORIZATION_CODE',
        scopes: ['calendar.readonly'],
        defaultReturnUrl: 'https://app.example.com/oauth/return',
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts AUTHORIZATION_CODE on openApiSchema targets', () => {
    const result = AgentCoreGatewayTargetSchema.safeParse({
      name: 'orders-api',
      targetType: 'openApiSchema',
      schemaSource: { s3: { uri: 's3://bucket/schema.yaml' } },
      outboundAuth: {
        type: 'OAUTH',
        credentialName: 'cred',
        grantType: 'AUTHORIZATION_CODE',
        defaultReturnUrl: 'https://app.example.com/oauth/return',
      },
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Project-level cross-validation (task 1.4 cont'd)
// ---------------------------------------------------------------------------

const baseProject = {
  $schema: 'https://example.com/schema.json',
  name: 'TestProj',
  version: 1,
  managedBy: 'CDK' as const,
  runtimes: [],
  memories: [],
  evaluators: [],
  onlineEvalConfigs: [],
  policyEngines: [],
  configBundles: [],
  abTests: [],
  httpGateways: [],
};

// Inbound JWT authorizer fields a 3LO gateway needs in order to identify the
// calling end-user — required by the BB04 BUG-2 schema check (3LO targets
// can't ride on `authorizerType: NONE` gateways because the service can't
// know whose token to mint).
const inboundJwt = {
  authorizerType: 'CUSTOM_JWT' as const,
  authorizerConfiguration: {
    customJwtAuthorizer: {
      discoveryUrl: 'https://accounts.example.com/.well-known/openid-configuration',
      allowedAudience: ['my-app'],
    },
  },
};

describe('AgentCoreProjectSpecSchema — credential resolution', () => {
  it('rejects gateway target referencing unknown credential', () => {
    const result = AgentCoreProjectSpecSchema.safeParse({
      ...baseProject,
      credentials: [],
      agentCoreGateways: [
        {
          name: 'my-gw',
          targets: [
            {
              name: 'tgt',
              targetType: 'mcpServer',
              endpoint: 'https://example.com/mcp',
              outboundAuth: { type: 'OAUTH', credentialName: 'missing-cred' },
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some(i => i.message.includes('unknown credential "missing-cred"'))).toBe(true);
    }
  });

  it('rejects OAuth outbound-auth pointing at API key credential', () => {
    const result = AgentCoreProjectSpecSchema.safeParse({
      ...baseProject,
      credentials: [{ authorizerType: 'ApiKeyCredentialProvider', name: 'api-cred' }],
      agentCoreGateways: [
        {
          name: 'my-gw',
          targets: [
            {
              name: 'tgt',
              targetType: 'mcpServer',
              endpoint: 'https://example.com/mcp',
              outboundAuth: { type: 'OAUTH', credentialName: 'api-cred' },
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some(i => i.message.includes('not an OAuthCredentialProvider'))).toBe(true);
    }
  });

  it('rejects 3LO target on CustomOauth2 credential without discoveryUrl or manual URLs', () => {
    const result = AgentCoreProjectSpecSchema.safeParse({
      ...baseProject,
      credentials: [{ authorizerType: 'OAuthCredentialProvider', name: 'oauth-cred', vendor: 'CustomOauth2' }],
      agentCoreGateways: [
        {
          name: 'my-gw',
          targets: [
            {
              name: 'tgt',
              targetType: 'mcpServer',
              endpoint: 'https://example.com/mcp',
              outboundAuth: {
                type: 'OAUTH',
                credentialName: 'oauth-cred',
                grantType: 'AUTHORIZATION_CODE',
              },
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some(i => i.message.includes('CustomOauth2'))).toBe(true);
    }
  });

  it('accepts 3LO target on CustomOauth2 credential with discoveryUrl', () => {
    const result = AgentCoreProjectSpecSchema.safeParse({
      ...baseProject,
      credentials: [
        {
          authorizerType: 'OAuthCredentialProvider',
          name: 'oauth-cred',
          vendor: 'CustomOauth2',
          discoveryUrl: 'https://accounts.example.com/.well-known/openid-configuration',
        },
      ],
      agentCoreGateways: [
        {
          name: 'my-gw',
          ...inboundJwt,
          targets: [
            {
              name: 'tgt',
              targetType: 'mcpServer',
              endpoint: 'https://example.com/mcp',
              outboundAuth: {
                type: 'OAUTH',
                credentialName: 'oauth-cred',
                grantType: 'AUTHORIZATION_CODE',
                defaultReturnUrl: 'https://example.com/return',
              },
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts 3LO target on CustomOauth2 credential with manual URLs', () => {
    const result = AgentCoreProjectSpecSchema.safeParse({
      ...baseProject,
      credentials: [
        {
          authorizerType: 'OAuthCredentialProvider',
          name: 'oauth-cred',
          vendor: 'CustomOauth2',
          authorizationUrl: 'https://accounts.example.com/oauth2/authorize',
          tokenUrl: 'https://accounts.example.com/oauth2/token',
        },
      ],
      agentCoreGateways: [
        {
          name: 'my-gw',
          ...inboundJwt,
          targets: [
            {
              name: 'tgt',
              targetType: 'mcpServer',
              endpoint: 'https://example.com/mcp',
              outboundAuth: {
                type: 'OAUTH',
                credentialName: 'oauth-cred',
                grantType: 'AUTHORIZATION_CODE',
                defaultReturnUrl: 'https://example.com/return',
              },
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts 2LO + 3LO targets sharing a single credential', () => {
    const result = AgentCoreProjectSpecSchema.safeParse({
      ...baseProject,
      credentials: [
        {
          authorizerType: 'OAuthCredentialProvider',
          name: 'shared-cred',
          vendor: 'CustomOauth2',
          discoveryUrl: 'https://accounts.example.com/.well-known/openid-configuration',
        },
      ],
      agentCoreGateways: [
        {
          name: 'my-gw',
          ...inboundJwt,
          targets: [
            {
              name: 'two-leg',
              targetType: 'openApiSchema',
              schemaSource: { s3: { uri: 's3://bucket/schema.yaml' } },
              outboundAuth: { type: 'OAUTH', credentialName: 'shared-cred' },
            },
            {
              name: 'three-leg',
              targetType: 'mcpServer',
              endpoint: 'https://example.com/mcp',
              outboundAuth: {
                type: 'OAUTH',
                credentialName: 'shared-cred',
                grantType: 'AUTHORIZATION_CODE',
                defaultReturnUrl: 'https://example.com/return',
              },
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects 3LO target on a gateway with authorizerType NONE (BB04 BUG-2)', () => {
    const result = AgentCoreProjectSpecSchema.safeParse({
      ...baseProject,
      credentials: [
        {
          authorizerType: 'OAuthCredentialProvider',
          name: 'oauth-cred',
          vendor: 'CustomOauth2',
          discoveryUrl: 'https://accounts.example.com/.well-known/openid-configuration',
        },
      ],
      agentCoreGateways: [
        {
          name: 'my-gw',
          // No authorizerType set — defaults to NONE per the schema's
          // GatewayAuthorizerTypeSchema default. BB04 BUG-2 caught this:
          // it passes Zod parse on the gateway but the AgentCore service
          // rejects 3LO at CFN-stabilize time.
          targets: [
            {
              name: 'tgt',
              targetType: 'mcpServer',
              endpoint: 'https://example.com/mcp',
              outboundAuth: {
                type: 'OAUTH',
                credentialName: 'oauth-cred',
                grantType: 'AUTHORIZATION_CODE',
              },
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some(i => i.message.includes('authorizerType is "NONE"'))).toBe(true);
    }
  });

  it('rejects 3LO target without defaultReturnUrl (regression: real-AWS deploy 2026-05-15)', () => {
    // The AgentCore service responds 400:
    //   "Default return URL is required when grant type is AUTHORIZATION_CODE"
    // The schema must catch this client-side instead of letting CFN
    // stabilization fail.
    const result = AgentCoreProjectSpecSchema.safeParse({
      ...baseProject,
      credentials: [
        {
          authorizerType: 'OAuthCredentialProvider',
          name: 'oauth-cred',
          vendor: 'CustomOauth2',
          discoveryUrl: 'https://accounts.example.com/.well-known/openid-configuration',
        },
      ],
      agentCoreGateways: [
        {
          name: 'my-gw',
          ...inboundJwt,
          targets: [
            {
              name: 'tgt',
              targetType: 'mcpServer',
              endpoint: 'https://example.com/mcp',
              outboundAuth: {
                type: 'OAUTH',
                credentialName: 'oauth-cred',
                grantType: 'AUTHORIZATION_CODE',
                // defaultReturnUrl missing on purpose
              },
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some(i => i.message.includes('defaultReturnUrl'))).toBe(true);
    }
  });
});
