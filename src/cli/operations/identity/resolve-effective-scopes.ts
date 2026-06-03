import type { AgentCoreProjectSpec } from '../../../schema';

/**
 * Resolve the effective OAuth scopes for a target's outbound auth.
 *
 * Both `target.outboundAuth.scopes` and the referenced credential's `scopes`
 * field are optional in the schema. The user can declare scopes at either
 * location. Resolution order:
 *
 *   1. `target.outboundAuth.scopes` — when present and non-empty, wins.
 *   2. `credential.scopes` — fallback for the referenced credential.
 *   3. `[]` — no scopes; the IdP applies its own defaults.
 *
 * This precedence matches the doc-comment on `OutboundAuthSchema.scopes`
 * ("Target-level scopes take precedence over credential-level scopes.")
 * and is the single source of truth for the deploy and consent paths.
 */
export function resolveEffectiveScopes(
  targetScopes: readonly string[] | undefined,
  credentialScopes: readonly string[] | undefined
): string[] {
  if (targetScopes && targetScopes.length > 0) return [...targetScopes];
  if (credentialScopes && credentialScopes.length > 0) return [...credentialScopes];
  return [];
}

/**
 * Build a `credentialName -> scopes` lookup table from a project spec.
 * Convenience for callers that need to resolve scopes across multiple targets.
 */
export function buildCredentialScopesIndex(spec: Pick<AgentCoreProjectSpec, 'credentials'>): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const cred of spec.credentials ?? []) {
    if (cred.authorizerType === 'OAuthCredentialProvider' && cred.scopes && cred.scopes.length > 0) {
      index.set(cred.name, [...cred.scopes]);
    }
  }
  return index;
}
