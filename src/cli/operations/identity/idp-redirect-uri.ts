/**
 * Thin facade over the per-credential `callbackUrl` stored in `deployed-state.json`.
 *
 * The IdP redirect URI is the value the customer registers with their identity
 * provider as the OAuth callback. AgentCore Identity returns this value from
 * `CreateOauth2CredentialProvider`'s response (top-level `callbackUrl` field),
 * and the deploy pipeline persists it onto the credential's deployed-state
 * entry. The CLI never constructs this URL itself — it always reads it from
 * state.
 */
import type { DeployedState } from '../../../schema';

/**
 * Resolve the IdP redirect URI for a 3LO gateway target by reading the
 * `callbackUrl` of the credential that backs it from deployed state.
 *
 * Returns `undefined` if the target's deployment target name is not in state,
 * if the credential has not been deployed yet, or if the credential predates
 * the `callbackUrl` field (legacy state files).
 */
export function getIdpRedirectUriForTarget(
  state: DeployedState | undefined,
  deploymentTargetName: string,
  credentialName: string
): string | undefined {
  return state?.targets?.[deploymentTargetName]?.resources?.credentials?.[credentialName]?.callbackUrl;
}

/**
 * Mutate-in-place setter so callers writing to deployed state can persist the
 * `callbackUrl` returned from the SDK in a single canonical location.
 *
 * The caller is responsible for handing the result back to `ConfigIO.writeDeployedState`.
 */
export function setIdpRedirectUriForTarget(
  state: DeployedState,
  deploymentTargetName: string,
  credentialName: string,
  callbackUrl: string
): void {
  const targetState = (state.targets[deploymentTargetName] ??= { resources: {} });
  targetState.resources ??= {};
  targetState.resources.credentials ??= {};
  const cred = targetState.resources.credentials[credentialName];
  if (!cred) {
    throw new Error(
      `Cannot set IdP redirect URI: credential "${credentialName}" has no deployed state on target "${deploymentTargetName}". Deploy the credential first.`
    );
  }
  cred.callbackUrl = callbackUrl;
}
