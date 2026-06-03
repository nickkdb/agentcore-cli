import type { AgentCoreProjectSpec, DeployedState } from '../../../../schema';
import { collectThreeLoBannerEntries, renderThreeLoBanner } from '../post-deploy-3lo-banner.js';
import { describe, expect, it } from 'vitest';

const baseSpec = {
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
  credentials: [
    {
      authorizerType: 'OAuthCredentialProvider' as const,
      name: 'google-cred',
      discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
      vendor: 'GoogleOauth2',
    },
  ],
  agentCoreGateways: [
    {
      name: 'gw',
      targets: [
        {
          name: 'cal',
          targetType: 'mcpServer' as const,
          endpoint: 'https://example.com/mcp',
          outboundAuth: {
            type: 'OAUTH' as const,
            credentialName: 'google-cred',
            grantType: 'AUTHORIZATION_CODE' as const,
          },
        },
      ],
    },
  ],
};

const stateWithCallback: DeployedState = {
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
};

describe('collectThreeLoBannerEntries', () => {
  it('returns one entry for a newly-deployed 3LO target', () => {
    const entries = collectThreeLoBannerEntries({
      projectSpec: baseSpec as unknown as AgentCoreProjectSpec,
      deployedState: stateWithCallback,
      previousDeployedState: undefined,
      deploymentTargetName: 'default',
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      gatewayName: 'gw',
      targetName: 'cal',
      credentialName: 'google-cred',
      callbackUrl: 'https://bedrock-agentcore.us-west-2.amazonaws.com/identities/oauth2/callback/abc-123',
      vendor: 'GoogleOauth2',
    });
  });

  it('returns empty when callbackUrl is unchanged from the previous deploy', () => {
    const entries = collectThreeLoBannerEntries({
      projectSpec: baseSpec as unknown as AgentCoreProjectSpec,
      deployedState: stateWithCallback,
      previousDeployedState: stateWithCallback,
      deploymentTargetName: 'default',
    });
    expect(entries).toHaveLength(0);
  });

  it('returns an entry when callbackUrl changed (provider re-created)', () => {
    const previousState: DeployedState = {
      targets: {
        default: {
          resources: {
            credentials: {
              'google-cred': {
                credentialProviderArn: 'arn:aws:bedrock-agentcore:us-west-2:1:cred/google-cred',
                callbackUrl: 'https://old-callback.example.com/cb',
              },
            },
          },
        },
      },
    };
    const entries = collectThreeLoBannerEntries({
      projectSpec: baseSpec as unknown as AgentCoreProjectSpec,
      deployedState: stateWithCallback,
      previousDeployedState: previousState,
      deploymentTargetName: 'default',
    });
    expect(entries).toHaveLength(1);
  });

  it('returns empty for 2LO targets', () => {
    const spec = JSON.parse(JSON.stringify(baseSpec));
    delete spec.agentCoreGateways[0].targets[0].outboundAuth.grantType;
    const entries = collectThreeLoBannerEntries({
      projectSpec: spec as AgentCoreProjectSpec,
      deployedState: stateWithCallback,
      previousDeployedState: undefined,
      deploymentTargetName: 'default',
    });
    expect(entries).toHaveLength(0);
  });

  it('returns empty when callbackUrl is missing in deployed state', () => {
    const stateNoCallback: DeployedState = {
      targets: {
        default: {
          resources: {
            credentials: {
              'google-cred': { credentialProviderArn: 'arn:x' },
            },
          },
        },
      },
    };
    const entries = collectThreeLoBannerEntries({
      projectSpec: baseSpec as unknown as AgentCoreProjectSpec,
      deployedState: stateNoCallback,
      previousDeployedState: undefined,
      deploymentTargetName: 'default',
    });
    expect(entries).toHaveLength(0);
  });

  it('produces an entry for a CustomOauth2 credential', () => {
    const spec = JSON.parse(JSON.stringify(baseSpec));
    spec.credentials[0].vendor = 'CustomOauth2';
    const entries = collectThreeLoBannerEntries({
      projectSpec: spec as AgentCoreProjectSpec,
      deployedState: stateWithCallback,
      previousDeployedState: undefined,
      deploymentTargetName: 'default',
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.vendor).toBe('CustomOauth2');
  });
});

describe('renderThreeLoBanner', () => {
  it('returns empty string for no entries', () => {
    expect(renderThreeLoBanner([])).toBe('');
  });

  it('includes target name, credential name, and callback URL', () => {
    const banner = renderThreeLoBanner([
      {
        gatewayName: 'gw',
        targetName: 'cal',
        credentialName: 'google-cred',
        callbackUrl: 'https://bedrock-agentcore.us-west-2.amazonaws.com/identities/oauth2/callback/abc',
        vendor: 'GoogleOauth2',
      },
    ]);
    expect(banner).toContain('gw/cal');
    expect(banner).toContain('google-cred');
    expect(banner).toContain('GoogleOauth2');
    expect(banner).toContain('https://bedrock-agentcore.us-west-2.amazonaws.com/identities/oauth2/callback/abc');
    expect(banner).toContain('agentcore invoke');
    expect(banner).toContain('agentcore fetch access');
  });
});
