import { z } from 'zod';
import {
  attachedServerSchema,
  loadedPluginSchema,
  modelTokensSchema,
} from '../../runs/run-outcome';

/**
 * Run stream messages with exactly the fields the runner relies on.
 *
 * The stream is read with schemas, not SDK types, because the CLI adds fields and subtypes
 * between versions (such as `system/thinking_tokens`), and what is unknown must be skipped
 * instead of breaking the run. The schemas are not strict on purpose: only what is named is
 * strict here.
 */

export const initMessageSchema = z.object({
  type: z.literal('system'),
  subtype: z.literal('init'),
  session_id: z.string(),
  claude_code_version: z.string(),
  model: z.string(),
  permissionMode: z.string(),
  tools: z.array(z.string()),
  /** The session's skills: its own and those built into the account; a run cannot call them. */
  skills: z.array(z.string()),
  mcp_servers: z.array(attachedServerSchema),
  plugins: z.array(loadedPluginSchema),
});

export type InitMessage = z.infer<typeof initMessageSchema>;

/** The kind of a stream message, whether or not the rest of it can be read. */
export const messageEnvelopeSchema = z.object({
  type: z.string(),
  subtype: z.unknown().optional(),
});

export const resultMessageSchema = z.object({
  type: z.literal('result'),
  subtype: z.string(),
  is_error: z.boolean(),
  session_id: z.string(),
  terminal_reason: z.string().optional(),
  structured_output: z.unknown().optional(),
  permission_denials: z.array(z.object({ tool_name: z.string() })).default([]),
  duration_ms: z.number(),
  num_turns: z.number(),
  modelUsage: z.record(z.string(), modelTokensSchema),
  errors: z.array(z.string()).optional(),
  result: z.string().optional(),
});

export type ResultMessage = z.infer<typeof resultMessageSchema>;

export const rateLimitEventSchema = z.object({
  type: z.literal('rate_limit_event'),
  rate_limit_info: z.object({
    status: z.string(),
    /** Seconds, not milliseconds. */
    resetsAt: z.number().optional(),
    rateLimitType: z.string().optional(),
    isUsingOverage: z.boolean().optional(),
    overageInUse: z.boolean().optional(),
  }),
});

export const refusalFallbackSchema = z.object({
  type: z.literal('system'),
  subtype: z.literal('model_refusal_fallback'),
  original_model: z.string(),
  fallback_model: z.string(),
});

export const assistantMessageSchema = z.object({
  type: z.literal('assistant'),
  error: z.string().optional(),
  message: z.object({
    content: z.array(
      z.object({
        type: z.string(),
        id: z.string().optional(),
        name: z.string().optional(),
        input: z.unknown().optional(),
      }),
    ),
  }),
});

export const userMessageSchema = z.object({
  type: z.literal('user'),
  message: z.object({
    content: z.union([
      z.string(),
      z.array(
        z.object({
          type: z.string(),
          tool_use_id: z.string().optional(),
          is_error: z.boolean().optional(),
          content: z.unknown().optional(),
        }),
      ),
    ]),
  }),
});
