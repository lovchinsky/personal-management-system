import { registerAs, type ConfigType } from '@nestjs/config';
import { optional } from '../../platform/config/env-value';
import { genderOf } from '../../texts/gender';

/**
 * The assistant as its owner named it (ADR 0049): the name the person calls it by and the
 * grammatical gender it uses when it speaks of itself (ADR 0046). Only `runtime_read` reads them,
 * so the config namespace belongs to the App MCP server (ADR 0019). The App uses neither the
 * assistant's name nor its gender in its own texts.
 */
export const assistantConfig = registerAs('assistant', () => ({
  /** `null` means an assistant with no name; a value of only spaces means “none” as well. */
  name: optional(process.env.APP_ASSISTANT_NAME)?.trim() || null,
  gender: genderOf(optional(process.env.APP_ASSISTANT_GENDER)),
}));

export type AssistantConfig = ConfigType<typeof assistantConfig>;
