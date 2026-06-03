import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockReadDeployedState, mockReadProjectSpec, mockConfigExists } = vi.hoisted(() => ({
  mockReadDeployedState: vi.fn(),
  mockReadProjectSpec: vi.fn(),
  mockConfigExists: vi.fn(),
}));

vi.mock('../../../../lib/index.js', () => ({
  ConfigIO: class {
    readDeployedState = mockReadDeployedState;
    readProjectSpec = mockReadProjectSpec;
    configExists = mockConfigExists;
  },
}));

const { getGatewayEnvVars } = await import('../gateway-env.js');

describe('getGatewayEnvVars', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty when no deployed state', async () => {
    mockReadDeployedState.mockRejectedValue(new Error('not found'));
    const result = await getGatewayEnvVars();
    expect(result).toEqual({});
  });

  it('returns empty when no gateways deployed', async () => {
    mockReadDeployedState.mockResolvedValue({ targets: {} });
    mockConfigExists.mockReturnValue(false);
    const result = await getGatewayEnvVars();
    expect(result).toEqual({});
  });

  it('generates URL and AUTH_TYPE env vars for deployed gateway', async () => {
    mockReadDeployedState.mockResolvedValue({
      targets: {
        default: {
          resources: {
            mcp: {
              gateways: {
                'my-gateway': { gatewayUrl: 'https://gw.example.com' },
              },
            },
          },
        },
      },
    });
    mockConfigExists.mockReturnValue(true);
    mockReadProjectSpec.mockResolvedValue({
      agentCoreGateways: [{ name: 'my-gateway', authorizerType: 'CUSTOM_JWT' }],
    });

    const result = await getGatewayEnvVars();
    expect(result).toEqual({
      AGENTCORE_GATEWAY_MY_GATEWAY_URL: 'https://gw.example.com',
      AGENTCORE_GATEWAY_MY_GATEWAY_AUTH_TYPE: 'CUSTOM_JWT',
    });
  });

  it('defaults auth type to NONE when gateway not in mcp spec', async () => {
    mockReadDeployedState.mockResolvedValue({
      targets: {
        default: {
          resources: { mcp: { gateways: { 'test-gw': { gatewayUrl: 'https://test.com' } } } },
        },
      },
    });
    mockConfigExists.mockReturnValue(true);
    mockReadProjectSpec.mockResolvedValue({ agentCoreGateways: [] });

    const result = await getGatewayEnvVars();
    expect(result.AGENTCORE_GATEWAY_TEST_GW_AUTH_TYPE).toBe('NONE');
  });

  it('skips gateways without gatewayUrl', async () => {
    mockReadDeployedState.mockResolvedValue({
      targets: {
        default: {
          resources: { mcp: { gateways: { 'no-url': {} } } },
        },
      },
    });
    mockConfigExists.mockReturnValue(false);

    const result = await getGatewayEnvVars();
    expect(result).toEqual({});
  });

  it('surfaces per-3LO-target metadata for the dev container (Phase 3.10)', async () => {
    mockReadDeployedState.mockResolvedValue({
      targets: {
        default: {
          resources: {
            mcp: { gateways: { gw1: { gatewayUrl: 'https://gw1.example.com' } } },
            credentials: {
              'google-cred': {
                credentialProviderArn: 'arn:aws:bedrock-agentcore:us-west-2:1:cred/google-cred',
                callbackUrl: 'https://bedrock-agentcore.us-west-2.amazonaws.com/identities/oauth2/callback/abc',
              },
            },
          },
        },
      },
    });
    mockConfigExists.mockReturnValue(true);
    mockReadProjectSpec.mockResolvedValue({
      agentCoreGateways: [
        {
          name: 'gw1',
          authorizerType: 'CUSTOM_JWT',
          targets: [
            {
              name: 'cal-target',
              targetType: 'mcpServer',
              outboundAuth: {
                type: 'OAUTH',
                credentialName: 'google-cred',
                grantType: 'AUTHORIZATION_CODE',
              },
            },
            {
              name: 'two-leg',
              targetType: 'mcpServer',
              outboundAuth: {
                type: 'OAUTH',
                credentialName: 'google-cred',
                // No grantType -> defaults to 2LO; should NOT surface env vars.
              },
            },
          ],
        },
      ],
    });

    const result = await getGatewayEnvVars();
    expect(result.AGENTCORE_GATEWAY_GW1_TARGET_CAL_TARGET_GRANT_TYPE).toBe('AUTHORIZATION_CODE');
    expect(result.AGENTCORE_GATEWAY_GW1_TARGET_CAL_TARGET_CALLBACK_URL).toBe(
      'https://bedrock-agentcore.us-west-2.amazonaws.com/identities/oauth2/callback/abc'
    );
    // 2LO target should NOT surface 3LO env vars.
    expect(result.AGENTCORE_GATEWAY_GW1_TARGET_TWO_LEG_GRANT_TYPE).toBeUndefined();
    expect(result.AGENTCORE_GATEWAY_GW1_TARGET_TWO_LEG_CALLBACK_URL).toBeUndefined();
  });

  it('omits 3LO callback-url env var when deployed state has no entry for the credential', async () => {
    mockReadDeployedState.mockResolvedValue({
      targets: {
        default: {
          resources: {
            mcp: { gateways: { gw1: { gatewayUrl: 'https://gw1.example.com' } } },
            credentials: {},
          },
        },
      },
    });
    mockConfigExists.mockReturnValue(true);
    mockReadProjectSpec.mockResolvedValue({
      agentCoreGateways: [
        {
          name: 'gw1',
          authorizerType: 'CUSTOM_JWT',
          targets: [
            {
              name: 'cal',
              targetType: 'mcpServer',
              outboundAuth: {
                type: 'OAUTH',
                credentialName: 'google-cred',
                grantType: 'AUTHORIZATION_CODE',
              },
            },
          ],
        },
      ],
    });

    const result = await getGatewayEnvVars();
    expect(result.AGENTCORE_GATEWAY_GW1_TARGET_CAL_GRANT_TYPE).toBe('AUTHORIZATION_CODE');
    expect(result.AGENTCORE_GATEWAY_GW1_TARGET_CAL_CALLBACK_URL).toBeUndefined();
  });
});
