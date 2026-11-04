import { registerAs, type ConfigType } from '@nestjs/config';
import { optional } from '../platform/config/env-value';
import { genderOf } from '../texts/gender';
import { isLanguage, type Language } from '../texts/language';

/**
 * The zone lives here, not in `env.validation`: the default must live in one place, and validation
 * only checks that the declared name is a real IANA zone.
 */
const DEFAULT_TIME_ZONE = 'Europe/Kyiv';

/** The default language lives only here, for the same reason (ADR 0042). */
const DEFAULT_LANGUAGE: Language = 'en';

/**
 * Returns the installation's language. The environment check rejects an unknown one before this
 * read.
 */
function languageOf(value: string | undefined): Language {
  return value !== undefined && isLanguage(value) ? value : DEFAULT_LANGUAGE;
}

export const appConfig = registerAs('app', () => ({
  /**
   * Parsed with the same `Number` as in the environment check, so the App listens on the number
   * that was checked.
   */
  port: Number(optional(process.env.PORT) ?? 3000),
  /** The zone in which the day starts and quiet hours run. */
  timeZone: optional(process.env.APP_TIMEZONE) ?? DEFAULT_TIME_ZONE,
  /** The language the App itself writes to the person in (ADR 0042). */
  language: languageOf(optional(process.env.APP_LANGUAGE)),
  /** The grammatical gender the App and the model use to address the owner (ADR 0046). */
  ownerGender: genderOf(optional(process.env.APP_OWNER_GENDER)),
}));

export type AppConfig = ConfigType<typeof appConfig>;
