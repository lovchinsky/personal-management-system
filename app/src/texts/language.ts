/**
 * The languages the App itself writes to the person in (ADR 0042): BCP 47 tags, valid both for
 * `<html lang>` and for `Intl.PluralRules`. The catalog of each is `texts/<language>.ts`.
 */
export const LANGUAGES = ['uk', 'en'] as const;

export type Language = (typeof LANGUAGES)[number];

export function isLanguage(value: string): value is Language {
  return (LANGUAGES as readonly string[]).includes(value);
}
