/**
 * Post-deploy banner for new 3LO gateway targets.
 *
 * Renders after a successful deploy when at least one gateway target has
 * `outboundAuth.grantType: AUTHORIZATION_CODE` AND its credential's
 * `callbackUrl` was just persisted to deployed-state. The banner shows:
 *
 *   - the target & credential names
 *   - the AgentCore-managed callback URL the developer must register with their IdP
 *   - a hint about `agentcore validate` and `agentcore fetch access`
 *
 * The banner is rendered once per deploy that introduces a new 3LO target.
 * On re-deploy of an unchanged 3LO target, no banner appears (the deploy
 * driver compares the previous deployed-state against the new one).
 */
import type { AgentCoreProjectSpec, DeployedState } from '../../../schema';

export interface ThreeLoBannerEntry {
  gatewayName: string;
  targetName: string;
  credentialName: string;
  callbackUrl: string;
  vendor: string;
}

export interface ThreeLoBannerInput {
  projectSpec: AgentCoreProjectSpec;
  /** Current deployed state (read after deploy completes). */
  deployedState: DeployedState;
  /** Deployed state from BEFORE this deploy ran (read at the start of deploy). */
  previousDeployedState?: DeployedState;
  /** Which deployment target name this banner is for (e.g. "default"). */
  deploymentTargetName: string;
}

/**
 * Walk gateway targets and surface 3LO banner entries for credentials whose
 * callbackUrl appeared (or changed) in this deploy.
 *
 * Returns an empty array when there are no 3LO targets, or when none of the
 * 3LO credentials had a callback-URL change relative to `previousDeployedState`.
 */
export function collectThreeLoBannerEntries(input: ThreeLoBannerInput): ThreeLoBannerEntry[] {
  const entries: ThreeLoBannerEntry[] = [];
  const credentialsByName = new Map((input.projectSpec.credentials ?? []).map(c => [c.name, c]));

  const target = input.deployedState.targets?.[input.deploymentTargetName];
  const previousTarget = input.previousDeployedState?.targets?.[input.deploymentTargetName];
  const currentCreds = target?.resources?.credentials ?? {};
  const previousCreds = previousTarget?.resources?.credentials ?? {};

  for (const gateway of input.projectSpec.agentCoreGateways ?? []) {
    for (const tgt of gateway.targets) {
      const auth = tgt.outboundAuth;
      if (auth?.type !== 'OAUTH' || auth.grantType !== 'AUTHORIZATION_CODE' || !auth.credentialName) continue;

      const credSpec = credentialsByName.get(auth.credentialName);
      if (credSpec?.authorizerType !== 'OAuthCredentialProvider') continue;

      const credState = currentCreds[auth.credentialName];
      if (!credState?.callbackUrl) continue;

      const previousCallback = previousCreds[auth.credentialName]?.callbackUrl;
      if (previousCallback === credState.callbackUrl) continue;

      entries.push({
        gatewayName: gateway.name,
        targetName: tgt.name,
        credentialName: auth.credentialName,
        callbackUrl: credState.callbackUrl,
        vendor: credSpec.vendor,
      });
    }
  }

  return entries;
}

/**
 * Render the banner as plain text. Caller is responsible for emitting it
 * to stderr / stdout / a TUI surface.
 */
export function renderThreeLoBanner(entries: ThreeLoBannerEntry[]): string {
  if (entries.length === 0) return '';

  const lines: string[] = [
    '',
    '════════════════════════════════════════════════════════════════════',
    '  3LO (AUTHORIZATION_CODE) targets deployed — IdP registration required',
    '════════════════════════════════════════════════════════════════════',
    '',
    '  Register the following callback URL(s) with your identity provider',
    '  before invoking these targets:',
    '',
  ];

  for (const e of entries) {
    lines.push(`  • ${e.gatewayName}/${e.targetName}  (credential: ${e.credentialName}, vendor: ${e.vendor})`);
    lines.push(`      Callback URL:  ${e.callbackUrl}`);
    lines.push('');
  }

  lines.push(
    '  After registering, run:',
    '    agentcore invoke <agent>                          # opens browser for consent',
    '    agentcore invoke <agent> --no-browser-consent     # paste-back URL fallback',
    '    agentcore fetch access --target <gw>/<tgt> --json # programmatic access',
    '',
    '════════════════════════════════════════════════════════════════════',
    ''
  );

  return lines.join('\n');
}
