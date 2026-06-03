/**
 * AgentCore Project Schema - Resource-centric model
 *
 * Flat resource model where agents, memories, and credentials are top-level.
 * All resources within a project implicitly have access to each other.
 *
 * @module agentcore-project
 */
import { isReservedProjectName } from '../constants';
import { AgentEnvSpecSchema } from './agent-env';
import { AgentCoreGatewaySchema, AgentCoreGatewayTargetSchema, AgentCoreMcpRuntimeToolSchema } from './mcp';
import { ABTestSchema } from './primitives/ab-test';
import { ConfigBundleSchema } from './primitives/config-bundle';
import { DatasetSchema } from './primitives/dataset';
import {
  EvaluationLevelSchema,
  EvaluatorConfigSchema,
  EvaluatorNameSchema,
  KmsKeyArnSchema,
} from './primitives/evaluator';
import { HarnessNameSchema } from './primitives/harness';
import { HttpGatewaySchema } from './primitives/http-gateway';
import {
  DEFAULT_EPISODIC_REFLECTION_NAMESPACES,
  DEFAULT_EPISODIC_REFLECTION_NAMESPACE_TEMPLATES,
  DEFAULT_STRATEGY_NAMESPACES,
  DEFAULT_STRATEGY_NAMESPACE_TEMPLATES,
  MemoryStrategySchema,
  MemoryStrategyTypeSchema,
} from './primitives/memory';
import { OnlineEvalConfigSchema } from './primitives/online-eval-config';
import { PolicyEngineSchema } from './primitives/policy';
import { TagsSchema } from './primitives/tags';
import { uniqueBy } from './zod-util';
import { z } from 'zod';

// Re-export for convenience
export {
  DEFAULT_EPISODIC_REFLECTION_NAMESPACE_TEMPLATES,
  DEFAULT_EPISODIC_REFLECTION_NAMESPACES,
  DEFAULT_STRATEGY_NAMESPACE_TEMPLATES,
  DEFAULT_STRATEGY_NAMESPACES,
  MemoryStrategySchema,
  MemoryStrategyTypeSchema,
};
export { EvaluationLevelSchema };
export type { MemoryStrategy, MemoryStrategyType } from './primitives/memory';
export type { OnlineEvalConfig } from './primitives/online-eval-config';
export { OnlineEvalConfigSchema, OnlineEvalConfigNameSchema } from './primitives/online-eval-config';
export type {
  CodeBasedConfig,
  EvaluationLevel,
  EvaluatorConfig,
  ExternalCodeBasedConfig,
  LlmAsAJudgeConfig,
  ManagedCodeBasedConfig,
  RatingScale,
} from './primitives/evaluator';
export {
  BedrockModelIdSchema,
  isValidBedrockModelId,
  EvaluatorNameSchema,
  KMS_KEY_ARN_PATTERN,
  isValidKmsKeyArn,
} from './primitives/evaluator';
export { ConfigBundleSchema };
export type { ComponentConfiguration, ComponentConfigurationMap, ConfigBundle } from './primitives/config-bundle';
export { ConfigBundleNameSchema, ComponentConfigurationMapSchema } from './primitives/config-bundle';
export { PolicyEngineSchema };
export type { Policy, PolicyEngine, ValidationMode } from './primitives/policy';
export { PolicyEngineNameSchema, PolicyNameSchema, PolicySchema, ValidationModeSchema } from './primitives/policy';
export { TagsSchema };
export type { Tags } from './primitives/tags';
export { DatasetSchema };
export { DatasetNameSchema, DatasetSchemaTypeSchema } from './primitives/dataset';
export type { Dataset, DatasetSchemaType } from './primitives/dataset';
export type { ABTestMode, TargetRef, GatewayFilter, PerVariantOnlineEvaluationConfig } from './primitives/ab-test';
export { ABTestModeSchema, TargetRefSchema, GatewayFilterSchema } from './primitives/ab-test';
export type { HttpGatewayTarget } from './primitives/http-gateway';
export { HttpGatewayTargetSchema } from './primitives/http-gateway';
export type {
  HarnessGatewayOutboundAuth,
  HarnessMemoryRef,
  HarnessModel,
  HarnessSpec,
  HarnessModelProvider,
} from './primitives/harness';
export {
  GatewayOAuthGrantTypeSchema,
  HarnessGatewayOutboundAuthSchema,
  HarnessNameSchema,
  HarnessSpecSchema,
  HarnessToolTypeSchema,
  HarnessModelProviderSchema,
} from './primitives/harness';

// ============================================================================
// ManagedBy Schema
// ============================================================================

export const ManagedBySchema = z.enum(['CDK']).default('CDK');
export type ManagedBy = z.infer<typeof ManagedBySchema>;

// Re-export MCP types (now part of unified schema)
export type { AgentCoreGateway, AgentCoreGatewayTarget, AgentCoreMcpRuntimeTool } from './mcp';
export { AgentCoreGatewaySchema, AgentCoreGatewayTargetSchema, AgentCoreMcpRuntimeToolSchema } from './mcp';

// ============================================================================
// Project Name Schema
// ============================================================================

// Project name is a CLI-only concept (combined with agent name to form the runtime name).
// Max 23 so that projectName + "_" + agentName fits within the 48-char runtime name limit.
export const ProjectNameSchema = z
  .string()
  .min(1, 'Project name is required')
  .max(23, 'Project name must be 23 characters or less')
  .regex(
    /^[A-Za-z][A-Za-z0-9]{0,22}$/,
    'Project name must start with a letter and contain only alphanumeric characters'
  )
  .refine(name => !isReservedProjectName(name), {
    message: 'This name conflicts with a reserved package dependency. Please choose a different name.',
  });

// ============================================================================
// Memory Schema
// ============================================================================

export const MemoryTypeSchema = z.literal('AgentCoreMemory');
export type MemoryType = z.infer<typeof MemoryTypeSchema>;

// Memory names follow the same constraints as agent runtime names.
// https://docs.aws.amazon.com/bedrock-agentcore-control/latest/APIReference/API_CreateMemory.html
export const MemoryNameSchema = z
  .string()
  .min(1, 'Name is required')
  .max(48)
  .regex(
    /^[a-zA-Z][a-zA-Z0-9_]{0,47}$/,
    'Must begin with a letter and contain only alphanumeric characters and underscores (max 48 chars)'
  );

export const StreamContentLevelSchema = z.enum(['FULL_CONTENT', 'METADATA_ONLY']);
export type StreamContentLevel = z.infer<typeof StreamContentLevelSchema>;

// TODO: kinesis is currently the only supported delivery type. When additional types
// (e.g. S3, EventBridge) are added, this should become a discriminated union.
// Non-kinesis resources will produce a Zod error about the missing kinesis field.
export const StreamDeliveryResourcesSchema = z.object({
  resources: z
    .array(
      z.object({
        kinesis: z.object({
          dataStreamArn: z.string().min(1),
          contentConfigurations: z
            .array(
              z.object({
                type: z.literal('MEMORY_RECORDS'),
                level: StreamContentLevelSchema,
              })
            )
            .min(1),
        }),
      })
    )
    .min(1),
});

export type StreamDeliveryResources = z.infer<typeof StreamDeliveryResourcesSchema>;

export const IndexedKeyTypeSchema = z.enum(['STRING', 'STRINGLIST', 'NUMBER']);
export type IndexedKeyType = z.infer<typeof IndexedKeyTypeSchema>;

/**
 * Indexed metadata key declaration on a Memory.
 * Indexed keys enable filtering memory records on retrieval by attached metadata.
 *
 * Key pattern matches the AgentCore Control API: alphanumeric characters, whitespace,
 * and the symbols `. _ : / = + @ -` (max 128 chars).
 *
 * Note: indexed keys are append-only on the AWS service side — once added to a Memory,
 * a key cannot be removed. Reducing the array on update will fail at deploy time.
 */
export const INDEXED_KEY_NAME_PATTERN = /^[a-zA-Z0-9\s._:/=+@-]+$/;
export const INDEXED_KEY_NAME_PATTERN_MESSAGE =
  'Must contain only alphanumeric characters, whitespace, or the symbols . _ : / = + @ -';
export const MAX_INDEXED_KEY_NAME_LENGTH = 128;
export const MAX_INDEXED_KEYS = 10;

export const IndexedKeySchema = z.object({
  key: z
    .string()
    .min(1)
    .max(MAX_INDEXED_KEY_NAME_LENGTH)
    .regex(INDEXED_KEY_NAME_PATTERN, INDEXED_KEY_NAME_PATTERN_MESSAGE)
    .refine(s => s.trim().length > 0, 'Key cannot be only whitespace'),
  type: IndexedKeyTypeSchema,
});
export type IndexedKey = z.infer<typeof IndexedKeySchema>;

export const MemorySchema = z
  .object({
    name: MemoryNameSchema,
    eventExpiryDuration: z.number().int().min(3).max(365),
    // Strategies array can be empty for short-term memory (just base memory with expiration)
    // Long-term memory includes strategies like SEMANTIC, SUMMARIZATION, USER_PREFERENCE
    strategies: z
      .array(MemoryStrategySchema)
      .default([])
      .superRefine(
        uniqueBy(
          strategy => strategy.type,
          type => `Duplicate memory strategy type: ${type}`
        )
      ),
    indexedKeys: z
      .array(IndexedKeySchema)
      .max(MAX_INDEXED_KEYS)
      .superRefine(
        uniqueBy(
          entry => entry.key,
          key => `Duplicate indexed key: ${key}`
        )
      )
      .optional(),
    tags: TagsSchema.optional(),
    encryptionKeyArn: z.string().optional(),
    executionRoleArn: z.string().optional(),
    streamDeliveryResources: StreamDeliveryResourcesSchema.optional(),
  })
  .superRefine((memory, ctx) => {
    // Indexed keys filter long-term memory records on retrieval; they have no
    // meaning on a short-term-only memory (no strategies => no LTM records).
    if (memory.indexedKeys && memory.indexedKeys.length > 0 && memory.strategies.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['indexedKeys'],
        message: 'indexedKeys requires at least one memory strategy (long-term memory)',
      });
    }
  });

export type Memory = z.infer<typeof MemorySchema>;

// ============================================================================
// Credential Schema
// ============================================================================

// https://docs.aws.amazon.com/bedrock-agentcore-control/latest/APIReference/API_CreateApiKeyCredentialProvider.html
export const CredentialNameSchema = z
  .string()
  .min(1, 'Credential name is required')
  .max(128, 'Credential name must be 128 characters or less')
  .regex(/^[a-zA-Z0-9\-_]+$/, 'Must contain only alphanumeric characters, hyphens, and underscores (1-128 chars)');

export const CredentialTypeSchema = z.enum(['ApiKeyCredentialProvider', 'OAuthCredentialProvider']);
export type CredentialType = z.infer<typeof CredentialTypeSchema>;

export const ApiKeyCredentialSchema = z.object({
  authorizerType: z.literal('ApiKeyCredentialProvider'),
  name: CredentialNameSchema,
});

export type ApiKeyCredential = z.infer<typeof ApiKeyCredentialSchema>;

export const OAuthCredentialSchema = z.object({
  authorizerType: z.literal('OAuthCredentialProvider'),
  name: CredentialNameSchema,
  /** OIDC discovery URL for the OAuth provider (optional for imported providers that already exist in Identity service) */
  discoveryUrl: z.string().url().optional(),
  /**
   * Authorization endpoint URL. For `CustomOauth2` vendors that don't expose an
   * OIDC discovery document, this is required when the credential backs a 3LO
   * (`AUTHORIZATION_CODE`) gateway target.
   */
  authorizationUrl: z.string().url().optional(),
  /**
   * Token endpoint URL. Companion to `authorizationUrl` for `CustomOauth2`
   * vendors without an OIDC discovery document, required when the credential
   * backs a 3LO target.
   */
  tokenUrl: z.string().url().optional(),
  /** Scopes this credential provider supports */
  scopes: z.array(z.string()).optional(),
  /** Credential provider vendor type */
  vendor: z.string().default('CustomOauth2'),
  /** Whether this credential was auto-created by the CLI (e.g., for CUSTOM_JWT inbound auth) */
  managed: z.boolean().optional(),
  /** Whether this credential is used for inbound or outbound auth */
  usage: z.enum(['inbound', 'outbound']).optional(),
});

export type OAuthCredential = z.infer<typeof OAuthCredentialSchema>;

export const CredentialSchema = z.discriminatedUnion('authorizerType', [ApiKeyCredentialSchema, OAuthCredentialSchema]);

export type Credential = z.infer<typeof CredentialSchema>;

// ============================================================================
// Evaluator Schema
// ============================================================================

export const EvaluatorTypeSchema = z.literal('CustomEvaluator');
export type EvaluatorType = z.infer<typeof EvaluatorTypeSchema>;

export const EvaluatorSchema = z.object({
  name: EvaluatorNameSchema,
  level: EvaluationLevelSchema,
  description: z.string().optional(),
  config: EvaluatorConfigSchema,
  kmsKeyArn: KmsKeyArnSchema.optional(),
  tags: TagsSchema.optional(),
});

export type Evaluator = z.infer<typeof EvaluatorSchema>;

// ============================================================================
// Harness Registry Schema
// ============================================================================

export const HarnessRegistryEntrySchema = z.object({
  name: HarnessNameSchema,
  path: z.string().min(1, 'Path to harness config directory is required'),
});

export type HarnessRegistryEntry = z.infer<typeof HarnessRegistryEntrySchema>;

// ============================================================================
// Project Schema (Top Level)
// ============================================================================

const BUILTIN_EVALUATOR_PREFIX = 'Builtin.';
const ARN_PREFIX = 'arn:';

export const AgentCoreProjectSpecSchema = z
  .object({
    $schema: z.string().optional(),
    name: ProjectNameSchema,
    version: z.number().int().min(1),
    managedBy: ManagedBySchema,
    tags: TagsSchema.optional(),

    runtimes: z
      .array(AgentEnvSpecSchema)
      .default([])
      .superRefine(
        uniqueBy(
          agent => agent.name,
          name => `Duplicate agent name: ${name}`
        )
      ),

    memories: z
      .array(MemorySchema)
      .default([])
      .superRefine(
        uniqueBy(
          memory => memory.name,
          name => `Duplicate memory name: ${name}`
        )
      ),

    credentials: z
      .array(CredentialSchema)
      .default([])
      .superRefine(
        uniqueBy(
          credential => credential.name,
          name => `Duplicate credential name: ${name}`
        )
      ),

    evaluators: z
      .array(EvaluatorSchema)
      .default([])
      .superRefine(
        uniqueBy(
          evaluator => evaluator.name,
          name => `Duplicate evaluator name: ${name}`
        )
      ),

    onlineEvalConfigs: z
      .array(OnlineEvalConfigSchema)
      .default([])
      .superRefine(
        uniqueBy(
          config => config.name,
          name => `Duplicate online eval config name: ${name}`
        )
      ),

    // MCP / Gateway resources (previously in mcp.json)
    agentCoreGateways: z
      .array(AgentCoreGatewaySchema)
      .default([])
      .superRefine(
        uniqueBy(
          gateway => gateway.name,
          name => `Duplicate gateway name: ${name}`
        )
      ),

    mcpRuntimeTools: z
      .array(AgentCoreMcpRuntimeToolSchema)
      .optional()
      .superRefine((tools, ctx) => {
        if (!tools) return;
        uniqueBy(
          (tool: { name: string }) => tool.name,
          (name: string) => `Duplicate MCP runtime tool name: ${name}`
        )(tools, ctx);
      }),

    unassignedTargets: z
      .array(AgentCoreGatewayTargetSchema)
      .optional()
      .superRefine((targets, ctx) => {
        if (!targets) return;
        uniqueBy(
          (target: { name: string }) => target.name,
          (name: string) => `Duplicate unassigned target name: ${name}`
        )(targets, ctx);
      }),

    policyEngines: z
      .array(PolicyEngineSchema)
      .default([])
      .superRefine(
        uniqueBy(
          engine => engine.name,
          name => `Duplicate policy engine name: ${name}`
        )
      ),

    configBundles: z
      .array(ConfigBundleSchema)
      .default([])
      .superRefine(
        uniqueBy(
          bundle => bundle.name,
          name => `Duplicate config bundle name: ${name}`
        )
      ),

    abTests: z
      .array(ABTestSchema)
      .default([])
      .superRefine(
        uniqueBy(
          test => test.name,
          name => `Duplicate AB test name: ${name}`
        )
      ),

    httpGateways: z
      .array(HttpGatewaySchema)
      .default([])
      .superRefine(
        uniqueBy(
          gw => gw.name,
          name => `Duplicate HTTP gateway name: ${name}`
        )
      ),

    harnesses: z
      .array(HarnessRegistryEntrySchema)
      .default([])
      .superRefine(
        uniqueBy(
          harness => harness.name,
          name => `Duplicate harness name: ${name}`
        )
      ),

    datasets: z
      .array(DatasetSchema)
      .optional()
      .superRefine((val, ctx) => {
        if (!val) return;
        const seen = new Set<string>();
        for (const dataset of val) {
          if (seen.has(dataset.name)) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate dataset name: ${dataset.name}` });
          }
          seen.add(dataset.name);
        }
      }),
  })
  .strict()
  .superRefine((spec, ctx) => {
    const agentNames = new Set(spec.runtimes.map(a => a.name));
    const evaluatorNames = new Set(spec.evaluators.map(e => e.name));

    for (const config of spec.onlineEvalConfigs) {
      // Validate agent reference
      if (!agentNames.has(config.agent)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Online eval config "${config.name}" references unknown agent "${config.agent}"`,
        });
      }

      // Validate evaluator references
      for (const evalName of config.evaluators) {
        // Skip built-in evaluators and ARN references (externally managed)
        if (evalName.startsWith(BUILTIN_EVALUATOR_PREFIX) || evalName.startsWith(ARN_PREFIX)) continue;
        if (!evaluatorNames.has(evalName)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Online eval config "${config.name}" references unknown evaluator "${evalName}"`,
          });
        }
      }
    }

    // Validate HTTP gateway runtimeRef references
    for (const gw of spec.httpGateways ?? []) {
      const runtimeExists = spec.runtimes.some(r => r.name === gw.runtimeRef);
      if (!runtimeExists) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `HTTP gateway "${gw.name}" references unknown runtime "${gw.runtimeRef}"`,
        });
      }
    }

    // Validate AB test gateway references
    for (const test of spec.abTests ?? []) {
      const gwField = test.gatewayRef;
      if (gwField && typeof gwField === 'string') {
        const match = /^\{\{gateway:(.+)\}\}$/.exec(gwField);
        if (match) {
          const gwName = match[1];
          const gwExists = (spec.httpGateways ?? []).some(gw => gw.name === gwName);
          if (!gwExists) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `AB test "${test.name}" references gateway "${gwName}" which does not exist in httpGateways`,
            });
          }

          // For target-based AB tests, validate target names exist in the gateway's targets array
          if (test.mode === 'target-based') {
            const gw = (spec.httpGateways ?? []).find(g => g.name === gwName);
            if (gw) {
              const gwTargetNames = new Set((gw.targets ?? []).map(t => t.name));
              for (const variant of test.variants) {
                const targetName = variant.variantConfiguration.target?.targetName;
                if (targetName && !gwTargetNames.has(targetName)) {
                  ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: `AB test "${test.name}" variant "${variant.name}" references target "${targetName}" which does not exist in gateway "${gwName}" targets`,
                  });
                }
              }
            }
          }
        }
      }
    }

    // Validate HTTP gateway target runtimeRef and qualifier references
    for (const gw of spec.httpGateways ?? []) {
      for (const target of gw.targets ?? []) {
        const runtime = spec.runtimes.find(r => r.name === target.runtimeRef);
        if (!runtime) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `HTTP gateway "${gw.name}" target "${target.name}" references unknown runtime "${target.runtimeRef}"`,
          });
        } else if (target.qualifier && target.qualifier !== 'DEFAULT' && !runtime.endpoints?.[target.qualifier]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `HTTP gateway "${gw.name}" target "${target.name}" references qualifier "${target.qualifier}" which is not an endpoint on runtime "${target.runtimeRef}"`,
          });
        }
      }
    }

    // Validate gateway target outbound-auth references against project credentials.
    // Per-target rules (task 1.4):
    //   1. credentialName must resolve to a declared credential.
    //   2. OAUTH-typed outbound auth must reference an OAuthCredentialProvider.
    //   3. AUTHORIZATION_CODE (3LO) targets backed by a CustomOauth2 vendor must
    //      have either a discoveryUrl OR both authorizationUrl + tokenUrl on the
    //      credential, since the consent flow needs an authorization endpoint.
    const credentialsByName = new Map(spec.credentials.map(c => [c.name, c]));
    for (const gateway of spec.agentCoreGateways) {
      for (const target of gateway.targets) {
        const auth = target.outboundAuth;
        if (!auth || auth.type === 'NONE' || !auth.credentialName) continue;

        const cred = credentialsByName.get(auth.credentialName);
        if (!cred) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Gateway target "${gateway.name}/${target.name}" references unknown credential "${auth.credentialName}"`,
          });
          continue;
        }

        if (auth.type === 'OAUTH' && cred.authorizerType !== 'OAuthCredentialProvider') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Gateway target "${gateway.name}/${target.name}" uses OAUTH outbound auth but credential "${auth.credentialName}" is not an OAuthCredentialProvider`,
          });
          continue;
        }
        if (auth.type === 'API_KEY' && cred.authorizerType !== 'ApiKeyCredentialProvider') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Gateway target "${gateway.name}/${target.name}" uses API_KEY outbound auth but credential "${auth.credentialName}" is not an ApiKeyCredentialProvider`,
          });
          continue;
        }

        if (
          auth.type === 'OAUTH' &&
          auth.grantType === 'AUTHORIZATION_CODE' &&
          cred.authorizerType === 'OAuthCredentialProvider' &&
          (cred.vendor === 'CustomOauth2' || !cred.vendor)
        ) {
          const hasDiscovery = Boolean(cred.discoveryUrl);
          const hasManualUrls = Boolean(cred.authorizationUrl && cred.tokenUrl);
          if (!hasDiscovery && !hasManualUrls) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Gateway target "${gateway.name}/${target.name}" is 3LO (AUTHORIZATION_CODE) but credential "${auth.credentialName}" (CustomOauth2) has neither discoveryUrl nor both authorizationUrl + tokenUrl set.`,
            });
          }
        }

        // A 3LO target on a gateway with `authorizerType: NONE` passes
        // shape-level schema validation but fails at CFN-stabilize time
        // with "3LO Auth is not supported when gateway authorizer type is
        // NONE" — wasting a multi-minute deploy and leaving a stuck
        // CREATE_PENDING_AUTH gateway target behind. Catch it client-side
        // at `agentcore validate` time so the developer never enters that
        // failure mode.
        if (auth.type === 'OAUTH' && auth.grantType === 'AUTHORIZATION_CODE') {
          const gatewayAuthorizerType = gateway.authorizerType ?? 'NONE';
          if (gatewayAuthorizerType === 'NONE') {
            // No `path` override here — matches the diagnostic style of
            // every other rule in this superRefine block.
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Gateway "${gateway.name}" target "${target.name}" uses 3LO (AUTHORIZATION_CODE) outbound auth, but the gateway's authorizerType is "NONE". 3LO requires an inbound authorizer (e.g. CUSTOM_JWT) so the gateway can identify the calling user.`,
            });
          }
          // The defaultReturnUrl-required-for-3LO rule lives on
          // OutboundAuthSchema's superRefine — see schemas/mcp.ts. That's
          // the right layer because the rule is about a single
          // outboundAuth shape, not about cross-target relationships.
        }
      }
    }
  });

export type AgentCoreProjectSpec = z.infer<typeof AgentCoreProjectSpecSchema>;
