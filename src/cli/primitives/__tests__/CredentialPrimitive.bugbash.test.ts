/**
 * Bug-bash: agentcore add credential — OAuth credential scenarios.
 *
 * Scenarios probed:
 *  1. OAuth with discoveryUrl succeeds and persists to agentcore.json
 *  2. OAuth WITHOUT discoveryUrl — CLI flag coverage gap (authorizationUrl/tokenUrl)
 *  3. Schema rejects 3LO target referencing CustomOauth2 cred with no URLs
 *  4. Vendor handling: GoogleOauth2 (built-in) vs InvalidVendor
 *  5. usage: 'inbound' vs 'outbound' on OAuthCredential
 *  6. Credential name validation (invalid chars)
 */
import type { AgentCoreProjectSpec } from '../../../schema';
import { AgentCoreProjectSpecSchema, CredentialNameSchema, OAuthCredentialSchema } from '../../../schema';
import { validateAddCredentialOptions } from '../../commands/add/validate';
import { CredentialPrimitive } from '../CredentialPrimitive';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const baseProject: AgentCoreProjectSpec = {
  name: 'bugbash',
  version: 1,
  managedBy: 'CDK',
  runtimes: [],
  memories: [],
  credentials: [],
  evaluators: [],
  onlineEvalConfigs: [],
  agentCoreGateways: [],
  policyEngines: [],
  configBundles: [],
  abTests: [],
  httpGateways: [],
  harnesses: [],
};

// 3LO target gateways must declare a non-NONE inbound authorizer per the
// BB04 BUG-2 schema rule (e4b5daff). Spread this into any test gateway
// containing an AUTHORIZATION_CODE outboundAuth target.
const inboundJwt = {
  authorizerType: 'CUSTOM_JWT' as const,
  authorizerConfiguration: {
    customJwtAuthorizer: {
      discoveryUrl: 'https://accounts.example.com/.well-known/openid-configuration',
      allowedAudience: ['my-app'],
    },
  },
};

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockReadProjectSpec, mockWriteProjectSpec } = vi.hoisted(() => ({
  mockReadProjectSpec: vi.fn(),
  mockWriteProjectSpec: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../lib', () => {
  const MockConfigIO = vi.fn(function (this: Record<string, unknown>) {
    this.readProjectSpec = mockReadProjectSpec;
    this.writeProjectSpec = mockWriteProjectSpec;
  });
  return {
    ConfigIO: MockConfigIO,
    findConfigRoot: vi.fn().mockReturnValue('/fake/root'),
    setEnvVar: vi.fn().mockResolvedValue(undefined),
    getEnvVar: vi.fn().mockResolvedValue(undefined),
    toError: (err: unknown) => (err instanceof Error ? err : new Error(String(err))),
    serializeResult: (r: unknown) => r,
    ConflictError: class extends Error {
      constructor(m: string) {
        super(m);
        this.name = 'ConflictError';
      }
    },
    ResourceNotFoundError: class extends Error {
      constructor(m: string) {
        super(m);
        this.name = 'ResourceNotFoundError';
      }
    },
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freshProject(): AgentCoreProjectSpec {
  return structuredClone(baseProject);
}

function getWrittenCredential(index = 0) {
  expect(mockWriteProjectSpec).toHaveBeenCalled();
  const spec = mockWriteProjectSpec.mock.calls[0]![0] as AgentCoreProjectSpec;
  const cred = spec.credentials[index];
  expect(cred).toBeDefined();
  return cred!;
}

// ---------------------------------------------------------------------------
// 1. OAuth with discoveryUrl — golden path
// ---------------------------------------------------------------------------

describe('Scenario 1 — OAuth credential with discoveryUrl (golden path)', () => {
  let primitive: CredentialPrimitive;

  beforeEach(() => {
    vi.clearAllMocks();
    mockReadProjectSpec.mockResolvedValue(freshProject());
    primitive = new CredentialPrimitive();
  });

  it('add() succeeds and returns credentialName', async () => {
    const result = await primitive.add({
      authorizerType: 'OAuthCredentialProvider',
      name: 'google-oauth',
      discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
      clientId: 'x',
      clientSecret: 'y',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.credentialName).toBe('google-oauth');
  });

  it('persists authorizerType, name, discoveryUrl to agentcore.json', async () => {
    await primitive.add({
      authorizerType: 'OAuthCredentialProvider',
      name: 'google-oauth',
      discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
      clientId: 'x',
      clientSecret: 'y',
    });
    const cred = getWrittenCredential();
    expect(cred.authorizerType).toBe('OAuthCredentialProvider');
    expect(cred.name).toBe('google-oauth');
    if (cred.authorizerType === 'OAuthCredentialProvider') {
      expect(cred.discoveryUrl).toBe('https://accounts.google.com/.well-known/openid-configuration');
    }
  });

  it('CLI validateAddCredentialOptions accepts discoveryUrl + clientId + clientSecret', () => {
    const result = validateAddCredentialOptions({
      name: 'g',
      type: 'oauth',
      discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
      clientId: 'x',
      clientSecret: 'y',
    });
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. OAuth WITHOUT discoveryUrl — flag coverage gap for authorizationUrl/tokenUrl
// ---------------------------------------------------------------------------

describe('Scenario 2 — OAuth WITHOUT discoveryUrl (authorizationUrl/tokenUrl gap)', () => {
  it('CLI --discovery-url is REQUIRED — omitting it fails validation', () => {
    // BUG: There is no --authorization-url / --token-url CLI flag in CredentialPrimitive.
    // The only way to provide authorizationUrl/tokenUrl is via direct JSON edit.
    // This test documents the gap: the CLI FORCES discoveryUrl for OAuth.
    const result = validateAddCredentialOptions({
      name: 'custom-oauth',
      type: 'oauth',
      // discoveryUrl intentionally omitted
      clientId: 'cid',
      clientSecret: 'csec',
    });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/discovery-url/i);
  });

  it('Schema itself accepts authorizationUrl + tokenUrl without discoveryUrl', () => {
    // The schema allows omitting discoveryUrl when authorizationUrl+tokenUrl are both set.
    // But the CLI has no flags to supply those fields — they can only be written
    // directly into agentcore.json.
    const result = OAuthCredentialSchema.safeParse({
      authorizerType: 'OAuthCredentialProvider',
      name: 'custom-oauth',
      authorizationUrl: 'https://idp.example.com/oauth/authorize',
      tokenUrl: 'https://idp.example.com/oauth/token',
      vendor: 'CustomOauth2',
    });
    // Schema should accept this combination
    expect(result.success).toBe(true);
  });

  it('AddCredentialOptions interface has no authorizationUrl or tokenUrl fields', () => {
    // This is a compile-time gap but we can document it via the validate signature.
    // validateAddCredentialOptions only accepts: name, type, apiKey, discoveryUrl,
    // clientId, clientSecret, scopes — no authorizationUrl / tokenUrl.
    const options = validateAddCredentialOptions({
      name: 'custom-oauth',
      type: 'oauth',
      discoveryUrl: 'https://idp.example.com/.well-known/openid-configuration',
      clientId: 'cid',
      clientSecret: 'csec',
    });
    // Passes with discoveryUrl — confirms discoveryUrl is the ONLY URL path in CLI
    expect(options.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Schema cross-validation: 3LO target + CustomOauth2 cred with no URLs → fail
// ---------------------------------------------------------------------------

describe('Scenario 3 — Schema rejects 3LO target with CustomOauth2 cred lacking URLs', () => {
  it('AgentCoreProjectSpecSchema rejects AUTHORIZATION_CODE target when cred has neither discoveryUrl nor authorizationUrl+tokenUrl', () => {
    const spec = {
      ...baseProject,
      credentials: [
        {
          authorizerType: 'OAuthCredentialProvider' as const,
          name: 'bare-oauth',
          vendor: 'CustomOauth2',
          // no discoveryUrl, no authorizationUrl, no tokenUrl
        },
      ],
      agentCoreGateways: [
        {
          name: 'gw',
          ...inboundJwt,
          targets: [
            {
              name: 'target1',
              targetType: 'mcpServer' as const,
              endpoint: 'https://mcp.example.com/sse',
              outboundAuth: {
                type: 'OAUTH' as const,
                credentialName: 'bare-oauth',
                grantType: 'AUTHORIZATION_CODE' as const,
              },
            },
          ],
        },
      ],
    };

    const result = AgentCoreProjectSpecSchema.safeParse(spec);
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = result.error.issues.map(i => i.message).join('\n');
      expect(msg).toMatch(
        /discoveryUrl.*authorizationUrl.*tokenUrl|authorizationUrl.*tokenUrl.*discoveryUrl|neither discoveryUrl/i
      );
    }
  });

  it('Schema ACCEPTS the same 3LO target when credential has discoveryUrl', () => {
    const spec = {
      ...baseProject,
      credentials: [
        {
          authorizerType: 'OAuthCredentialProvider' as const,
          name: 'google-cred',
          discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
          vendor: 'CustomOauth2',
        },
      ],
      agentCoreGateways: [
        {
          name: 'gw',
          ...inboundJwt,
          targets: [
            {
              name: 'target1',
              targetType: 'mcpServer' as const,
              endpoint: 'https://mcp.example.com/sse',
              outboundAuth: {
                type: 'OAUTH' as const,
                credentialName: 'google-cred',
                grantType: 'AUTHORIZATION_CODE' as const,
                defaultReturnUrl: 'https://app.example.com/oauth/return',
              },
            },
          ],
        },
      ],
    };
    const result = AgentCoreProjectSpecSchema.safeParse(spec);
    expect(result.success).toBe(true);
  });

  it('Schema ACCEPTS the same 3LO target when credential has authorizationUrl + tokenUrl', () => {
    const spec = {
      ...baseProject,
      credentials: [
        {
          authorizerType: 'OAuthCredentialProvider' as const,
          name: 'manual-cred',
          authorizationUrl: 'https://idp.example.com/oauth/authorize',
          tokenUrl: 'https://idp.example.com/oauth/token',
          vendor: 'CustomOauth2',
        },
      ],
      agentCoreGateways: [
        {
          name: 'gw',
          ...inboundJwt,
          targets: [
            {
              name: 'target1',
              targetType: 'mcpServer' as const,
              endpoint: 'https://mcp.example.com/sse',
              outboundAuth: {
                type: 'OAUTH' as const,
                credentialName: 'manual-cred',
                grantType: 'AUTHORIZATION_CODE' as const,
                defaultReturnUrl: 'https://app.example.com/oauth/return',
              },
            },
          ],
        },
      ],
    };
    const result = AgentCoreProjectSpecSchema.safeParse(spec);
    expect(result.success).toBe(true);
  });

  it('Schema ACCEPTS the same 3LO target when only authorizationUrl is set but NOT tokenUrl (partial manual URLs)', () => {
    // Partial manual URLs (only authorizationUrl, no tokenUrl) should fail because
    // the rule requires BOTH authorizationUrl AND tokenUrl.
    const spec = {
      ...baseProject,
      credentials: [
        {
          authorizerType: 'OAuthCredentialProvider' as const,
          name: 'partial-cred',
          authorizationUrl: 'https://idp.example.com/oauth/authorize',
          // tokenUrl missing
          vendor: 'CustomOauth2',
        },
      ],
      agentCoreGateways: [
        {
          name: 'gw',
          ...inboundJwt,
          targets: [
            {
              name: 'target1',
              targetType: 'mcpServer' as const,
              endpoint: 'https://mcp.example.com/sse',
              outboundAuth: {
                type: 'OAUTH' as const,
                credentialName: 'partial-cred',
                grantType: 'AUTHORIZATION_CODE' as const,
                defaultReturnUrl: 'https://app.example.com/oauth/return',
              },
            },
          ],
        },
      ],
    };
    const result = AgentCoreProjectSpecSchema.safeParse(spec);
    // Only authorizationUrl without tokenUrl is NOT sufficient — should fail
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Vendor handling
// ---------------------------------------------------------------------------

describe('Scenario 4 — vendor field handling', () => {
  let primitive: CredentialPrimitive;

  beforeEach(() => {
    vi.clearAllMocks();
    mockReadProjectSpec.mockResolvedValue(freshProject());
    primitive = new CredentialPrimitive();
  });

  it('CLI has no --vendor flag — CredentialPrimitive hardcodes vendor to CustomOauth2', async () => {
    await primitive.add({
      authorizerType: 'OAuthCredentialProvider',
      name: 'my-oauth',
      discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
      clientId: 'x',
      clientSecret: 'y',
    });
    const cred = getWrittenCredential();
    if (cred.authorizerType === 'OAuthCredentialProvider') {
      // The createCredential method hardcodes vendor: 'CustomOauth2'
      expect(cred.vendor).toBe('CustomOauth2');
    }
  });

  it('Schema accepts GoogleOauth2 as vendor value', () => {
    const result = OAuthCredentialSchema.safeParse({
      authorizerType: 'OAuthCredentialProvider',
      name: 'google-oauth',
      discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
      vendor: 'GoogleOauth2',
    });
    expect(result.success).toBe(true);
  });

  it('Schema accepts any string vendor (vendor is z.string(), not an enum)', () => {
    // vendor is declared as z.string().default('CustomOauth2') — no enum constraint
    const result = OAuthCredentialSchema.safeParse({
      authorizerType: 'OAuthCredentialProvider',
      name: 'test-oauth',
      discoveryUrl: 'https://example.com/.well-known/openid-configuration',
      vendor: 'InvalidVendor',
    });
    // BUG CANDIDATE: InvalidVendor is accepted at schema level — no vendor allowlist enforced
    expect(result.success).toBe(true);
  });

  it('Schema applies CustomOauth2 default when vendor is omitted', () => {
    const result = OAuthCredentialSchema.safeParse({
      authorizerType: 'OAuthCredentialProvider',
      name: 'no-vendor',
      discoveryUrl: 'https://example.com/.well-known/openid-configuration',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.vendor).toBe('CustomOauth2');
    }
  });
});

// ---------------------------------------------------------------------------
// 5. usage: 'inbound' vs 'outbound'
// ---------------------------------------------------------------------------

describe('Scenario 5 — usage field (inbound vs outbound)', () => {
  let primitive: CredentialPrimitive;

  beforeEach(() => {
    vi.clearAllMocks();
    mockReadProjectSpec.mockResolvedValue(freshProject());
    primitive = new CredentialPrimitive();
  });

  it('Schema accepts usage: inbound', () => {
    const result = OAuthCredentialSchema.safeParse({
      authorizerType: 'OAuthCredentialProvider',
      name: 'inbound-cred',
      discoveryUrl: 'https://idp.example.com/.well-known/openid-configuration',
      usage: 'inbound',
    });
    expect(result.success).toBe(true);
  });

  it('Schema accepts usage: outbound', () => {
    const result = OAuthCredentialSchema.safeParse({
      authorizerType: 'OAuthCredentialProvider',
      name: 'outbound-cred',
      discoveryUrl: 'https://idp.example.com/.well-known/openid-configuration',
      usage: 'outbound',
    });
    expect(result.success).toBe(true);
  });

  it('Schema rejects invalid usage value', () => {
    const result = OAuthCredentialSchema.safeParse({
      authorizerType: 'OAuthCredentialProvider',
      name: 'bad-usage',
      discoveryUrl: 'https://idp.example.com/.well-known/openid-configuration',
      usage: 'both',
    });
    expect(result.success).toBe(false);
  });

  it('usage is optional — omitting it is accepted', () => {
    const result = OAuthCredentialSchema.safeParse({
      authorizerType: 'OAuthCredentialProvider',
      name: 'no-usage',
      discoveryUrl: 'https://idp.example.com/.well-known/openid-configuration',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.usage).toBeUndefined();
  });

  it('CLI add credential has NO --usage flag — usage cannot be set from CLI', async () => {
    // The CLI command in CredentialPrimitive.registerCommands does not declare --usage.
    // The only way to set usage is via direct agentcore.json edit.
    // Verify: add() result stores no usage field (defaults to undefined)
    await primitive.add({
      authorizerType: 'OAuthCredentialProvider',
      name: 'my-oauth',
      discoveryUrl: 'https://example.com/.well-known/openid-configuration',
      clientId: 'x',
      clientSecret: 'y',
    });
    const cred = getWrittenCredential();
    if (cred.authorizerType === 'OAuthCredentialProvider') {
      expect(cred.usage).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Credential name validation
// ---------------------------------------------------------------------------

describe('Scenario 6 — credential name validation', () => {
  it('valid alphanumeric name passes CLI validation', () => {
    const r = validateAddCredentialOptions({
      name: 'myOAuth123',
      type: 'oauth',
      discoveryUrl: 'https://x.com/.well-known/openid-configuration',
      clientId: 'a',
      clientSecret: 'b',
    });
    expect(r.valid).toBe(true);
  });

  it('valid name with hyphens and underscores passes CLI validation', () => {
    const r = validateAddCredentialOptions({
      name: 'my-oauth_cred',
      type: 'oauth',
      discoveryUrl: 'https://x.com/.well-known/openid-configuration',
      clientId: 'a',
      clientSecret: 'b',
    });
    expect(r.valid).toBe(true);
  });

  it('name with forward slash is rejected by CredentialNameSchema', () => {
    // CLI validate calls the schema-level check via CredentialSchema on writeProjectSpec,
    // but validateAddCredentialOptions itself does NOT validate name format — only checks presence.
    // So the slash will only be caught when Zod validates on write.
    // Here we verify the raw schema rejects it:
    expect(CredentialNameSchema.safeParse('my/cred').success).toBe(false);
  });

  it('name with spaces is rejected by CredentialNameSchema', () => {
    expect(CredentialNameSchema.safeParse('my cred').success).toBe(false);
  });

  it('name with unicode is rejected by CredentialNameSchema', () => {
    expect(CredentialNameSchema.safeParse('my-cred-é').success).toBe(false);
  });

  it('validateAddCredentialOptions does NOT validate name format — only presence', () => {
    // BUG: name format (slash, space, unicode) is NOT checked in validateAddCredentialOptions.
    // Invalid names pass CLI validation and only fail later at schema write time.
    const r = validateAddCredentialOptions({ name: 'bad/name', type: 'api-key', apiKey: 'k' });
    // The CLI validate function only checks if name is truthy — does not apply regex
    expect(r.valid).toBe(true); // This exposes the gap
  });
});

// ---------------------------------------------------------------------------
// Bonus — TUI Phase 3 surface: authorizationUrl/tokenUrl IS now collectable
// ---------------------------------------------------------------------------
//
// BB06 originally documented this as a deferred gap (see commit 821c9e06).
// The Phase 3.1 TUI work in commit db060524 closed the gap by adding the
// 'oauthMode' / 'authorizationUrl' / 'tokenUrl' wizard steps. This test
// asserts the closure so any regression that drops the steps is caught.

describe('Phase 3.1 closure: authorizationUrl/tokenUrl ARE collectable via TUI', () => {
  it('AddIdentityConfig wizard exposes authorizationUrl and tokenUrl steps', async () => {
    const typesModule = await import('../../tui/screens/identity/types');
    const labels = typesModule.IDENTITY_STEP_LABELS;
    const stepIds = Object.keys(labels);
    expect(stepIds).toContain('authorizationUrl');
    expect(stepIds).toContain('tokenUrl');
    expect(stepIds).toContain('oauthMode');
  });
});
