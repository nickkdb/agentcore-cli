import type {
  AgentEnvSpec,
  AwsDeploymentTarget,
  Environment,
  EnvironmentOverrides,
  Environments,
} from '../../../schema';

export interface ResolvedEnvironment {
  /** Targets in the order declared by the environment, hydrated from the AWS targets list. */
  targets: AwsDeploymentTarget[];
  /** Overrides defined on the environment (undefined if none). */
  overrides: EnvironmentOverrides | undefined;
}

export interface AwsTargetsInput {
  targets: AwsDeploymentTarget[];
  environments?: Environments;
}

/**
 * Resolve a named environment into its concrete targets + overrides.
 *
 * Throws if the environment is unknown or if the AwsTargets value has no
 * environments map at all. Unknown target refs are not expected here because
 * AwsTargetsSchema's superRefine rejects them at parse time; we still guard
 * defensively in case this is called with hand-built data.
 */
export function resolveEnvironment(name: string, awsTargets: AwsTargetsInput): ResolvedEnvironment {
  const environments = awsTargets.environments;
  if (!environments || Object.keys(environments).length === 0) {
    throw new Error(`No environments are defined in aws-targets.json. Cannot resolve environment "${name}".`);
  }

  const env: Environment | undefined = environments[name];
  if (!env) {
    const available = Object.keys(environments).sort().join(', ');
    throw new Error(`Unknown environment "${name}". Available environments: ${available}`);
  }

  const targetsByName = new Map(awsTargets.targets.map(t => [t.name, t]));
  const resolvedTargets: AwsDeploymentTarget[] = [];
  for (const ref of env.targets) {
    const target = targetsByName.get(ref);
    if (!target) {
      const available = awsTargets.targets.map(t => t.name).join(', ');
      throw new Error(
        `Environment "${name}" references unknown target "${ref}". Available targets: ${available || '(none)'}`
      );
    }
    resolvedTargets.push(target);
  }

  return { targets: resolvedTargets, overrides: env.overrides };
}

/**
 * Shallow-merge environment overrides into an agent config.
 *
 * v1 supports envVars only. The agent's envVars are an array of `{name, value}`
 * pairs; overrides are a `Record<string, string>`. Merge replaces any agent
 * entry whose `name` matches an override key, then appends the remaining
 * override entries. Inputs are never mutated.
 */
export function mergeOverrides(agentConfig: AgentEnvSpec, overrides: EnvironmentOverrides | undefined): AgentEnvSpec {
  if (!overrides?.envVars || Object.keys(overrides.envVars).length === 0) {
    return agentConfig;
  }

  const overrideEnvVars = overrides.envVars;
  const existing = agentConfig.envVars ?? [];
  const overrideNames = new Set(Object.keys(overrideEnvVars));

  const merged: { name: string; value: string }[] = existing.map(entry =>
    overrideNames.has(entry.name) ? { name: entry.name, value: overrideEnvVars[entry.name]! } : { ...entry }
  );

  const existingNames = new Set(existing.map(e => e.name));
  for (const [name, value] of Object.entries(overrideEnvVars)) {
    if (!existingNames.has(name)) {
      merged.push({ name, value });
    }
  }

  return { ...agentConfig, envVars: merged };
}
