/**
 * AgentCore Identity token-status SDK wrapper.
 *
 * Wraps `GetResourceOauth2Token` from `@aws-sdk/client-bedrock-agentcore`
 * (the runtime data plane, not the control plane) to give callers a
 * single point that returns one of three discriminated states:
 *
 *   - `'fresh'`        — `accessToken` is populated, ready to use
 *   - `'needsConsent'` — `authorizationUrl` populated; user must complete consent
 *   - `'failed'`       — `sessionStatus === 'FAILED'`; start a fresh flow
 *
 * The CLI doesn't read the `accessToken` itself for 3LO — the gateway
 * server-side handles that. The CLI's job is to:
 *
 *   1. Check whether there's an existing valid token before invoke (fast path)
 *   2. Drive consent when not (drives consent-flow.ts)
 *   3. Re-issue the gateway tools/call after consent succeeds
 *
 * This module is the thin SDK wrapper for step (1).
 */
import { getCredentialProvider } from '../../aws';
import { BedrockAgentCoreClient, GetResourceOauth2TokenCommand } from '@aws-sdk/client-bedrock-agentcore';

/**
 * For 3LO targets the gateway holds the token server-side; the CLI never
 * needs the raw access token. We intentionally drop `accessToken` from the
 * `'fresh'` discriminant so a future caller can't `JSON.stringify(status)`
 * into telemetry / logs / error envelopes by accident.
 *
 * If a 2LO caller genuinely needs the token, expose a separate helper that
 * returns it explicitly rather than widening this type.
 */
export type TokenStatus =
  | { status: 'fresh' }
  | { status: 'inProgress'; authorizationUrl?: string; sessionUri?: string }
  | { status: 'needsConsent'; authorizationUrl: string; sessionUri?: string }
  | { status: 'failed'; reason: string };

export interface TokenStatusInput {
  /** AWS region for the AgentCore data-plane client. */
  region: string;
  /** Workload identity JWT — required by GetResourceOauth2Token. */
  workloadIdentityToken: string;
  /** Credential provider name (matches the `name` set when creating the OAuth provider). */
  resourceCredentialProviderName: string;
  /** Scopes to request. For 3LO, these must be a subset of what the IdP allows. */
  scopes: string[];
  /** When set, override the workload identity's default redirect URI. */
  resourceOauth2ReturnUrl?: string;
  /** When true, always start fresh 3LO consent (mapped from `--force-reauth`). */
  forceAuthentication?: boolean;
  /** Existing session URI (returned by a prior `needsConsent` response) to resume. */
  sessionUri?: string;
  /**
   * OAuth flow type. Default `USER_FEDERATION` for 3LO. The SDK currently
   * only models `M2M` and `USER_FEDERATION`; `ON_BEHALF_OF_TOKEN_EXCHANGE`
   * (RFC 8693 server-side OBO) is explicitly out of v1 scope.
   */
  oauth2Flow?: 'USER_FEDERATION' | 'M2M';
}

/**
 * Fetch the token status for a 3LO credential.
 *
 * Returns a discriminated `TokenStatus` so callers branch on the result
 * rather than digging through SDK response fields.
 */
export async function getTokenStatus(input: TokenStatusInput): Promise<TokenStatus> {
  const credentials = getCredentialProvider();
  const client = new BedrockAgentCoreClient({ region: input.region, credentials });

  const command = new GetResourceOauth2TokenCommand({
    workloadIdentityToken: input.workloadIdentityToken,
    resourceCredentialProviderName: input.resourceCredentialProviderName,
    scopes: input.scopes,
    oauth2Flow: input.oauth2Flow ?? 'USER_FEDERATION',
    ...(input.resourceOauth2ReturnUrl ? { resourceOauth2ReturnUrl: input.resourceOauth2ReturnUrl } : {}),
    ...(input.forceAuthentication ? { forceAuthentication: input.forceAuthentication } : {}),
    ...(input.sessionUri ? { sessionUri: input.sessionUri } : {}),
  });

  const response = await client.send(command);

  if (response.accessToken) {
    // Token is ready server-side. Intentionally drop it from the public type
    // so a future caller can't `JSON.stringify(status)` into telemetry / logs.
    return { status: 'fresh' };
  }
  if (response.sessionStatus === 'FAILED') {
    return { status: 'failed', reason: 'Authorization session failed; start a fresh consent flow.' };
  }
  // Check IN_PROGRESS *before* authorizationUrl: the SDK can return both
  // simultaneously during an active session that's surfacing a fresh URL.
  // The richer `inProgress` discriminant wins so callers know to poll rather
  // than treating it as a brand-new consent request.
  if (response.sessionStatus === 'IN_PROGRESS') {
    return {
      status: 'inProgress',
      ...(response.authorizationUrl ? { authorizationUrl: response.authorizationUrl } : {}),
      ...(response.sessionUri ? { sessionUri: response.sessionUri } : {}),
    };
  }
  if (response.authorizationUrl) {
    return {
      status: 'needsConsent',
      authorizationUrl: response.authorizationUrl,
      ...(response.sessionUri ? { sessionUri: response.sessionUri } : {}),
    };
  }
  return {
    status: 'failed',
    reason: 'Unrecognized token-status response (no accessToken, authorizationUrl, or FAILED status)',
  };
}
