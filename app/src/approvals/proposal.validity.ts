import { PropertyId } from '../notion/client/property-id';
import { CanonicalWrite, sameWrite } from '../notion/semantics/canonical-write';
import { Precondition } from './preconditions/precondition';
import { ActionEffect } from './proposal.schema';

/**
 * Returns the object the action acts on: the page the write goes to.
 *
 * The function is total over pages, because an effect has no other kind of subject.
 */
function subjectOf(effect: ActionEffect): string {
  return effect.pageId;
}

/**
 * Checks whether this precondition **observes** this particular effect.
 *
 * Once-only execution of a domain effect is enforced here, and only when the precondition looks
 * where the write will go. An executor that wrote and then died before it could mark the row reads
 * the state again on the second attempt. A precondition that looks at the changed property no
 * longer holds then, and `conflict` is returned instead of a second write. A precondition that
 * looks elsewhere finds everything in place and lets the second write through.
 *
 * `unchanged_since` observes nothing specific and is deliberately left out: Notion truncates
 * `last_edited_time` to the minute, so the system's own write in that same minute is invisible to
 * it (`docs/2-system.md` § “Preconditions and executor”).
 */
function observes(precondition: Precondition, effect: ActionEffect): boolean {
  const sameProperty = (candidate: { pageId: string; propertyId: PropertyId }): boolean =>
    candidate.pageId === effect.pageId && candidate.propertyId === effect.propertyId;

  switch (precondition.kind) {
    // Compares the option id, so it sees only an option write or its clearing.
    case 'property_equals':
      return (
        sameProperty(precondition) &&
        (effect.value.kind === 'option' || effect.value.kind === 'clear')
      );

    // Sees the property stop being empty, so it sees a value write.
    case 'property_empty':
      return sameProperty(precondition) && effect.value.kind !== 'clear';

    // Reads the value the way the adapter reads it, so it sees a write of any kind, but only one
    // that changes what the precondition reads: an effect that writes the same value would leave
    // the precondition true, and a retry would pass.
    case 'property_reads_as':
      return sameProperty(precondition) && !sameWrite(precondition.value, effect.value);

    default:
      return false;
  }
}

/**
 * Every declared effect must have a precondition that will see it. An effect that no
 * precondition sees is a write whose retry cannot be told apart from the first time.
 */
function unobservedEffects(
  effects: readonly ActionEffect[],
  preconditions: readonly Precondition[],
): readonly ActionEffect[] {
  return effects.filter(
    (effect) => !preconditions.some((precondition) => observes(precondition, effect)),
  );
}

/**
 * Returns what the proposal will write: a value per property. Each property appears once, which
 * the validity rule enforces (`repeated_property`), so the list of effects and the map of writes
 * say the same thing.
 */
export function writesOf(
  effects: readonly ActionEffect[],
): ReadonlyMap<PropertyId, CanonicalWrite> {
  return new Map(effects.map((effect) => [effect.propertyId, effect.value]));
}

/** Why a proposal is not executable. */
export type ProposalDefect =
  | { readonly kind: 'no_effect' }
  | { readonly kind: 'unobserved'; readonly effects: readonly ActionEffect[] }
  | { readonly kind: 'many_subjects'; readonly subjects: readonly string[] }
  | { readonly kind: 'repeated_property'; readonly propertyIds: readonly string[] };

/**
 * A valid proposal yields what is needed from it next; an invalid one yields why.
 *
 * It is one answer, not two in a row: the subject of the write is derived from the same effects
 * that have just been checked for a single subject, so asking about it separately would mean
 * asking a second time and adding a “what if it is missing” branch that by construction never
 * occurs.
 */
type ProposalValidity =
  | { readonly valid: true; readonly subject: string }
  | { readonly valid: false; readonly defects: readonly ProposalDefect[] };

/**
 * Proposal validity is **one** function, not two halves in different classes.
 *
 * It is a single rule with two clauses (`contracts/canonical.yaml`, key `pending_action`). Kept
 * separate, the clauses would not know about each other: an action on two objects would fail as
 * non-executable only after the person's decision, and a row with an unobserved effect would be
 * executed with no once-only guarantee at all.
 *
 * `valid: true` means “executable”; otherwise `defects` says why not.
 */
export function validateProposal(
  effects: readonly ActionEffect[],
  preconditions: readonly Precondition[],
): ProposalValidity {
  const defects: ProposalDefect[] = [];

  if (effects.length === 0) defects.push({ kind: 'no_effect' });

  const unobserved = unobservedEffects(effects, preconditions);
  if (unobserved.length > 0) {
    defects.push({ kind: 'unobserved', effects: unobserved });
  }

  const [subject, ...rest] = effects.map(subjectOf);

  if (subject !== undefined && !rest.every((other) => other === subject)) {
    defects.push({ kind: 'many_subjects', subjects: [...new Set([subject, ...rest])] });
  }

  const repeated = repeatedProperties(effects);
  if (repeated.length > 0) {
    defects.push({ kind: 'repeated_property', propertyIds: repeated });
  }

  if (defects.length > 0 || subject === undefined) {
    return { valid: false, defects };
  }

  return { valid: true, subject };
}

/** Describes a defect in words, for the message to the person and for the reason column. */
export function describeDefect(defect: ProposalDefect): string {
  switch (defect.kind) {
    case 'no_effect':
      return 'declares no effect at all';

    case 'unobserved':
      return (
        'declares effects no precondition observes: ' +
        defect.effects.map(nameEffect).join(', ') +
        ' — property_equals observes an option write or clear, property_empty observes a value ' +
        'written into an empty property, property_reads_as observes any write that changes the ' +
        'value it names (it must differ from the value written)'
      );

    case 'many_subjects':
      return (
        `touches more than one object (${defect.subjects.join(', ')}) — ` +
        'one write changes one page, so such an action cannot be made one-shot'
      );

    case 'repeated_property':
      return (
        `writes the same property more than once (${defect.propertyIds.join(', ')}) — ` +
        'one write carries one value per property'
      );
  }
}

/** Returns the properties a proposal writes with more than one effect. */
function repeatedProperties(effects: readonly ActionEffect[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();

  for (const { pageId, propertyId } of effects) {
    const key = `${pageId}/${propertyId}`;

    if (seen.has(key)) repeated.add(propertyId);

    seen.add(key);
  }

  return [...repeated];
}

function nameEffect(effect: ActionEffect): string {
  return `property_write (${effect.value.kind}) ${effect.propertyId} on ${effect.pageId}`;
}
