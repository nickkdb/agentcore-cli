/**
 * Builders and parsers for the MCP `_meta` envelope used by AgentCore Gateway
 * 3LO consent.
 *
 * Two surfaces:
 *
 * 1. **`buildOAuthMeta`** — constructs the `_meta` object that the CLI passes
 *    on `tools/call` to override the credential provider's default behavior
 *    (e.g. `forceAuthentication: true` for `--force-reauth`).
 *
 * 2. **`parseUrlElicitationError`** — detects the JSON-RPC
 *    `URLElicitationRequiredError` (code -32042) the gateway returns when a
 *    3LO target needs consent. The error envelope carries an `elicitations`
 *    array; each entry has `mode: "url"` and a `url` to navigate to.
 *
 * Wire format reference (verbatim from production service code in
 * `AmazonGenesisEndpointDataPlaneTargetAdapters` and the MCP protocol spec
 * `2025-11-25`):
 *
 *   _meta key (slash, not dot):
 *     "aws.bedrock-agentcore.gateway/credentialProviderConfiguration"
 *
 *   nested key (camelCase capital C):
 *     "oauthCredentialProvider"
 *
 *   error code:
 *     -32042 (ErrorCode.UrlElicitationRequired)
 *
 * The SSE / `elicitation/create` request-based mode is **not** supported in
 * v1 — the gateway can return URL elicitations either as a JSON-RPC error
 * (exception mode, what we parse here) or as an SSE event on an open stream
 * (request mode, which requires `streamingConfiguration.enableResponseStreaming`).
 * v1 only handles the exception mode.
 */

const META_KEY_CREDENTIAL_PROVIDER_CONFIGURATION = 'aws.bedrock-agentcore.gateway/credentialProviderConfiguration';
const URL_ELICITATION_REQUIRED_ERROR_CODE = -32042;

// ---------------------------------------------------------------------------
// _meta builder (tasks 2.7, 2.15)
// ---------------------------------------------------------------------------

export interface OAuthMetaInput {
  /**
   * Override the `defaultReturnUrl` configured on the gateway target for this
   * specific tool call (e.g. when the agent runs behind a different public
   * domain than registered). Must be on the workload identity's
   * `AllowedResourceOauth2ReturnUrl` list.
   */
  returnUrl?: string;
  /**
   * When true, always start a fresh 3LO authorization flow, ignoring any
   * existing valid session. Mapped from the `--force-reauth` invoke flag.
   */
  forceAuthentication?: boolean;
}

export interface OAuthMetaEnvelope {
  [META_KEY_CREDENTIAL_PROVIDER_CONFIGURATION]: {
    oauthCredentialProvider: {
      returnUrl?: string;
      forceAuthentication?: boolean;
    };
  };
}

/**
 * Build the `_meta` object for `tools/call`. Returns `undefined` when the
 * input has nothing to set — callers should spread conditionally to avoid
 * overriding the credential provider's defaults.
 */
export function buildOAuthMeta(input: OAuthMetaInput): OAuthMetaEnvelope | undefined {
  const inner: { returnUrl?: string; forceAuthentication?: boolean } = {};
  if (input.returnUrl !== undefined) inner.returnUrl = input.returnUrl;
  if (input.forceAuthentication !== undefined) inner.forceAuthentication = input.forceAuthentication;
  if (Object.keys(inner).length === 0) return undefined;
  return {
    [META_KEY_CREDENTIAL_PROVIDER_CONFIGURATION]: {
      oauthCredentialProvider: inner,
    },
  };
}

// ---------------------------------------------------------------------------
// URLElicitationRequiredError parser (task 2.8)
// ---------------------------------------------------------------------------

export interface ElicitRequestUrlParams {
  mode: 'url';
  elicitationId: string;
  message: string;
  url: string;
}

export interface UrlElicitationRequiredError {
  code: typeof URL_ELICITATION_REQUIRED_ERROR_CODE;
  message: string;
  data: {
    elicitations: ElicitRequestUrlParams[];
  };
}

/**
 * Parse a JSON-RPC error response into a `UrlElicitationRequiredError` if it
 * matches code -32042 with at least one URL-mode elicitation. Returns
 * `undefined` for any other error shape (callers should treat this as
 * "not a URL elicitation").
 *
 * Validates the wire format strictly:
 *   - error.code === -32042
 *   - error.data.elicitations is a non-empty array
 *   - each elicitation has `mode: "url"`, `elicitationId`, `message`, `url`
 *
 * Form-mode elicitations (`mode: "form"`) and SSE request-based mode are
 * intentionally not parsed in v1 — they're explicit out-of-scope items per
 * the resolved decision OQ #6.
 */
export function parseUrlElicitationError(rpcError: unknown): UrlElicitationRequiredError | undefined {
  if (!rpcError || typeof rpcError !== 'object') return undefined;
  const err = rpcError as { code?: unknown; message?: unknown; data?: unknown };
  if (err.code !== URL_ELICITATION_REQUIRED_ERROR_CODE) return undefined;
  if (typeof err.message !== 'string') return undefined;
  if (!err.data || typeof err.data !== 'object') return undefined;
  const data = err.data as { elicitations?: unknown };
  if (!Array.isArray(data.elicitations) || data.elicitations.length === 0) return undefined;

  // The gateway can return a heterogeneous elicitations array (e.g. one
  // form-mode + one url-mode entry) when multiple parallel auths are
  // required. Skip non-url-mode entries instead of aborting the whole
  // parse — the v1 contract only handles url mode but a mixed array
  // shouldn't blow away the url entries we DO know how to handle.
  const parsed: ElicitRequestUrlParams[] = [];
  for (const e of data.elicitations) {
    if (!e || typeof e !== 'object') return undefined;
    const cand = e as { mode?: unknown; elicitationId?: unknown; message?: unknown; url?: unknown };
    if (cand.mode !== 'url') continue;
    if (typeof cand.elicitationId !== 'string' || typeof cand.message !== 'string' || typeof cand.url !== 'string') {
      return undefined;
    }
    // Length caps protect against a misbehaving gateway flooding the
    // terminal / browser-launch argv with multi-megabyte payloads.
    // 8192 chars is generous for any real IdP authorization URL; 4096
    // covers any legitimate elicitation `message` shown to a user.
    const MAX_URL_LEN = 8192;
    const MAX_MESSAGE_LEN = 4096;
    const MAX_ELICITATION_ID_LEN = 256;
    if (
      cand.url.length > MAX_URL_LEN ||
      cand.message.length > MAX_MESSAGE_LEN ||
      cand.elicitationId.length > MAX_ELICITATION_ID_LEN
    ) {
      return undefined;
    }
    // Defense-in-depth: enforce http(s) on the gateway-supplied URL before
    // the consent flow ever opens it. The gateway is in the trust boundary,
    // but matching the scheme allowlist that runHeadlessPasteUrl applies to
    // user-pasted URLs keeps the policy uniform across both code paths.
    // (Round-4 security advisory.)
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(cand.url);
    } catch {
      return undefined;
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return undefined;
    }
    parsed.push({
      mode: 'url',
      elicitationId: cand.elicitationId,
      message: cand.message,
      url: cand.url,
    });
  }
  if (parsed.length === 0) return undefined;

  return {
    code: URL_ELICITATION_REQUIRED_ERROR_CODE,
    message: err.message,
    data: { elicitations: parsed },
  };
}

/**
 * Convenience: parse a JSON-RPC response envelope (with `error` field) and
 * return the URL elicitation if present, else undefined.
 */
export function extractUrlElicitationFromResponse(rpcResponse: unknown): UrlElicitationRequiredError | undefined {
  if (!rpcResponse || typeof rpcResponse !== 'object') return undefined;
  const env = rpcResponse as { error?: unknown };
  return parseUrlElicitationError(env.error);
}

// Constants exposed so tests can assert on them without re-typing.
export const MCP_META = {
  CREDENTIAL_PROVIDER_CONFIGURATION_KEY: META_KEY_CREDENTIAL_PROVIDER_CONFIGURATION,
  OAUTH_CREDENTIAL_PROVIDER_KEY: 'oauthCredentialProvider' as const,
  URL_ELICITATION_REQUIRED_ERROR_CODE,
};
