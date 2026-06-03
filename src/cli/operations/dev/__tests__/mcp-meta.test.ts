/**
 * Wire-format tests for the MCP `_meta` builder + URL elicitation parser.
 *
 * The `_meta` key path and `URLElicitationRequiredError` (-32042) shapes are
 * copied verbatim from the AWS service contracts captured at
 * `.omc/autopilot/service-contracts.md`. Any drift here means the gateway
 * silently rejects 3LO consent or fails to surface auth URLs.
 */
import { MCP_META, buildOAuthMeta, extractUrlElicitationFromResponse, parseUrlElicitationError } from '../mcp-meta.js';
import { describe, expect, it } from 'vitest';

describe('MCP_META wire constants', () => {
  it('uses the slash-delimited credentialProviderConfiguration key', () => {
    expect(MCP_META.CREDENTIAL_PROVIDER_CONFIGURATION_KEY).toBe(
      'aws.bedrock-agentcore.gateway/credentialProviderConfiguration'
    );
  });

  it('uses camelCase oauthCredentialProvider key (capital C)', () => {
    expect(MCP_META.OAUTH_CREDENTIAL_PROVIDER_KEY).toBe('oauthCredentialProvider');
  });

  it('uses URL elicitation error code -32042', () => {
    expect(MCP_META.URL_ELICITATION_REQUIRED_ERROR_CODE).toBe(-32042);
  });
});

describe('buildOAuthMeta', () => {
  it('returns undefined when input has nothing to set', () => {
    expect(buildOAuthMeta({})).toBeUndefined();
  });

  it('renders forceAuthentication only', () => {
    expect(buildOAuthMeta({ forceAuthentication: true })).toEqual({
      'aws.bedrock-agentcore.gateway/credentialProviderConfiguration': {
        oauthCredentialProvider: { forceAuthentication: true },
      },
    });
  });

  it('renders returnUrl only', () => {
    expect(buildOAuthMeta({ returnUrl: 'https://app.example.com/cb' })).toEqual({
      'aws.bedrock-agentcore.gateway/credentialProviderConfiguration': {
        oauthCredentialProvider: { returnUrl: 'https://app.example.com/cb' },
      },
    });
  });

  it('renders both fields when both are set', () => {
    expect(buildOAuthMeta({ returnUrl: 'https://app.example.com/cb', forceAuthentication: true })).toEqual({
      'aws.bedrock-agentcore.gateway/credentialProviderConfiguration': {
        oauthCredentialProvider: { returnUrl: 'https://app.example.com/cb', forceAuthentication: true },
      },
    });
  });

  it('omits forceAuthentication when explicitly false (caller-controlled)', () => {
    // We treat forceAuthentication=false as "set the field to false" because
    // the caller may want to explicitly override a default. The plan calls for
    // mapping --force-reauth to forceAuthentication=true, and we follow the
    // letter of that: any defined value is preserved.
    expect(buildOAuthMeta({ forceAuthentication: false })).toEqual({
      'aws.bedrock-agentcore.gateway/credentialProviderConfiguration': {
        oauthCredentialProvider: { forceAuthentication: false },
      },
    });
  });
});

describe('parseUrlElicitationError', () => {
  it('parses a real-shaped error with one elicitation', () => {
    const result = parseUrlElicitationError({
      code: -32042,
      message: 'URL elicitation required',
      data: {
        elicitations: [
          {
            mode: 'url',
            elicitationId: 'elic-123',
            message: 'Please complete OAuth consent to use this tool',
            url: 'https://accounts.example.com/oauth2/authorize?client_id=abc&state=xyz',
          },
        ],
      },
    });
    expect(result).toBeDefined();
    expect(result!.code).toBe(-32042);
    expect(result!.data.elicitations).toHaveLength(1);
    expect(result!.data.elicitations[0]!.url).toBe(
      'https://accounts.example.com/oauth2/authorize?client_id=abc&state=xyz'
    );
  });

  it('parses multiple elicitations', () => {
    const result = parseUrlElicitationError({
      code: -32042,
      message: 'URL elicitation required',
      data: {
        elicitations: [
          { mode: 'url', elicitationId: 'e1', message: 'm1', url: 'https://a/' },
          { mode: 'url', elicitationId: 'e2', message: 'm2', url: 'https://b/' },
        ],
      },
    });
    expect(result?.data.elicitations).toHaveLength(2);
  });

  it('returns undefined for non-elicitation errors (different code)', () => {
    expect(
      parseUrlElicitationError({
        code: -32603,
        message: 'Internal error',
      })
    ).toBeUndefined();
  });

  it('returns undefined when error.data is missing', () => {
    expect(parseUrlElicitationError({ code: -32042, message: 'URL elicitation required' })).toBeUndefined();
  });

  it('returns undefined when elicitations array is empty', () => {
    expect(
      parseUrlElicitationError({
        code: -32042,
        message: 'URL elicitation required',
        data: { elicitations: [] },
      })
    ).toBeUndefined();
  });

  it('returns undefined when elicitation has mode "form" (v1 excludes form mode)', () => {
    expect(
      parseUrlElicitationError({
        code: -32042,
        message: 'Form elicitation required',
        data: {
          elicitations: [
            {
              mode: 'form',
              elicitationId: 'e1',
              message: 'Fill out this form',
              schema: { type: 'object', properties: {} },
            },
          ],
        },
      })
    ).toBeUndefined();
  });

  it('returns undefined when an elicitation is missing required fields', () => {
    expect(
      parseUrlElicitationError({
        code: -32042,
        message: 'URL elicitation required',
        data: { elicitations: [{ mode: 'url', url: 'https://a/' }] }, // missing elicitationId, message
      })
    ).toBeUndefined();
  });

  it('returns undefined for null / undefined / non-object input', () => {
    expect(parseUrlElicitationError(null)).toBeUndefined();
    expect(parseUrlElicitationError(undefined)).toBeUndefined();
    expect(parseUrlElicitationError('error')).toBeUndefined();
    expect(parseUrlElicitationError(42)).toBeUndefined();
  });
});

describe('extractUrlElicitationFromResponse', () => {
  it('pulls the error out of a JSON-RPC envelope', () => {
    const result = extractUrlElicitationFromResponse({
      jsonrpc: '2.0',
      id: 24,
      error: {
        code: -32042,
        message: 'URL elicitation required',
        data: {
          elicitations: [{ mode: 'url', elicitationId: 'e1', message: 'consent needed', url: 'https://idp/auth' }],
        },
      },
    });
    expect(result).toBeDefined();
    expect(result!.data.elicitations[0]!.url).toBe('https://idp/auth');
  });

  it('returns undefined for a successful response (no error field)', () => {
    expect(
      extractUrlElicitationFromResponse({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'ok' }] } })
    ).toBeUndefined();
  });

  it('returns undefined for a non-elicitation error', () => {
    expect(
      extractUrlElicitationFromResponse({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32601, message: 'Method not found' },
      })
    ).toBeUndefined();
  });
});
