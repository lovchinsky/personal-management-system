import { canonical } from './contracts';
import { skillFiles } from './plugin-files';

/** The names of canonical objects that consist of several words. */
const COMPOUND_NAMES: readonly string[] = Object.values(canonical.levelObjects())
  .flatMap((level) => level.objects)
  .filter((name) => name.includes(' '));

/**
 * Returns the prose of a file. What is in backticks is a capability name or a value, and is cut
 * out.
 */
function prose(text: string): string {
  return text.replace(/`[^`\n]*`/g, '');
}

/**
 * Builds a pattern for the places where a compound name is used as its first word alone, in the
 * singular, plural or possessive.
 */
function firstWordAlone(name: string): RegExp {
  const [first, ...rest] = name.split(' ');

  return new RegExp(`\\b${first}s?\\b(?!\\s+${rest.join('\\s+')})`, 'g');
}

/** Returns the plural of a word of a name: `identity` → `identities`, `area` → `areas`. */
function plural(word: string): string {
  return word.endsWith('y') ? `${word.slice(0, -1)}ies` : `${word}s`;
}

/**
 * Checks whether a name derived from a type has all of the type's words in the same order, one of
 * them in the plural.
 */
function namesEveryWord(type: string, derived: string): boolean {
  const words = type.split('_');
  const parts = derived.split('-');

  return (
    words.length === parts.length &&
    words.every((word, at) => parts[at] === word || parts[at] === plural(word))
  );
}

/**
 * A canonical type is named in full everywhere (`contracts/canonical.yaml`, the file's rules)
 * because an agent and a person recognize a methodology object by its full name. A name derived
 * from a type includes all of the type's words.
 */
describe('canonical type names are used in full', () => {
  it('the contract has compound names', () => {
    expect(COMPOUND_NAMES).toEqual(expect.arrayContaining(['Area of Focus', 'Behavior System']));
  });

  it.each(COMPOUND_NAMES)('the Skill names “%s” in full', (name) => {
    const partial = skillFiles().flatMap((file) => {
      const text = prose(file.text);

      return [...text.matchAll(firstWordAlone(name))].map((match) => {
        const line = text.slice(0, match.index).split('\n').length;

        return `${file.path}:${line} ${text.split('\n')[line - 1]?.trim().slice(0, 100) ?? ''}`;
      });
    });

    expect(partial).toEqual([]);
  });

  it('an anchor directory has all the words of the type name', () => {
    const partial = Object.entries(canonical.gbrainAnchorShape().slug_prefixes).filter(
      ([type, prefix]) => !namesEveryWord(type, prefix),
    );

    expect(partial).toEqual([]);
  });
});
