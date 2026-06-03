import { ConfigIO } from '../../../lib/index.js';

export async function getGatewayEnvVars(): Promise<Record<string, string>> {
  const configIO = new ConfigIO();
  const envVars: Record<string, string> = {};

  try {
    const deployedState = await configIO.readDeployedState();
    const project = await configIO.readProjectSpec();

    // Iterate all targets (not just 'default')
    for (const [deploymentTargetName, target] of Object.entries(deployedState?.targets ?? {})) {
      const gateways = target?.resources?.mcp?.gateways ?? {};
      const credentials = target?.resources?.credentials ?? {};

      for (const [name, gateway] of Object.entries(gateways)) {
        if (!gateway.gatewayUrl) continue;
        const sanitized = name.toUpperCase().replace(/-/g, '_');
        envVars[`AGENTCORE_GATEWAY_${sanitized}_URL`] = gateway.gatewayUrl;

        const gatewaySpec = project.agentCoreGateways?.find(g => g.name === name);
        const authType = gatewaySpec?.authorizerType ?? 'NONE';
        envVars[`AGENTCORE_GATEWAY_${sanitized}_AUTH_TYPE`] = authType;

        // Phase 3.10 — surface per-3LO-target metadata so the dev
        // container's runtime code can reason about which targets need
        // consent (e.g. AGENTCORE_GATEWAY_<GW>_TARGET_<TGT>_CALLBACK_URL).
        // The actual reconsent flow lives in invokeWithConsentDev — when
        // the dev server's tool call sees -32042, the wrapper runs
        // runConsent inline and retries without restarting. These env
        // vars are read-only metadata for the agent code itself.
        for (const tgt of gatewaySpec?.targets ?? []) {
          const auth = tgt.outboundAuth;
          if (auth?.type !== 'OAUTH' || auth.grantType !== 'AUTHORIZATION_CODE') continue;
          const tgtSanitized = tgt.name.toUpperCase().replace(/-/g, '_');
          const prefix = `AGENTCORE_GATEWAY_${sanitized}_TARGET_${tgtSanitized}`;
          envVars[`${prefix}_GRANT_TYPE`] = 'AUTHORIZATION_CODE';
          if (auth.credentialName) {
            const credState = credentials[auth.credentialName];
            if (credState?.callbackUrl) {
              envVars[`${prefix}_CALLBACK_URL`] = credState.callbackUrl;
            }
          }
        }
        // The deployment-target name lives only on the env shape; if a
        // future caller needs to disambiguate targets across deployment
        // names, the existing AGENTCORE_DEPLOY_TARGET env var (set
        // separately by the dev driver) carries that.
        void deploymentTargetName;
      }
    }
  } catch {
    // No deployed state or project spec issue — skip gateway env vars
  }

  return envVars;
}
