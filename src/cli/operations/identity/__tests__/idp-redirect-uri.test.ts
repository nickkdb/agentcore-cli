import type { DeployedState } from '../../../../schema';
import { getIdpRedirectUriForTarget, setIdpRedirectUriForTarget } from '../idp-redirect-uri.js';
import { describe, expect, it } from 'vitest';

const CALLBACK = 'https://bedrock-agentcore.us-west-2.amazonaws.com/identities/oauth2/callback/abc-123';

function makeState(): DeployedState {
  return {
    targets: {
      default: {
        resources: {
          credentials: {
            'google-cred': {
              credentialProviderArn:
                'arn:aws:bedrock-agentcore:us-west-2:603141041947:token-vault/default/oauth2credentialprovider/google-cred',
              callbackUrl: CALLBACK,
            },
            'plain-cred': {
              credentialProviderArn:
                'arn:aws:bedrock-agentcore:us-west-2:603141041947:token-vault/default/oauth2credentialprovider/plain-cred',
            },
          },
        },
      },
    },
  };
}

describe('getIdpRedirectUriForTarget', () => {
  it('returns callbackUrl when present', () => {
    expect(getIdpRedirectUriForTarget(makeState(), 'default', 'google-cred')).toBe(CALLBACK);
  });

  it('returns undefined when callbackUrl is absent on the credential', () => {
    expect(getIdpRedirectUriForTarget(makeState(), 'default', 'plain-cred')).toBeUndefined();
  });

  it('returns undefined when credential is unknown', () => {
    expect(getIdpRedirectUriForTarget(makeState(), 'default', 'missing')).toBeUndefined();
  });

  it('returns undefined when target name is unknown', () => {
    expect(getIdpRedirectUriForTarget(makeState(), 'never-deployed', 'google-cred')).toBeUndefined();
  });

  it('returns undefined when state is undefined', () => {
    expect(getIdpRedirectUriForTarget(undefined, 'default', 'google-cred')).toBeUndefined();
  });
});

describe('setIdpRedirectUriForTarget', () => {
  it('updates an existing credential entry', () => {
    const state = makeState();
    const newUrl = 'https://bedrock-agentcore.us-west-2.amazonaws.com/identities/oauth2/callback/xyz-789';
    setIdpRedirectUriForTarget(state, 'default', 'plain-cred', newUrl);
    expect(state.targets.default?.resources?.credentials?.['plain-cred']?.callbackUrl).toBe(newUrl);
  });

  it('throws when the credential is not yet in deployed state', () => {
    const state = makeState();
    expect(() => setIdpRedirectUriForTarget(state, 'default', 'never-deployed-cred', CALLBACK)).toThrow(
      /Cannot set IdP redirect URI/
    );
  });

  it('round-trips: set then get returns the same value', () => {
    const state = makeState();
    const url = 'https://bedrock-agentcore.us-west-2.amazonaws.com/identities/oauth2/callback/round-trip';
    setIdpRedirectUriForTarget(state, 'default', 'google-cred', url);
    expect(getIdpRedirectUriForTarget(state, 'default', 'google-cred')).toBe(url);
  });
});
