import { registerAs, type ConfigType } from '@nestjs/config';

export const continuationsConfig = registerAs('continuations', () => ({
  /** How often the App checks for a wake whose failure the person has not been told about. */
  noticeTickSeconds: 60,
}));

export type ContinuationsConfig = ConfigType<typeof continuationsConfig>;
