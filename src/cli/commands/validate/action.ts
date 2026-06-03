import {
  ConfigIO,
  ConfigNotFoundError,
  ConfigParseError,
  ConfigReadError,
  ConfigValidationError,
  NoProjectError,
  findConfigRoot,
} from '../../../lib';
import type { Result } from '../../../lib/result';
import type { AgentCoreProjectSpec, DeployedState } from '../../../schema';
import { getIdpRedirectUriForTarget } from '../../operations/identity/idp-redirect-uri';

export interface ValidateOptions {
  directory?: string;
  /** When true, also surface 3LO callback-URL informational notes. */
  showNotes?: boolean;
}

export type ValidateResultExtra = {
  /** Informational notes (non-blocking): callback-URL registration reminders. */
  notes?: string[];
} & Record<string, unknown>;

/**
 * Validates all AgentCore schema files in the project.
 * Returns a binary success/fail result with an error message if validation fails.
 */
export async function handleValidate(options: ValidateOptions): Promise<Result<ValidateResultExtra>> {
  const baseDir = options.directory ?? process.cwd();

  // Check if project exists
  const configRoot = findConfigRoot(baseDir);
  if (!configRoot) {
    return {
      success: false,
      error: new NoProjectError(),
    };
  }

  const configIO = new ConfigIO({ baseDir: configRoot });

  let projectSpec: AgentCoreProjectSpec;
  try {
    projectSpec = await configIO.readProjectSpec();
  } catch (err) {
    return { success: false, error: new Error(formatError(err, 'agentcore.json'), { cause: err }) };
  }

  try {
    await configIO.readAWSDeploymentTargets();
  } catch (err) {
    return { success: false, error: new Error(formatError(err, 'aws-targets.json'), { cause: err }) };
  }

  let deployedState: DeployedState | undefined;
  if (configIO.configExists('state')) {
    try {
      deployedState = await configIO.readDeployedState();
    } catch (err) {
      return { success: false, error: new Error(formatError(err, '.cli/state.json'), { cause: err }) };
    }
  }

  const notes = collectThreeLoNotes(projectSpec, deployedState);

  return { success: true, ...(notes.length ? { notes } : {}) };
}

/**
 * Walk 3LO gateway targets and surface informational notes for each one:
 * the IdP redirect URI (callbackUrl) the developer must register with their
 * identity provider.
 *
 * OAuth scopes can be declared on either `target.outboundAuth.scopes` or
 * `credential.scopes` — the deploy/consent paths resolve effective scopes via
 * `resolveEffectiveScopes` (target wins, credential fallback). Either shape is
 * fully supported; no migration is needed.
 */
function collectThreeLoNotes(projectSpec: AgentCoreProjectSpec, deployedState: DeployedState | undefined): string[] {
  const notes: string[] = [];
  const credentialsByName = new Map((projectSpec.credentials ?? []).map(c => [c.name, c]));
  for (const gateway of projectSpec.agentCoreGateways ?? []) {
    for (const target of gateway.targets) {
      const auth = target.outboundAuth;
      if (auth?.type !== 'OAUTH' || !auth.credentialName) continue;
      const cred = credentialsByName.get(auth.credentialName);
      if (cred?.authorizerType !== 'OAuthCredentialProvider') continue;

      if (auth.grantType === 'AUTHORIZATION_CODE') {
        const targets = deployedState?.targets ?? {};
        for (const [deploymentTargetName] of Object.entries(targets)) {
          const callbackUrl = getIdpRedirectUriForTarget(deployedState, deploymentTargetName, auth.credentialName);
          if (callbackUrl) {
            notes.push(
              `[3LO] ${gateway.name}/${target.name} — register this callback URL with your IdP: ${callbackUrl} (target: ${deploymentTargetName})`
            );
          } else {
            notes.push(
              `[3LO] ${gateway.name}/${target.name} — credential "${auth.credentialName}" not yet deployed on target "${deploymentTargetName}"; run \`agentcore deploy\` to provision the callback URL.`
            );
          }
        }
        if (Object.keys(targets).length === 0) {
          notes.push(
            `[3LO] ${gateway.name}/${target.name} — no deployment targets in state yet; run \`agentcore deploy\` to provision the callback URL.`
          );
        }
      }
    }
  }
  return notes;
}

function formatError(err: unknown, fileName: string): string {
  if (err instanceof ConfigValidationError) {
    return err.message;
  }
  if (err instanceof ConfigParseError) {
    return `Invalid JSON in ${fileName}: ${err.cause instanceof Error ? err.cause.message : String(err.cause)}`;
  }
  if (err instanceof ConfigReadError) {
    return `Failed to read ${fileName}: ${err.cause instanceof Error ? err.cause.message : String(err.cause)}`;
  }
  if (err instanceof ConfigNotFoundError) {
    return `Required file not found: ${fileName}`;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
