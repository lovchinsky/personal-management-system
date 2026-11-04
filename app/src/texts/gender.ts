/**
 * Grammatical gender (ADR 0046): the one the App and the model use when they address the
 * installation owner, and the one the assistant uses for itself. The choices are masculine,
 * feminine or no gender forms; with no gender forms, sentences are built so that gender is not
 * needed. A language with no gender in the second person (English) does not read the value.
 */
export const GENDERS = ['masculine', 'feminine', 'neutral'] as const;

export type Gender = (typeof GENDERS)[number];

/** With no gender set, sentences have no gender forms, because nothing is guessed (ADR 0046). */
const DEFAULT_GENDER: Gender = 'neutral';

function isGender(value: string): value is Gender {
  return (GENDERS as readonly string[]).includes(value);
}

/**
 * Returns the gender from the setting. The environment check rejects an unknown value before this
 * read.
 */
export function genderOf(value: string | undefined): Gender {
  return value !== undefined && isGender(value) ? value : DEFAULT_GENDER;
}
