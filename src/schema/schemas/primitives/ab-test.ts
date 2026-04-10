import { z } from 'zod';

// ============================================================================
// AB Test Types
// ============================================================================

export const ABTestNameSchema = z
  .string()
  .min(1, 'Name is required')
  .max(48)
  .regex(
    /^[a-zA-Z][a-zA-Z0-9_]{0,47}$/,
    'Must begin with a letter and contain only alphanumeric characters and underscores (max 48 chars)'
  );

export const ABTestDescriptionSchema = z.string().min(1).max(200).optional();

export const VariantNameSchema = z.enum(['C', 'T1']);

export const VariantWeightSchema = z.number().int().min(1).max(100);

export const ConfigurationBundleRefSchema = z.object({
  bundleArn: z.string().min(1),
  bundleVersion: z.string().min(1),
});

export type ConfigurationBundleRef = z.infer<typeof ConfigurationBundleRefSchema>;

export const VariantConfigurationSchema = z.object({
  configurationBundle: ConfigurationBundleRefSchema,
});

export type VariantConfiguration = z.infer<typeof VariantConfigurationSchema>;

export const ABTestVariantSchema = z.object({
  name: VariantNameSchema,
  weight: VariantWeightSchema,
  variantConfiguration: VariantConfigurationSchema,
});

export type ABTestVariant = z.infer<typeof ABTestVariantSchema>;

export const ABTestEvaluationConfigSchema = z.object({
  onlineEvaluationConfigArn: z.string().min(1),
});

export type ABTestEvaluationConfig = z.infer<typeof ABTestEvaluationConfigSchema>;

export const TrafficRouteOnHeaderSchema = z.object({
  headerName: z.string().min(1),
});

export const TrafficAllocationConfigSchema = z.object({
  routeOnHeader: TrafficRouteOnHeaderSchema,
});

export type TrafficAllocationConfig = z.infer<typeof TrafficAllocationConfigSchema>;

export const ABTestSchema = z
  .object({
    name: ABTestNameSchema,
    description: ABTestDescriptionSchema,
    gatewayRef: z.string().min(1),
    roleArn: z.string().min(1).optional(),
    variants: z.array(ABTestVariantSchema).length(2),
    evaluationConfig: ABTestEvaluationConfigSchema,
    trafficAllocationConfig: TrafficAllocationConfigSchema.optional(),
    maxDurationDays: z.number().int().min(1).max(90).optional(),
    enableOnCreate: z.boolean().optional(),
  })
  .refine(
    data => {
      const names = data.variants.map(v => v.name);
      return names.includes('C') && names.includes('T1');
    },
    { message: 'Variants must include exactly one control (C) and one treatment (T1)', path: ['variants'] }
  )
  .refine(data => data.variants.reduce((sum, v) => sum + v.weight, 0) === 100, {
    message: 'Variant weights must sum to 100',
    path: ['variants'],
  });

export type ABTest = z.infer<typeof ABTestSchema>;
