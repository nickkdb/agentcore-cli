import { ConfigIO } from '../../../lib';
import { fetchGatewayToken, fetchRuntimeToken, listGateways } from '../../operations/fetch-access';
import type { OAuthTokenResult, TokenFetchResult } from '../../operations/fetch-access';
import {
  NotThreeLoTargetError,
  type OutboundAccessStatus,
  TargetNotFoundError,
  fetchOutboundAccessStatus,
} from '../../operations/fetch-access/outbound-3lo-status';
import type { FetchAccessOptions } from './types';

export interface FetchAccessResult {
  success: boolean;
  result?: TokenFetchResult;
  availableGateways?: { name: string; authType: string }[];
  /** 3LO outbound status when --target-name was used; mutually exclusive with `result`. */
  outbound3lo?: OutboundAccessStatus;
  error?: string;
}

export async function handleFetchAccess(options: FetchAccessOptions): Promise<FetchAccessResult> {
  const resourceType = options.type ?? 'gateway';

  if (resourceType === 'agent') {
    return handleFetchAgentAccess(options);
  }

  // --target-name routes to the 3LO outbound-status helper. The classic
  // gateway-token path keeps its existing inbound-JWT behavior when
  // --target-name is omitted, so customers using `agentcore fetch access
  // --name <gw>` see byte-identical output as before.
  if (options.targetName) {
    return handleFetchOutboundStatus(options);
  }

  return handleFetchGatewayAccess(options);
}

async function handleFetchGatewayAccess(options: FetchAccessOptions): Promise<FetchAccessResult> {
  if (!options.name) {
    const gateways = await listGateways({ deployTarget: options.target });
    if (gateways.length === 0) {
      return { success: false, error: 'No deployed gateways found. Run `agentcore deploy` first.' };
    }
    return {
      success: false,
      error: 'Missing required option: --name',
      availableGateways: gateways,
    };
  }

  const result = await fetchGatewayToken(options.name, {
    deployTarget: options.target,
    identityName: options.identityName,
  });
  return { success: true, result };
}

async function handleFetchOutboundStatus(options: FetchAccessOptions): Promise<FetchAccessResult> {
  if (!options.name) {
    return { success: false, error: 'Missing required option: --name <gateway>' };
  }
  if (!options.targetName) {
    return { success: false, error: 'Missing required option: --target-name <gateway-target>' };
  }
  const configIO = new ConfigIO();
  const projectSpec = await configIO.readProjectSpec();
  const deployedState = await configIO.readDeployedState().catch(() => undefined);
  if (!deployedState) {
    return {
      success: false,
      error: 'No deployed state found. Run `agentcore deploy` to provision the gateway target before fetching access.',
    };
  }
  const awsTargets = await configIO.readAWSDeploymentTargets();
  const targetNames = Object.keys(deployedState.targets ?? {});
  if (targetNames.length === 0) {
    return {
      success: false,
      error: 'No deployed targets found in state. Run `agentcore deploy` to provision the gateway target first.',
    };
  }
  const deploymentTargetName = options.target ?? targetNames[0]!;
  if (!deployedState.targets[deploymentTargetName]) {
    return {
      success: false,
      error: `Deployment target '${deploymentTargetName}' not found. Available: ${targetNames.join(', ')}`,
    };
  }
  const region = awsTargets.find(t => t.name === deploymentTargetName)?.region ?? process.env.AWS_REGION ?? 'us-east-1';

  try {
    const status = await fetchOutboundAccessStatus({
      projectSpec,
      deployedState,
      deploymentTargetName,
      gatewayName: options.name,
      targetName: options.targetName,
      region,
      forceReauth: options.forceReauth,
    });
    return { success: true, outbound3lo: status };
  } catch (err) {
    if (err instanceof TargetNotFoundError || err instanceof NotThreeLoTargetError) {
      return { success: false, error: err.message };
    }
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function handleFetchAgentAccess(options: FetchAccessOptions): Promise<FetchAccessResult> {
  if (!options.name) {
    return { success: false, error: 'Missing required option: --name <agent>' };
  }

  let tokenResult: OAuthTokenResult;
  try {
    tokenResult = await fetchRuntimeToken(options.name, {
      deployTarget: options.target,
      identityName: options.identityName,
    });
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }

  return {
    success: true,
    result: {
      url: '',
      authType: 'CUSTOM_JWT',
      token: tokenResult.token,
      expiresIn: tokenResult.expiresIn,
    },
  };
}
