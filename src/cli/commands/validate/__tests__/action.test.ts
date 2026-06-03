import { handleValidate } from '../action.js';
import assert from 'node:assert';
import { afterEach, describe, expect, it, vi } from 'vitest';

const {
  mockReadProjectSpec,
  mockReadAWSDeploymentTargets,
  mockReadDeployedState,
  mockWriteProjectSpec,
  mockConfigExists,
  mockFindConfigRoot,
} = vi.hoisted(() => ({
  mockReadProjectSpec: vi.fn(),
  mockReadAWSDeploymentTargets: vi.fn(),
  mockReadDeployedState: vi.fn(),
  mockWriteProjectSpec: vi.fn().mockResolvedValue(undefined),
  mockConfigExists: vi.fn(),
  mockFindConfigRoot: vi.fn(),
}));

vi.mock('../../../../lib/index.js', () => {
  class NoProjectError extends Error {
    constructor(msg?: string) {
      super(msg ?? 'No agentcore project found');
      this.name = 'NoProjectError';
    }
  }

  class ConfigValidationError extends Error {}
  class ConfigParseError extends Error {
    constructor(
      public readonly filePath: string,
      public override readonly cause: unknown
    ) {
      super(`Parse error at ${filePath}`);
    }
  }
  class ConfigReadError extends Error {
    constructor(
      public readonly filePath: string,
      public override readonly cause: unknown
    ) {
      super(`Read error at ${filePath}`);
    }
  }
  class ConfigNotFoundError extends Error {
    constructor(
      public readonly filePath: string,
      public readonly fileType: string
    ) {
      super(`${fileType} not found at ${filePath}`);
    }
  }

  return {
    ConfigIO: class {
      readProjectSpec = mockReadProjectSpec;
      readAWSDeploymentTargets = mockReadAWSDeploymentTargets;
      readDeployedState = mockReadDeployedState;
      writeProjectSpec = mockWriteProjectSpec;
      configExists = mockConfigExists;
    },
    ConfigValidationError,
    ConfigParseError,
    ConfigReadError,
    ConfigNotFoundError,
    NoProjectError,
    findConfigRoot: mockFindConfigRoot,
  };
});

describe('handleValidate', () => {
  afterEach(() => vi.clearAllMocks());

  it('returns error when no project found', async () => {
    mockFindConfigRoot.mockReturnValue(null);

    const result = await handleValidate({});

    expect(result.success).toBe(false);
    assert(!result.success);
    expect(result.error.message).toContain('No agentcore project found');
  });

  it('returns success when all configs are valid', async () => {
    mockFindConfigRoot.mockReturnValue('/project/agentcore');
    mockReadProjectSpec.mockResolvedValue({ name: 'Test', version: 1, managedBy: 'CDK' as const, runtimes: [] });
    mockReadAWSDeploymentTargets.mockResolvedValue([]);
    mockConfigExists.mockReturnValue(false);

    const result = await handleValidate({});

    expect(result.success).toBe(true);
  });

  it('returns error when project spec fails', async () => {
    mockFindConfigRoot.mockReturnValue('/project/agentcore');
    mockReadProjectSpec.mockRejectedValue(new Error('invalid project'));

    const result = await handleValidate({});

    expect(result.success).toBe(false);
    assert(!result.success);
    expect(result.error.message).toContain('invalid project');
  });

  it('returns error when AWS targets fails', async () => {
    mockFindConfigRoot.mockReturnValue('/project/agentcore');
    mockReadProjectSpec.mockResolvedValue({ name: 'Test', version: 1, managedBy: 'CDK' as const, runtimes: [] });
    mockReadAWSDeploymentTargets.mockRejectedValue(new Error('bad targets'));

    const result = await handleValidate({});

    expect(result.success).toBe(false);
    assert(!result.success);
    expect(result.error.message).toContain('bad targets');
  });

  it('validates state file when it exists', async () => {
    mockFindConfigRoot.mockReturnValue('/project/agentcore');
    mockReadProjectSpec.mockResolvedValue({ name: 'Test', version: 1, managedBy: 'CDK' as const, runtimes: [] });
    mockReadAWSDeploymentTargets.mockResolvedValue([]);
    mockConfigExists.mockReturnValue(true);
    mockReadDeployedState.mockResolvedValue({ targets: {} });

    const result = await handleValidate({});

    expect(result.success).toBe(true);
    expect(mockReadDeployedState).toHaveBeenCalled();
  });

  it('returns error when state file is invalid', async () => {
    mockFindConfigRoot.mockReturnValue('/project/agentcore');
    mockReadProjectSpec.mockResolvedValue({ name: 'Test', version: 1, managedBy: 'CDK' as const, runtimes: [] });
    mockReadAWSDeploymentTargets.mockResolvedValue([]);
    mockConfigExists.mockReturnValue(true);
    mockReadDeployedState.mockRejectedValue(new Error('bad state'));

    const result = await handleValidate({});

    expect(result.success).toBe(false);
    assert(!result.success);
    expect(result.error.message).toContain('bad state');
  });

  it('uses custom directory when provided', async () => {
    mockFindConfigRoot.mockReturnValue('/custom/agentcore');
    mockReadProjectSpec.mockResolvedValue({ name: 'Test', version: 1, managedBy: 'CDK' as const, runtimes: [] });
    mockReadAWSDeploymentTargets.mockResolvedValue([]);
    mockConfigExists.mockReturnValue(false);

    const result = await handleValidate({ directory: '/custom' });

    expect(result.success).toBe(true);
    expect(mockFindConfigRoot).toHaveBeenCalledWith('/custom');
  });

  it('formats ConfigValidationError with its message', async () => {
    mockFindConfigRoot.mockReturnValue('/project/agentcore');
    const { ConfigValidationError } = await import('../../../../lib/index.js');
    mockReadProjectSpec.mockRejectedValue(new (ConfigValidationError as any)('field "name" is required'));

    const result = await handleValidate({});

    expect(result.success).toBe(false);
    assert(!result.success);
    expect(result.error.message).toBe('field "name" is required');
  });

  it('formats ConfigParseError with cause', async () => {
    mockFindConfigRoot.mockReturnValue('/project/agentcore');
    const { ConfigParseError } = await import('../../../../lib/index.js');
    mockReadProjectSpec.mockRejectedValue(new ConfigParseError('agentcore.json', new Error('Unexpected token')));

    const result = await handleValidate({});

    expect(result.success).toBe(false);
    assert(!result.success);
    expect(result.error.message).toContain('Invalid JSON in agentcore.json');
    expect(result.error.message).toContain('Unexpected token');
  });

  it('formats ConfigReadError with cause', async () => {
    mockFindConfigRoot.mockReturnValue('/project/agentcore');
    const { ConfigReadError } = await import('../../../../lib/index.js');
    mockReadProjectSpec.mockRejectedValue(
      new ConfigReadError('agentcore.json', new Error('EACCES: permission denied'))
    );

    const result = await handleValidate({});

    expect(result.success).toBe(false);
    assert(!result.success);
    expect(result.error.message).toContain('Failed to read agentcore.json');
    expect(result.error.message).toContain('EACCES');
  });

  it('formats ConfigNotFoundError with file name', async () => {
    mockFindConfigRoot.mockReturnValue('/project/agentcore');
    const { ConfigNotFoundError } = await import('../../../../lib/index.js');
    mockReadProjectSpec.mockRejectedValue(new ConfigNotFoundError('/path/agentcore.json', 'project'));

    const result = await handleValidate({});

    expect(result.success).toBe(false);
    assert(!result.success);
    expect(result.error.message).toBe('Required file not found: agentcore.json');
  });

  it('formats non-Error values as strings', async () => {
    mockFindConfigRoot.mockReturnValue('/project/agentcore');
    mockReadProjectSpec.mockRejectedValue('string error');

    const result = await handleValidate({});

    expect(result.success).toBe(false);
    assert(!result.success);
    expect(result.error.message).toBe('string error');
  });

  describe('scope precedence (no migration)', () => {
    // Both `target.outboundAuth.scopes` and `credential.scopes` are first-class
    // shapes. The deploy and consent paths resolve effective scopes via
    // `resolveEffectiveScopes` (target wins, credential fallback). `validate`
    // does NOT migrate or mutate the file; it only reports schema validity.
    const projectWithCredScopes = {
      name: 'Test',
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
      credentials: [
        {
          authorizerType: 'OAuthCredentialProvider' as const,
          name: 'cred-1',
          discoveryUrl: 'https://accounts.example.com/.well-known/openid-configuration',
          scopes: ['orders.read', 'inventory.read'],
          vendor: 'CustomOauth2',
        },
      ],
      agentCoreGateways: [
        {
          name: 'gw',
          targets: [
            {
              name: 'tgt-2lo',
              targetType: 'mcpServer',
              endpoint: 'https://example.com/mcp',
              outboundAuth: { type: 'OAUTH', credentialName: 'cred-1' },
            },
          ],
        },
      ],
    };

    it('is read-only: never writes the project spec', async () => {
      mockFindConfigRoot.mockReturnValue('/project/agentcore');
      const spec = structuredClone(projectWithCredScopes);
      mockReadProjectSpec.mockResolvedValue(spec);
      mockReadAWSDeploymentTargets.mockResolvedValue([]);
      mockConfigExists.mockReturnValue(false);

      const result = await handleValidate({});

      expect(result.success).toBe(true);
      expect(mockWriteProjectSpec).not.toHaveBeenCalled();
      // Original spec is untouched — no migration of cred.scopes onto the target.
      expect((spec.agentCoreGateways[0]!.targets[0]!.outboundAuth as { scopes?: string[] }).scopes).toBeUndefined();
    });

    it('does NOT emit a deprecation note when scopes are on credential and not target', async () => {
      mockFindConfigRoot.mockReturnValue('/project/agentcore');
      mockReadProjectSpec.mockResolvedValue(structuredClone(projectWithCredScopes));
      mockReadAWSDeploymentTargets.mockResolvedValue([]);
      mockConfigExists.mockReturnValue(false);

      const result = await handleValidate({});

      expect(result.success).toBe(true);
      assert(result.success);
      expect(result.notes?.some(n => n.includes('[deprecation]')) ?? false).toBe(false);
    });
  });

  describe('3LO callback-URL informational notes', () => {
    const callback = 'https://bedrock-agentcore.us-west-2.amazonaws.com/identities/oauth2/callback/uuid-1';

    const project3lo = {
      name: 'Test',
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
          targets: [
            {
              name: 'cal',
              targetType: 'mcpServer',
              endpoint: 'https://example.com/mcp',
              outboundAuth: { type: 'OAUTH', credentialName: 'google-cred', grantType: 'AUTHORIZATION_CODE' },
            },
          ],
        },
      ],
    };

    it('surfaces callbackUrl from deployed state', async () => {
      mockFindConfigRoot.mockReturnValue('/project/agentcore');
      mockReadProjectSpec.mockResolvedValue(structuredClone(project3lo));
      mockReadAWSDeploymentTargets.mockResolvedValue([]);
      mockConfigExists.mockReturnValue(true);
      mockReadDeployedState.mockResolvedValue({
        targets: {
          default: {
            resources: {
              credentials: {
                'google-cred': {
                  credentialProviderArn: 'arn:aws:bedrock-agentcore:us-west-2:1:cred/google-cred',
                  callbackUrl: callback,
                },
              },
            },
          },
        },
      });

      const result = await handleValidate({});

      expect(result.success).toBe(true);
      assert(result.success);
      expect(result.notes?.some(n => n.includes(callback))).toBe(true);
      expect(result.notes?.some(n => n.includes('register this callback URL'))).toBe(true);
    });

    it('emits a "deploy first" note when 3LO target exists but state is empty', async () => {
      mockFindConfigRoot.mockReturnValue('/project/agentcore');
      mockReadProjectSpec.mockResolvedValue(structuredClone(project3lo));
      mockReadAWSDeploymentTargets.mockResolvedValue([]);
      mockConfigExists.mockReturnValue(false);

      const result = await handleValidate({});

      expect(result.success).toBe(true);
      assert(result.success);
      expect(result.notes?.some(n => n.includes('no deployment targets in state yet'))).toBe(true);
    });
  });
});
