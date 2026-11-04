import { registerAs, type ConfigType } from '@nestjs/config';
import { required } from '../../platform/config/env-value';

/**
 * The installation's binding file: without it the App does not know which database is `Task`, so
 * startup stops.
 */
export const bindingConfig = registerAs('binding', () => ({
  file: required(process.env.NOTION_MAPPING_FILE, 'NOTION_MAPPING_FILE'),
}));

export type BindingConfig = ConfigType<typeof bindingConfig>;
