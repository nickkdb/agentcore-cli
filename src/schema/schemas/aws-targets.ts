import { uniqueBy } from './zod-util';
import { z } from 'zod';

// ============================================================================
// AgentCore Regions
// Keep in sync with: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agentcore-regions.html
// ============================================================================

export const AgentCoreRegionSchema = z.enum([
  'ap-northeast-1',
  'ap-northeast-2',
  'ap-south-1',
  'ap-southeast-1',
  'ap-southeast-2',
  'ca-central-1',
  'eu-central-1',
  'eu-north-1',
  'eu-west-1',
  'eu-west-2',
  'eu-west-3',
  'sa-east-1',
  'us-east-1',
  'us-east-2',
  'us-west-2',
  'us-gov-west-1',
]);
export type AgentCoreRegion = z.infer<typeof AgentCoreRegionSchema>;

// ============================================================================
// Deployment Target Name
// ============================================================================

export const DeploymentTargetNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[a-zA-Z][a-zA-Z0-9-]*$/,
    'Name must start with a letter and contain only alphanumeric characters and hyphens'
  )
  .describe('Unique identifier for the deployment target');

// ============================================================================
// AWS Account ID
// ============================================================================

export const AwsAccountIdSchema = z
  .string()
  .regex(/^[0-9]{12}$/, 'AWS account ID must be exactly 12 digits')
  .describe('AWS account ID');

// ============================================================================
// AWS Deployment Target
// ============================================================================

export const AwsDeploymentTargetSchema = z.object({
  name: DeploymentTargetNameSchema,
  description: z.string().max(256).optional(),
  account: AwsAccountIdSchema,
  region: AgentCoreRegionSchema,
});

export type AwsDeploymentTarget = z.infer<typeof AwsDeploymentTargetSchema>;

// ============================================================================
// AWS Deployment Targets Array
// ============================================================================

export const AwsDeploymentTargetsSchema = z.array(AwsDeploymentTargetSchema).superRefine(
  uniqueBy(
    target => target.name,
    name => `Duplicate deployment target name: ${name}`
  )
);

export type AwsDeploymentTargets = z.infer<typeof AwsDeploymentTargetsSchema>;

// ============================================================================
// Environment Name
// Format mirrors deployment target names but is lower-case only so that env
// names map cleanly to URL-safe / config-key contexts (e.g. `--env dev`).
// ============================================================================

export const EnvironmentNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[a-z][a-z0-9-]*$/,
    'Environment name must start with a lowercase letter and contain only lowercase alphanumeric characters and hyphens'
  )
  .describe('Unique identifier for a deployment environment');

export type EnvironmentName = z.infer<typeof EnvironmentNameSchema>;

// ============================================================================
// Environment Overrides
// In v1, only `envVars` may be overridden per environment. The schema is
// `strict` so unknown override fields are rejected up-front (forward-compat
// fields require an explicit schema bump).
// ============================================================================

export const EnvironmentOverridesSchema = z
  .object({
    envVars: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export type EnvironmentOverrides = z.infer<typeof EnvironmentOverridesSchema>;

// ============================================================================
// Environment
// Maps an environment name to an ordered, non-empty list of target references
// (target names) plus optional in-memory overrides applied at deploy time.
// ============================================================================

export const EnvironmentSchema = z
  .object({
    targets: z.array(DeploymentTargetNameSchema).min(1, 'Environment must reference at least one target'),
    overrides: EnvironmentOverridesSchema.optional(),
  })
  .strict();

export type Environment = z.infer<typeof EnvironmentSchema>;

// ============================================================================
// Environments
// Record keyed by environment name. Cross-validation that each `targets[]`
// entry refers to an existing target in the deployment targets array is added
// in the wrapping schema (see T2).
// ============================================================================

export const EnvironmentsSchema = z.record(EnvironmentNameSchema, EnvironmentSchema);

export type Environments = z.infer<typeof EnvironmentsSchema>;

// ============================================================================
// AWS Targets (object form)
// Backward-compatible object wrapper that pairs the existing targets array
// with an optional `environments` map. The plain-array `AwsDeploymentTargetsSchema`
// remains the authoritative on-disk shape for now; this object form is the
// foundation for T2's cross-validation and future migrations.
// ============================================================================

export const AwsTargetsSchema = z
  .object({
    targets: AwsDeploymentTargetsSchema,
    environments: EnvironmentsSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.environments) return;
    const availableTargets = data.targets.map(t => t.name);
    const availableSet = new Set(availableTargets);
    for (const [envName, env] of Object.entries(data.environments)) {
      env.targets.forEach((targetRef, idx) => {
        if (!availableSet.has(targetRef)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['environments', envName, 'targets', idx],
            message:
              `Environment "${envName}" references unknown target "${targetRef}". ` +
              `Available targets: ${availableTargets.length > 0 ? availableTargets.join(', ') : '(none defined)'}`,
          });
        }
      });
    }
  });

export type AwsTargets = z.infer<typeof AwsTargetsSchema>;
