/**
 * Tests for the 3LO wizard steps in useAddGatewayTargetWizard.
 * Asserts the dynamic-steps array correctly inserts grant-type / three-lo-scopes
 * only when relevant, and the new setters route to the right next step.
 */
import type { AddGatewayTargetStep, GatewayTargetWizardState } from '../types';
import { useAddGatewayTargetWizard } from '../useAddGatewayTargetWizard';
import { Text } from 'ink';
import { render } from 'ink-testing-library';
import React, { act, useImperativeHandle } from 'react';
import { describe, expect, it } from 'vitest';

interface HarnessHandle {
  setName: (name: string) => void;
  setTargetType: (
    t: 'mcpServer' | 'apiGateway' | 'openApiSchema' | 'smithyModel' | 'lambdaFunctionArn' | 'lambda'
  ) => void;
  setEndpoint: (e: string) => void;
  setGateway: (g: string) => void;
  setOutboundAuth: (a: { type: 'OAUTH' | 'API_KEY' | 'NONE'; credentialName?: string }) => void;
  setGrantType: (g: 'CLIENT_CREDENTIALS' | 'AUTHORIZATION_CODE') => void;
  setThreeLoFields: (f: { defaultReturnUrl?: string; customParameters?: Record<string, string> }) => void;
  getStep: () => AddGatewayTargetStep;
  getSteps: () => AddGatewayTargetStep[];
  getConfig: () => GatewayTargetWizardState;
}

function ImpHarness({ handleRef }: { handleRef: React.Ref<HarnessHandle> }) {
  const wizard = useAddGatewayTargetWizard([]);
  useImperativeHandle(handleRef, () => ({
    setName: wizard.setName,
    setTargetType: wizard.setTargetType,
    setEndpoint: wizard.setEndpoint,
    setGateway: wizard.setGateway,
    setOutboundAuth: wizard.setOutboundAuth,
    setGrantType: wizard.setGrantType,
    setThreeLoFields: wizard.setThreeLoFields,
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

describe('useAddGatewayTargetWizard — 3LO steps', () => {
  it('does NOT insert grant-type step when outboundAuth.type is NONE', () => {
    const ref = setup();
    act(() => ref.current!.setName('mytool'));
    act(() => ref.current!.setTargetType('mcpServer'));
    act(() => ref.current!.setEndpoint('https://example.com/mcp'));
    act(() => ref.current!.setGateway('gw1'));
    act(() => ref.current!.setOutboundAuth({ type: 'NONE' }));
    expect(ref.current!.getSteps()).not.toContain('grant-type');
    expect(ref.current!.getStep()).toBe('confirm');
  });

  it('does NOT insert grant-type step when outboundAuth.type is API_KEY', () => {
    const ref = setup();
    act(() => ref.current!.setName('mytool'));
    act(() => ref.current!.setTargetType('mcpServer'));
    act(() => ref.current!.setEndpoint('https://example.com/mcp'));
    act(() => ref.current!.setGateway('gw1'));
    act(() => ref.current!.setOutboundAuth({ type: 'API_KEY', credentialName: 'k1' }));
    expect(ref.current!.getSteps()).not.toContain('grant-type');
    expect(ref.current!.getStep()).toBe('confirm');
  });

  it('inserts grant-type step when outboundAuth.type is OAUTH and lands on it', () => {
    const ref = setup();
    act(() => ref.current!.setName('mytool'));
    act(() => ref.current!.setTargetType('mcpServer'));
    act(() => ref.current!.setEndpoint('https://example.com/mcp'));
    act(() => ref.current!.setGateway('gw1'));
    act(() => ref.current!.setOutboundAuth({ type: 'OAUTH', credentialName: 'cred1' }));
    expect(ref.current!.getSteps()).toContain('grant-type');
    expect(ref.current!.getStep()).toBe('grant-type');
  });

  it('CLIENT_CREDENTIALS skips three-lo-scopes and lands on confirm', () => {
    const ref = setup();
    act(() => ref.current!.setName('mytool'));
    act(() => ref.current!.setTargetType('mcpServer'));
    act(() => ref.current!.setEndpoint('https://example.com/mcp'));
    act(() => ref.current!.setGateway('gw1'));
    act(() => ref.current!.setOutboundAuth({ type: 'OAUTH', credentialName: 'cred1' }));
    act(() => ref.current!.setGrantType('CLIENT_CREDENTIALS'));
    expect(ref.current!.getSteps()).not.toContain('three-lo-scopes');
    expect(ref.current!.getStep()).toBe('confirm');
    expect(ref.current!.getConfig().outboundAuth?.grantType).toBe('CLIENT_CREDENTIALS');
  });

  it('AUTHORIZATION_CODE inserts three-lo-scopes and routes there', () => {
    const ref = setup();
    act(() => ref.current!.setName('mytool'));
    act(() => ref.current!.setTargetType('mcpServer'));
    act(() => ref.current!.setEndpoint('https://example.com/mcp'));
    act(() => ref.current!.setGateway('gw1'));
    act(() => ref.current!.setOutboundAuth({ type: 'OAUTH', credentialName: 'cred1' }));
    act(() => ref.current!.setGrantType('AUTHORIZATION_CODE'));
    expect(ref.current!.getSteps()).toContain('three-lo-scopes');
    expect(ref.current!.getStep()).toBe('three-lo-scopes');
    expect(ref.current!.getConfig().outboundAuth?.grantType).toBe('AUTHORIZATION_CODE');
  });

  it('setThreeLoFields persists defaultReturnUrl and customParameters into outboundAuth', () => {
    const ref = setup();
    act(() => ref.current!.setName('mytool'));
    act(() => ref.current!.setTargetType('mcpServer'));
    act(() => ref.current!.setEndpoint('https://example.com/mcp'));
    act(() => ref.current!.setGateway('gw1'));
    act(() => ref.current!.setOutboundAuth({ type: 'OAUTH', credentialName: 'cred1' }));
    act(() => ref.current!.setGrantType('AUTHORIZATION_CODE'));
    act(() =>
      ref.current!.setThreeLoFields({
        defaultReturnUrl: 'https://app.example.com/oauth/return',
        customParameters: { access_type: 'offline', prompt: 'consent' },
      })
    );
    const auth = ref.current!.getConfig().outboundAuth;
    expect(auth?.defaultReturnUrl).toBe('https://app.example.com/oauth/return');
    expect(auth?.customParameters).toEqual({ access_type: 'offline', prompt: 'consent' });
    expect(ref.current!.getStep()).toBe('confirm');
  });

  it('switching grantType from AUTHORIZATION_CODE back to CLIENT_CREDENTIALS clears 3LO-only fields (R6 MEDIUM)', () => {
    const ref = setup();
    act(() => ref.current!.setName('mytool'));
    act(() => ref.current!.setTargetType('mcpServer'));
    act(() => ref.current!.setEndpoint('https://example.com/mcp'));
    act(() => ref.current!.setGateway('gw1'));
    act(() => ref.current!.setOutboundAuth({ type: 'OAUTH', credentialName: 'cred1' }));
    act(() => ref.current!.setGrantType('AUTHORIZATION_CODE'));
    act(() =>
      ref.current!.setThreeLoFields({
        defaultReturnUrl: 'https://app.example.com/oauth/return',
        customParameters: { access_type: 'offline' },
      })
    );
    // User went back and re-selected CLIENT_CREDENTIALS — the prior 3LO
    // fields must be removed so the schema's superRefine doesn't reject.
    act(() => ref.current!.setGrantType('CLIENT_CREDENTIALS'));
    const auth = ref.current!.getConfig().outboundAuth;
    expect(auth?.grantType).toBe('CLIENT_CREDENTIALS');
    expect(auth?.defaultReturnUrl).toBeUndefined();
    expect(auth?.customParameters).toBeUndefined();
  });

  it('setThreeLoFields with empty defaultReturnUrl omits the field (allow-skip pattern)', () => {
    const ref = setup();
    act(() => ref.current!.setName('mytool'));
    act(() => ref.current!.setTargetType('mcpServer'));
    act(() => ref.current!.setEndpoint('https://example.com/mcp'));
    act(() => ref.current!.setGateway('gw1'));
    act(() => ref.current!.setOutboundAuth({ type: 'OAUTH', credentialName: 'cred1' }));
    act(() => ref.current!.setGrantType('AUTHORIZATION_CODE'));
    act(() => ref.current!.setThreeLoFields({ defaultReturnUrl: '' }));
    const auth = ref.current!.getConfig().outboundAuth;
    expect(auth?.defaultReturnUrl).toBeUndefined();
    expect(auth?.customParameters).toBeUndefined();
  });
});
