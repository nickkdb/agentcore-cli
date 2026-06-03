/**
 * Fetch the access status of a 3LO (AUTHORIZATION_CODE) gateway target.
 *
 * Sibling of `fetchOAuthToken` (which handles the inbound 2LO JWT path).
 * For 3LO targets the CLI never sees the raw access token — AgentCore
 * Identity holds it server-side and mints it on demand inside the gateway.
 * This helper instead reports the *status* of the per-user session:
 *
 *   - `fresh`        → the gateway already has a valid token; invoke can proceed
 *   - `inProgress`   → a consent session is currently in progress
 *   - `needsConsent` → the user must complete OAuth; surfaces the
 *                      authorization URL the developer can open
 *   - `failed`       → session failed; start a fresh consent flow
 *
 * Companion fields (callbackUrl, gatewayName, targetName) give callers
 * everything they need to drive `agentcore validate`, `agentcore invoke`,
 * or a custom workflow without re-deriving them.
 *
 * The `--json` flag in the calling command should serialize this struct
 * directly so machine consumers get a stable schema.
 */
import type { AgentCoreGatewayTarget, AgentCoreProjectSpec, DeployedState } from '../../../schema';
import { getCredentialProvider } from '../../aws';
import { getIdpRedirectUriForTarget } from '../identity/idp-redirect-uri';
import { resolveEffectiveScopes } from '../identity/resolve-effective-scopes';
import { type TokenStatus, getTokenStatus } from '../identity/token-status';
import { BedrockAgentCoreClient, GetWorkloadAccessTokenCommand } from '@aws-sdk/client-bedrock-agentcore';

export interface OutboundAccessStatusInput {
  projectSpec: AgentCoreProjectSpec;
  deployedState: DeployedState;
  /** Deployment target name (e.g. "default" / "staging"). */
  deploymentTargetName: string;
  /** Gateway name. */
  gatewayName: string;
  /** Gateway-target name. */
  targetName: string;
  /** Region to call AgentCore Identity in. */
  region: string;
  /** When true, force a new consent session by setting forceAuthentication. */
  forceReauth?: boolean;
}

export interface OutboundAccessStatus {
  /** Pulled from TokenStatus + supplemented with developer-friendly fields. */
  tokenStatus: TokenStatus;
  /** The IdP redirect URI registered with AgentCore Identity (from deployed-state). */
  callbackUrl?: string;
  /** Echoed back so JSON consumers don't need to re-derive. */
  gatewayName: string;
  targetName: string;
  /** OAuth grant type from the project spec; redundant with tokenStatus.status but useful for output. */
  grantType: 'CLIENT_CREDENTIALS' | 'AUTHORIZATION_CODE';
  /** Credential name (so `agentcore validate` and operators can cross-reference). */
  credentialName?: string;
}

export class TargetNotFoundError extends Error {
  constructor(gatewayName: string, targetName: string) {
    super(`Gateway "${gatewayName}" target "${targetName}" not found in project spec.`);
    this.name = 'TargetNotFoundError';
  }
}

export class NotThreeLoTargetError extends Error {
  constructor(
    gatewayName: string,
    targetName: string,
    public readonly grantType: string | undefined
  ) {
    super(
      `Gateway "${gatewayName}" target "${targetName}" is not 3LO ` +
        `(grantType=${grantType ?? 'CLIENT_CREDENTIALS'}). Use \`agentcore fetch access\` ` +
        `without the 3LO branch (or omit --target for the inbound path).`
    );
    this.name = 'NotThreeLoTargetError';
  }
}

export async function fetchOutboundAccessStatus(input: OutboundAccessStatusInput): Promise<OutboundAccessStatus> {
  const { projectSpec, deployedState, gatewayName, targetName } = input;

  const gateway = projectSpec.agentCoreGateways.find(g => g.name === gatewayName);
  if (!gateway) {
    throw new TargetNotFoundError(gatewayName, targetName);
  }
  const target: AgentCoreGatewayTarget | undefined = gateway.targets.find(t => t.name === targetName);
  if (!target) {
    throw new TargetNotFoundError(gatewayName, targetName);
  }

  const auth = target.outboundAuth;
  const grantType = auth?.grantType ?? 'CLIENT_CREDENTIALS';
  if (auth?.type !== 'OAUTH' || grantType !== 'AUTHORIZATION_CODE') {
    throw new NotThreeLoTargetError(gatewayName, targetName, grantType);
  }
  const credentialName = auth.credentialName;

  const credSpec = credentialName
    ? projectSpec.credentials.find(c => c.authorizerType === 'OAuthCredentialProvider' && c.name === credentialName)
    : undefined;

  const callbackUrl =
    credentialName && deployedState
      ? getIdpRedirectUriForTarget(deployedState, input.deploymentTargetName, credentialName)
      : undefined;

  // Resolve the workload identity token. The CLI defers principal resolution
  // to the SDK / GetWorkloadAccessToken — without a workload identity, we
  // can't ask Identity for an oauth2 token at all.
  const credentials = getCredentialProvider();
  const client = new BedrockAgentCoreClient({ region: input.region, credentials });
  const workloadResp = await client.send(
    new GetWorkloadAccessTokenCommand({
      workloadName: 'default',
    })
  );
  const workloadIdentityToken = workloadResp.workloadAccessToken;
  if (!workloadIdentityToken) {
    throw new Error(
      'GetWorkloadAccessToken returned no token. Ensure your AWS credentials are valid and the workload identity is provisioned.'
    );
  }

  const tokenStatus = await getTokenStatus({
    region: input.region,
    workloadIdentityToken,
    resourceCredentialProviderName: credentialName ?? '',
    scopes: resolveEffectiveScopes(
      auth.scopes,
      credSpec?.authorizerType === 'OAuthCredentialProvider' ? credSpec.scopes : undefined
    ),
    oauth2Flow: 'USER_FEDERATION',
    forceAuthentication: input.forceReauth,
  });

  return {
    tokenStatus,
    callbackUrl,
    gatewayName,
    targetName,
    grantType: 'AUTHORIZATION_CODE',
    credentialName,
  };
}
