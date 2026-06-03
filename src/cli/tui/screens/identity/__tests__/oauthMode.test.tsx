/**
 * Tests for the OAuth-mode wizard branch (Phase 3.1):
 * - 'discovery' mode collects discoveryUrl alone (back-compat path).
 * - 'manual' mode collects authorizationUrl + tokenUrl (CustomOauth2 / 3LO
 *   without OIDC discovery).
 *
 * Asserts the dynamic `steps` array branches correctly and the new setters
 * route to the right next step.
 */
import type { AddIdentityStep, OAuthEndpointMode } from '../types';
import { useAddIdentityWizard } from '../useAddIdentityWizard';
import { Text } from 'ink';
import { render } from 'ink-testing-library';
import React, { act, useImperativeHandle } from 'react';
import { describe, expect, it } from 'vitest';

interface HarnessHandle {
  setIdentityType: (t: 'OAuthCredentialProvider' | 'ApiKeyCredentialProvider') => void;
  setName: (n: string) => void;
  setOauthMode: (m: OAuthEndpointMode) => void;
  setDiscoveryUrl: (u: string) => void;
  setAuthorizationUrl: (u: string) => void;
  setTokenUrl: (u: string) => void;
  getStep: () => AddIdentityStep;
  getSteps: () => AddIdentityStep[];
  getConfig: () => ReturnType<ReturnType<typeof useAddIdentityWizard>['config'] extends infer T ? () => T : never>;
}

function ImpHarness({ handleRef }: { handleRef: React.Ref<HarnessHandle> }) {
  const wizard = useAddIdentityWizard();
  useImperativeHandle(handleRef, () => ({
    setIdentityType: wizard.setIdentityType,
    setName: wizard.setName,
    setOauthMode: wizard.setOauthMode,
    setDiscoveryUrl: wizard.setDiscoveryUrl,
    setAuthorizationUrl: wizard.setAuthorizationUrl,
    setTokenUrl: wizard.setTokenUrl,
    getStep: () => wizard.step,
    getSteps: () => wizard.steps,
    getConfig: () => wizard.config,
  }));
  return <Text>step:{wizard.step}</Text>;
}

function setup() {
  const handleRef = React.createRef<HarnessHandle>();
  render(<ImpHarness handleRef={handleRef} />);
  return handleRef;
}

describe('useAddIdentityWizard — OAuth mode branch', () => {
  it('OAuth path includes oauthMode step before url collection', () => {
    const ref = setup();
    act(() => ref.current!.setIdentityType('OAuthCredentialProvider'));
    act(() => ref.current!.setName('mycred'));
    expect(ref.current!.getSteps()).toContain('oauthMode');
    expect(ref.current!.getStep()).toBe('oauthMode');
  });

  it("'discovery' mode routes to discoveryUrl step and skips authorizationUrl/tokenUrl", () => {
    const ref = setup();
    act(() => ref.current!.setIdentityType('OAuthCredentialProvider'));
    act(() => ref.current!.setName('mycred'));
    act(() => ref.current!.setOauthMode('discovery'));
    expect(ref.current!.getStep()).toBe('discoveryUrl');
    expect(ref.current!.getSteps()).toContain('discoveryUrl');
    expect(ref.current!.getSteps()).not.toContain('authorizationUrl');
    expect(ref.current!.getSteps()).not.toContain('tokenUrl');
  });

  it("'manual' mode routes to authorizationUrl step and skips discoveryUrl", () => {
    const ref = setup();
    act(() => ref.current!.setIdentityType('OAuthCredentialProvider'));
    act(() => ref.current!.setName('mycred'));
    act(() => ref.current!.setOauthMode('manual'));
    expect(ref.current!.getStep()).toBe('authorizationUrl');
    expect(ref.current!.getSteps()).toContain('authorizationUrl');
    expect(ref.current!.getSteps()).toContain('tokenUrl');
    expect(ref.current!.getSteps()).not.toContain('discoveryUrl');
  });

  it("'manual' mode collects authorizationUrl + tokenUrl + threads them through to the next step", () => {
    const ref = setup();
    act(() => ref.current!.setIdentityType('OAuthCredentialProvider'));
    act(() => ref.current!.setName('mycred'));
    act(() => ref.current!.setOauthMode('manual'));
    act(() => ref.current!.setAuthorizationUrl('https://accounts.example.com/oauth2/authorize'));
    expect(ref.current!.getStep()).toBe('tokenUrl');
    expect(ref.current!.getConfig().authorizationUrl).toBe('https://accounts.example.com/oauth2/authorize');
    act(() => ref.current!.setTokenUrl('https://accounts.example.com/oauth2/token'));
    expect(ref.current!.getConfig().tokenUrl).toBe('https://accounts.example.com/oauth2/token');
    expect(ref.current!.getStep()).toBe('clientId');
  });

  it('API Key path is unaffected — no oauthMode step', () => {
    const ref = setup();
    act(() => ref.current!.setIdentityType('ApiKeyCredentialProvider'));
    expect(ref.current!.getSteps()).not.toContain('oauthMode');
    expect(ref.current!.getSteps()).not.toContain('authorizationUrl');
    expect(ref.current!.getSteps()).not.toContain('tokenUrl');
  });
});
