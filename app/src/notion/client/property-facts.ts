import { PageProperty } from './page';

/**
 * What a property really says.
 *
 * The second arm exists because “I don't know” and “no” are different answers. Merging them means
 * issuing a verdict where there is none: a total function, asked about something its input does
 * not contain, answers and so becomes confidently wrong.
 */
export type Observed<T> =
  { readonly known: true; readonly value: T } | { readonly known: false; readonly why: string };

function known<T>(value: T): Observed<T> {
  return { known: true, value };
}

function unobservable<T>(why: string): Observed<T> {
  return { known: false, why };
}

/*
 * Below are the physical questions about a Notion property that the preconditions of proposals
 * ask. They live here, at the Notion boundary, not in approvals: only this module must know the
 * shape of a Notion payload.
 *
 * The decoder of the canonical model (`semantics/`) answers a different question under a
 * different policy: for it a text of only spaces is empty, and an empty list of relations is a
 * value. All they share is the payload shape, and the SDK already provides it: describing it a
 * second time as a separate union would mean two forms of one thing.
 */

/**
 * Returns the id of the chosen option, or an explanation of why the question makes no sense.
 *
 * `property_equals` compares options, and only them. A date, a relation, a text, a number or a
 * person has no such id, and `null` here would mean “nothing chosen”, which is an **answer**: a
 * precondition over a date would always be false, the action would end up in `conflict`,
 * `INV-027` would advise making a new proposal, and the new proposal would run into the same wall.
 * A change to a filled non-option property is covered by `property_reads_as`, not by
 * `property_equals`.
 */
export function optionIdOf(property: PageProperty): Observed<string | null> {
  if (property.type === 'status') return known(property.status?.id ?? null);
  if (property.type === 'select') return known(property.select?.id ?? null);

  return unobservable(
    `property_equals compares option ids, and a ${property.type} property has none`,
  );
}

/**
 * Reports whether a property is empty, where that question makes sense.
 *
 * `default` does not say “not empty”: `url`, `email`, `phone_number` and `files`, which a person
 * fills in, would land there, and `property_empty` over them would always be false. Nobody fills
 * in computed types, and “not empty” is an invention for them; much less should a new Notion type
 * quietly become “not empty”.
 */
export function isEmpty(property: PageProperty): Observed<boolean> {
  switch (property.type) {
    case 'status':
      return known(property.status === null);
    case 'select':
      return known(property.select === null);
    case 'date':
      return known(property.date === null);
    case 'relation':
      return known(property.relation.length === 0);
    case 'rich_text':
      return known(property.rich_text.length === 0);
    case 'title':
      return known(property.title.length === 0);
    case 'number':
      return known(property.number === null);
    case 'checkbox':
      return known(property.checkbox === false);
    case 'people':
      return known(property.people.length === 0);
    case 'multi_select':
      return known(property.multi_select.length === 0);
    case 'url':
      return known(property.url === null);
    case 'email':
      return known(property.email === null);
    case 'phone_number':
      return known(property.phone_number === null);
    case 'files':
      return known(property.files.length === 0);
    default:
      return unobservable(`a ${property.type} property is not something anyone fills`);
  }
}
