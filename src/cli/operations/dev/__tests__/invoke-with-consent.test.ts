/**
 * Tests for the invoke-with-consent wrapper — the driver-level helper that
 * stitches together mcpCallTool, the URL-elicitation parser, and runConsent.
 *
 * Strategy: mock `../../../aws/agentcore` so we control mcpCallTool's behavior
 * (success vs throw McpRpcError), and mock `../identity/consent-flow` so
 * runConsent doesn't actually try to bind a loopback or read stdin.
 */
import { McpRpcError } from '../../../aws/agentcore';
import { invokeWithConsent } from '../invoke-with-consent';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockMcpCallTool, mockRunConsent } = vi.hoisted(() => ({
  mockMcpCallTool: vi.fn(),
  mockRunConsent: vi.fn(),
}));

vi.mock('../../../aws/agentcore', async () => {
  const actual = await vi.importActual<typeof import('../../../aws/agentcore')>('../../../aws/agentcore');
  return {
    ...actual,
    mcpCallTool: mockMcpCallTool,
  };
});

vi.mock('../../identity/consent-flow', async () => {
  const actual = await vi.importActual<typeof import('../../identity/consent-flow')>('../../identity/consent-flow');
  return {
    ...actual,
    runConsent: mockRunConsent,
  };
});

const mcpOptions = { region: 'us-west-2', runtimeArn: 'arn:aws:bedrock-agentcore:us-west-2:1:runtime/r' };

const consentOptions = {
  consentScopeId: 'p1/gw/tgt',
  callbackUrl: 'https://bedrock-agentcore.us-west-2.amazonaws.com/identities/oauth2/callback/abc',
  contextLabel: 'gw/tgt',
};

const elicitationError = new McpRpcError(-32042, 'URL elicitation required', {
  elicitations: [
    {
      mode: 'url',
      elicitationId: 'elic-1',
      message: 'Please complete OAuth consent',
      url: 'https://accounts.example.com/oauth/authorize?client_id=abc',
    },
  ],
});

describe('invokeWithConsent', () => {
  afterEach(() => vi.clearAllMocks());

  it('returns mcpCallTool result on the happy path (no consent needed)', async () => {
    mockMcpCallTool.mockResolvedValueOnce('tool-result');

    const result = await invokeWithConsent(mcpOptions, 'sayHello', { foo: 'bar' }, consentOptions);

    expect(result).toBe('tool-result');
    expect(mockMcpCallTool).toHaveBeenCalledTimes(1);
    expect(mockMcpCallTool).toHaveBeenCalledWith(mcpOptions, 'sayHello', { foo: 'bar' }, undefined);
    expect(mockRunConsent).not.toHaveBeenCalled();
  });

  it('runs consent flow on URLElicitationRequiredError and retries without _meta', async () => {
    mockMcpCallTool.mockRejectedValueOnce(elicitationError).mockResolvedValueOnce('tool-result-after-consent');
    mockRunConsent.mockResolvedValueOnce({ code: 'auth-code', state: 'state-x', strategyUsed: 'browserLoopback' });

    const result = await invokeWithConsent(mcpOptions, 'sayHello', { foo: 'bar' }, consentOptions);

    expect(result).toBe('tool-result-after-consent');
    expect(mockMcpCallTool).toHaveBeenCalledTimes(2);
    // First call: no _meta (forceReauth not set)
    expect(mockMcpCallTool).toHaveBeenNthCalledWith(1, mcpOptions, 'sayHello', { foo: 'bar' }, undefined);
    // Second call (retry after consent): also no _meta
    expect(mockMcpCallTool).toHaveBeenNthCalledWith(2, mcpOptions, 'sayHello', { foo: 'bar' }, undefined);
    expect(mockRunConsent).toHaveBeenCalledTimes(1);
    expect(mockRunConsent).toHaveBeenCalledWith(
      expect.objectContaining({
        authorizationUrl: 'https://accounts.example.com/oauth/authorize?client_id=abc',
        consentScopeId: 'p1/gw/tgt',
        callbackUrl: consentOptions.callbackUrl,
        contextLabel: 'gw/tgt',
        strategy: 'auto',
      })
    );
  });

  it('injects _meta.forceAuthentication=true on first call when forceReauth set', async () => {
    mockMcpCallTool.mockResolvedValueOnce('tool-result');

    await invokeWithConsent(mcpOptions, 'sayHello', {}, { ...consentOptions, forceReauth: true });

    expect(mockMcpCallTool).toHaveBeenCalledTimes(1);
    const metaArg = mockMcpCallTool.mock.calls[0]![3] as Record<string, unknown> | undefined;
    expect(metaArg).toBeDefined();
    const credCfg = metaArg!['aws.bedrock-agentcore.gateway/credentialProviderConfiguration'] as Record<
      string,
      unknown
    >;
    expect(credCfg).toBeDefined();
    const oauthCfg = credCfg.oauthCredentialProvider as Record<string, unknown>;
    expect(oauthCfg.forceAuthentication).toBe(true);
  });

  it('passes returnUrl into _meta when forceReauth + defaultReturnUrl set', async () => {
    mockMcpCallTool.mockResolvedValueOnce('tool-result');

    await invokeWithConsent(
      mcpOptions,
      'sayHello',
      {},
      { ...consentOptions, forceReauth: true, defaultReturnUrl: 'https://app.example.com/cb' }
    );

    const metaArg = mockMcpCallTool.mock.calls[0]![3] as Record<string, unknown> | undefined;
    const oauthCfg = (
      metaArg!['aws.bedrock-agentcore.gateway/credentialProviderConfiguration'] as Record<string, unknown>
    ).oauthCredentialProvider as Record<string, unknown>;
    expect(oauthCfg.returnUrl).toBe('https://app.example.com/cb');
    expect(oauthCfg.forceAuthentication).toBe(true);
  });

  it('passes strategy=headlessPasteUrl when noBrowserConsent is true', async () => {
    mockMcpCallTool.mockRejectedValueOnce(elicitationError).mockResolvedValueOnce('tool-result-after-consent');
    mockRunConsent.mockResolvedValueOnce({ code: 'c', state: 's', strategyUsed: 'headlessPasteUrl' });

    await invokeWithConsent(mcpOptions, 'sayHello', {}, { ...consentOptions, noBrowserConsent: true });

    expect(mockRunConsent).toHaveBeenCalledWith(
      expect.objectContaining({
        strategy: 'headlessPasteUrl',
        silent: true,
      })
    );
  });

  it('calls onConsentComplete hook after consent succeeds', async () => {
    mockMcpCallTool.mockRejectedValueOnce(elicitationError).mockResolvedValueOnce('ok');
    const consentResult = { code: 'c', state: 's', strategyUsed: 'browserLoopback' as const };
    mockRunConsent.mockResolvedValueOnce(consentResult);
    const onConsentComplete = vi.fn();

    await invokeWithConsent(mcpOptions, 'sayHello', {}, { ...consentOptions, onConsentComplete });

    expect(onConsentComplete).toHaveBeenCalledTimes(1);
    expect(onConsentComplete).toHaveBeenCalledWith(consentResult);
  });

  it('rethrows non-McpRpcError errors without running consent', async () => {
    mockMcpCallTool.mockRejectedValueOnce(new Error('network down'));

    await expect(invokeWithConsent(mcpOptions, 'sayHello', {}, consentOptions)).rejects.toThrow('network down');
    expect(mockRunConsent).not.toHaveBeenCalled();
  });

  it('rethrows non-elicitation McpRpcError (e.g. -32603) without running consent', async () => {
    mockMcpCallTool.mockRejectedValueOnce(new McpRpcError(-32603, 'Internal error', undefined));

    await expect(invokeWithConsent(mcpOptions, 'sayHello', {}, consentOptions)).rejects.toThrow('Internal error');
    expect(mockRunConsent).not.toHaveBeenCalled();
  });

  it('does not loop indefinitely if the retry-after-consent also throws elicitation', async () => {
    mockMcpCallTool.mockRejectedValueOnce(elicitationError).mockRejectedValueOnce(elicitationError);
    mockRunConsent.mockResolvedValueOnce({ code: 'c', state: 's', strategyUsed: 'browserLoopback' });

    await expect(invokeWithConsent(mcpOptions, 'sayHello', {}, consentOptions)).rejects.toThrow(
      'URL elicitation required'
    );
    expect(mockMcpCallTool).toHaveBeenCalledTimes(2);
    expect(mockRunConsent).toHaveBeenCalledTimes(1);
  });

  it('appends a redirect_uri_mismatch hint when retry also fails AND gateway/target names are set', async () => {
    mockMcpCallTool.mockRejectedValueOnce(elicitationError).mockRejectedValueOnce(elicitationError);
    mockRunConsent.mockResolvedValueOnce({ code: 'c', state: 's', strategyUsed: 'browserLoopback' });

    await expect(
      invokeWithConsent(
        mcpOptions,
        'sayHello',
        {},
        {
          ...consentOptions,
          gatewayName: 'myGateway',
          targetName: 'myTarget',
        }
      )
    ).rejects.toThrow(/Register this URL with your IdP/);
  });

  it('does NOT append a hint when gatewayName / targetName are missing', async () => {
    mockMcpCallTool.mockRejectedValueOnce(elicitationError).mockRejectedValueOnce(elicitationError);
    mockRunConsent.mockResolvedValueOnce({ code: 'c', state: 's', strategyUsed: 'browserLoopback' });

    let caught: Error | undefined;
    try {
      await invokeWithConsent(mcpOptions, 'sayHello', {}, consentOptions);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeDefined();
    expect(caught!.message).not.toMatch(/Register this URL with your IdP/);
  });
});
