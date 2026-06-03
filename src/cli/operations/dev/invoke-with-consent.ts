/**
 * Invoke an MCP tool with 3LO consent handling.
 *
 * Implements the consent-flow driver pattern from the plan
 * (tasks 2.11 + 2.15) over an arbitrary RPC transport:
 *
 *   1. If `forceReauth` is set, inject `_meta.forceAuthentication: true`
 *      on the first call so the gateway demands fresh consent.
 *   2. Catch `McpRpcError`. If it's a URL elicitation (code -32042), run
 *      the consent flow against the supplied authorizationUrl.
 *   3. Retry the tool call WITHOUT `_meta` so the gateway uses the
 *      freshly-minted token from the just-completed consent session.
 *
 * If the second call also throws an elicitation error, surface it — we
 * don't loop indefinitely. If it throws any other error, propagate.
 *
 * Headless behavior is delegated to `runConsent` (auto-detects via
 * `detectHeadless` unless `--no-browser-consent` is set).
 *
 * Transport abstraction: this wrapper takes an `rpcCall` callback so the
 * deployed-invoke (InvokeAgentRuntime / SigV4) and dev-server (raw fetch
 * to localhost) code paths share the same consent semantics. Each
 * caller wires its own transport's `mcpCallTool` (or local equivalent)
 * via the wrapper helpers below.
 */
import type { McpInvokeOptions } from '../../aws/agentcore';
import { McpRpcError, mcpCallTool } from '../../aws/agentcore';
import { type ConsentFlowResult, buildRedirectUriMismatchHint, runConsent } from '../identity/consent-flow';
import { callMcpTool as callDevMcpTool } from './invoke-mcp';
import { buildOAuthMeta, extractUrlElicitationFromResponse } from './mcp-meta';

/** Transport-agnostic RPC callable. Throws McpRpcError on JSON-RPC error. */
export type RpcCall = (
  toolName: string,
  args: Record<string, unknown>,
  meta: Record<string, unknown> | undefined
) => Promise<string>;

export interface InvokeWithConsentOptions {
  /** Stable identifier used for the consent file lock — usually `<projectIdentifier>/<gatewayName>`. */
  consentScopeId: string;
  /** When true, inject `_meta.forceAuthentication: true` on the first call. Maps to `agentcore invoke --force-reauth`. */
  forceReauth?: boolean;
  /** When true, force the headless paste-URL strategy. Maps to `agentcore invoke --no-browser-consent` (and `agentcore dev --no-browser-consent`). */
  noBrowserConsent?: boolean;
  /** IdP redirect URI (callbackUrl from deployed-state) shown alongside the consent URL for user reassurance / mismatch debugging. */
  callbackUrl?: string;
  /** Default return URL passed to the gateway in `_meta.returnUrl` when forceReauth is set. */
  defaultReturnUrl?: string;
  /** Human-readable label like "myGateway/myTarget" — surfaced to the user during consent. */
  contextLabel?: string;
  /**
   * Gateway / target names used to format a `redirect_uri_mismatch` recovery
   * hint when the post-consent retry also fires an elicitation error. Optional:
   * if either is missing, the hint is skipped and the raw error propagates.
   */
  gatewayName?: string;
  targetName?: string;
  /** Hook to record consent completion — typically `recordConsent` from session-pointer.ts. */
  onConsentComplete?: (result: ConsentFlowResult) => void | Promise<void>;
}

/** Core consent-driver loop, transport-agnostic. */
export async function invokeWithConsentRpc(
  rpcCall: RpcCall,
  toolName: string,
  args: Record<string, unknown>,
  consentOptions: InvokeWithConsentOptions
): Promise<string> {
  const initialMeta: Record<string, unknown> | undefined = consentOptions.forceReauth
    ? (buildOAuthMeta({
        forceAuthentication: true,
        returnUrl: consentOptions.defaultReturnUrl,
      }) as Record<string, unknown> | undefined)
    : undefined;

  try {
    return await rpcCall(toolName, args, initialMeta);
  } catch (err) {
    if (!(err instanceof McpRpcError)) throw err;

    const elicitation = extractUrlElicitationFromResponse({
      error: { code: err.code, message: err.message, data: err.data },
    });
    if (!elicitation) throw err;

    const first = elicitation.data.elicitations[0];
    if (!first) throw err;

    const consentResult = await runConsent({
      authorizationUrl: first.url,
      consentScopeId: consentOptions.consentScopeId,
      callbackUrl: consentOptions.callbackUrl,
      contextLabel: consentOptions.contextLabel,
      strategy: consentOptions.noBrowserConsent ? 'headlessPasteUrl' : 'auto',
      silent: consentOptions.noBrowserConsent,
    });

    if (consentOptions.onConsentComplete) {
      await consentOptions.onConsentComplete(consentResult);
    }

    // Retry once WITHOUT `_meta` — the gateway now has fresh consent and
    // the next tools/call should mint the token from the cached session.
    // If THIS call also throws an elicitation error, the most likely cause
    // is `redirect_uri_mismatch` — the gateway minted an authorization URL
    // pointing at a callback the IdP doesn't recognize. Wrap the error
    // with a recovery hint that names the callback URL and the action the
    // developer needs to take. Don't loop.
    try {
      return await rpcCall(toolName, args, undefined);
    } catch (retryErr) {
      if (
        retryErr instanceof McpRpcError &&
        consentOptions.callbackUrl &&
        consentOptions.gatewayName &&
        consentOptions.targetName
      ) {
        const retryElicitation = extractUrlElicitationFromResponse({
          error: { code: retryErr.code, message: retryErr.message, data: retryErr.data },
        });
        if (retryElicitation) {
          const hint = buildRedirectUriMismatchHint({
            callbackUrl: consentOptions.callbackUrl,
            gatewayName: consentOptions.gatewayName,
            targetName: consentOptions.targetName,
          });
          throw new Error(`${retryErr.message}\n\n${hint}`, { cause: retryErr });
        }
      }
      throw retryErr;
    }
  }
}

/**
 * Deployed-path wrapper: call mcpCallTool (InvokeAgentRuntime / SigV4)
 * with consent handling.
 */
export async function invokeWithConsent(
  mcpOptions: McpInvokeOptions,
  toolName: string,
  args: Record<string, unknown>,
  consentOptions: InvokeWithConsentOptions
): Promise<string> {
  const rpcCall: RpcCall = (name, callArgs, meta) => mcpCallTool(mcpOptions, name, callArgs, meta);
  return invokeWithConsentRpc(rpcCall, toolName, args, consentOptions);
}

/**
 * Dev-server wrapper: call the local fetch-based callMcpTool with
 * consent handling. Used by `agentcore dev` for 3LO targets the dev
 * server proxies to via a Gateway. (Phase 3.8 / 3.9.)
 */
export interface DevInvokeOptions {
  port: number;
  sessionId?: string;
  customHeaders?: Record<string, string>;
}

export async function invokeWithConsentDev(
  devOptions: DevInvokeOptions,
  toolName: string,
  args: Record<string, unknown>,
  consentOptions: InvokeWithConsentOptions
): Promise<string> {
  const rpcCall: RpcCall = (name, callArgs, meta) => {
    // The dev path's callMcpTool doesn't yet accept a `meta` argument —
    // when forceReauth is set, fold meta into the args envelope so the
    // gateway proxied behind the dev server still sees `_meta` on the
    // tools/call params. The args spread is structural; if a caller
    // already supplied an `_meta` key it is preserved by spread order.
    const argsWithMeta = meta ? { ...callArgs, _meta: meta } : callArgs;
    return callDevMcpTool(
      devOptions.port,
      name,
      argsWithMeta,
      devOptions.sessionId,
      undefined,
      devOptions.customHeaders
    );
  };
  return invokeWithConsentRpc(rpcCall, toolName, args, consentOptions);
}
