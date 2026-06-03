/**
 * Unit tests for the outbound-3lo-status helper. Mocks the AWS SDK and the
 * getTokenStatus wrapper so this stays a pure unit test.
 */
import type { AgentCoreProjectSpec, DeployedState } from '../../../../schema';
import { NotThreeLoTargetError, TargetNotFoundError, fetchOutboundAccessStatus } from '../outbound-3lo-status';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockGetTokenStatus, mockSdkSend } = vi.hoisted(() => ({
  mockGetTokenStatus: vi.fn(),
  mockSdkSend: vi.fn(),
}));

vi.mock('../../identity/token-status', async () => {
  const actual = await vi.importActual<typeof import('../../identity/token-status')>('../../identity/token-status');
  return { ...actual, getTokenStatus: mockGetTokenStatus };
});

vi.mock('@aws-sdk/client-bedrock-agentcore', () => {
  class MockBedrockAgentCoreClient {
    send = mockSdkSend;
  }
  class GetWorkloadAccessTokenCommand {
    constructor(public input: unknown) {}
  }
  return { BedrockAgentCoreClient: MockBedrockAgentCoreClient, GetWorkloadAccessTokenCommand };
});

vi.mock('../../../aws', () => ({
  getCredentialProvider: () => () => Promise.resolve({ accessKeyId: 'x', secretAccessKey: 'y' }),
}));

const baseProjectSpec: AgentCoreProjectSpec = {
  $schema: '',
  name: 'TestProj',
  version: 1,
  managedBy: 'CDK',
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
      authorizerType: 'OAuthCredentialProvider',
      name: 'google-cred',
      vendor: 'GoogleOauth2',
      discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
    },
  ],
  agentCoreGateways: [
    {
      name: 'my-gw',
      authorizerType: 'CUSTOM_JWT',
      authorizerConfiguration: {
        customJwtAuthorizer: {
          discoveryUrl: 'https://accounts.example.com/.well-known/openid-configuration',
          allowedAudience: ['my-app'],
        },
      },
      enableSemanticSearch: true,
      exceptionLevel: 'NONE',
      targets: [
        {
          name: 'cal-target',
          targetType: 'mcpServer',
          endpoint: 'https://example.com/mcp',
          outboundAuth: {
            type: 'OAUTH',
            credentialName: 'google-cred',
            grantType: 'AUTHORIZATION_CODE',
            scopes: ['calendar.readonly'],
          },
        },
        {
          name: 'two-leg-target',
          targetType: 'mcpServer',
          endpoint: 'https://example.com/mcp',
          outboundAuth: {
            type: 'OAUTH',
            credentialName: 'google-cred',
            scopes: ['public'],
          },
        },
      ],
    },
  ],
} as unknown as AgentCoreProjectSpec;

const baseDeployedState: DeployedState = {
  targets: {
    default: {
      resources: {
        credentials: {
          'google-cred': {
            credentialProviderArn: 'arn:aws:bedrock-agentcore:us-west-2:1:cred/google-cred',
            callbackUrl: 'https://bedrock-agentcore.us-west-2.amazonaws.com/identities/oauth2/callback/abc-123',
          },
        },
      },
    },
  },
} as DeployedState;

const baseInput = {
  projectSpec: baseProjectSpec,
  deployedState: baseDeployedState,
  deploymentTargetName: 'default',
  gatewayName: 'my-gw',
  targetName: 'cal-target',
  region: 'us-west-2',
};

describe('fetchOutboundAccessStatus', () => {
  afterEach(() => vi.clearAllMocks());

  it('throws TargetNotFoundError for unknown gateway', async () => {
    await expect(fetchOutboundAccessStatus({ ...baseInput, gatewayName: 'no-such-gw' })).rejects.toBeInstanceOf(
      TargetNotFoundError
    );
  });

  it('throws TargetNotFoundError for unknown target', async () => {
    await expect(fetchOutboundAccessStatus({ ...baseInput, targetName: 'no-such-target' })).rejects.toBeInstanceOf(
      TargetNotFoundError
    );
  });

  it('throws NotThreeLoTargetError for 2LO targets', async () => {
    await expect(fetchOutboundAccessStatus({ ...baseInput, targetName: 'two-leg-target' })).rejects.toBeInstanceOf(
      NotThreeLoTargetError
    );
  });

  it('returns status with all companion fields populated for a 3LO target', async () => {
    mockSdkSend.mockResolvedValueOnce({ workloadAccessToken: 'workload-jwt' });
    mockGetTokenStatus.mockResolvedValueOnce({ status: 'fresh' });

    const result = await fetchOutboundAccessStatus(baseInput);

    expect(result.tokenStatus).toEqual({ status: 'fresh' });
    expect(result.callbackUrl).toBe(
      'https://bedrock-agentcore.us-west-2.amazonaws.com/identities/oauth2/callback/abc-123'
    );
    expect(result.gatewayName).toBe('my-gw');
    expect(result.targetName).toBe('cal-target');
    expect(result.grantType).toBe('AUTHORIZATION_CODE');
    expect(result.credentialName).toBe('google-cred');
  });

  it('forwards forceReauth into getTokenStatus', async () => {
    mockSdkSend.mockResolvedValueOnce({ workloadAccessToken: 'workload-jwt' });
    mockGetTokenStatus.mockResolvedValueOnce({ status: 'fresh' });

    await fetchOutboundAccessStatus({ ...baseInput, forceReauth: true });

    expect(mockGetTokenStatus).toHaveBeenCalledWith(
      expect.objectContaining({ forceAuthentication: true, oauth2Flow: 'USER_FEDERATION' })
    );
  });

  it('forwards the credential scopes into getTokenStatus', async () => {
    mockSdkSend.mockResolvedValueOnce({ workloadAccessToken: 'workload-jwt' });
    mockGetTokenStatus.mockResolvedValueOnce({ status: 'fresh' });

    await fetchOutboundAccessStatus(baseInput);

    expect(mockGetTokenStatus).toHaveBeenCalledWith(expect.objectContaining({ scopes: ['calendar.readonly'] }));
  });

  it('throws when GetWorkloadAccessToken returns no token', async () => {
    mockSdkSend.mockResolvedValueOnce({});

    await expect(fetchOutboundAccessStatus(baseInput)).rejects.toThrow(/no token/i);
    expect(mockGetTokenStatus).not.toHaveBeenCalled();
  });

  it('omits callbackUrl when deployed state has no entry for the credential', async () => {
    mockSdkSend.mockResolvedValueOnce({ workloadAccessToken: 'workload-jwt' });
    mockGetTokenStatus.mockResolvedValueOnce({ status: 'needsConsent', authorizationUrl: 'https://idp/x' });

    const stateNoCallback = {
      targets: { default: { resources: { credentials: {} } } },
    } as DeployedState;
    const result = await fetchOutboundAccessStatus({ ...baseInput, deployedState: stateNoCallback });

    expect(result.callbackUrl).toBeUndefined();
    expect(result.tokenStatus.status).toBe('needsConsent');
  });
});
