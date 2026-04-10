import { z } from 'zod';

// ============================================================================
// HTTP Gateway Types
// ============================================================================

export const HttpGatewayNameSchema = z
  .string()
  .min(1, 'Name is required')
  .max(48)
  .regex(
    /^[a-zA-Z][a-zA-Z0-9-]{0,47}$/,
    'Must begin with a letter and contain only alphanumeric characters and hyphens (max 48 chars)'
  );

export const HttpGatewaySchema = z
  .object({
    /** Unique name for the HTTP gateway */
    name: HttpGatewayNameSchema,
    /** Optional description */
    description: z.string().min(1).max(200).optional(),
    /** Reference to a runtime name from spec.runtimes. One target is created per gateway pointing to this runtime. */
    runtimeRef: z.string().min(1),
    /** IAM role ARN for gateway execution. Auto-created if omitted. */
    roleArn: z.string().min(1).optional(),
  })
  .strict();

export type HttpGateway = z.infer<typeof HttpGatewaySchema>;
