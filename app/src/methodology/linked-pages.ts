import type { Reading } from '../notion/semantics/reading';
import { Undetermined, undetermined } from './undetermined';

/**
 * Returns the pages that a read relation points to. An empty relation is a list with no elements:
 * the carrier exists, there are no links. A truncated, unread or non-relation carrier yields no
 * list: its length says nothing.
 */
export function linkedPageIds(reading: Reading): readonly string[] | Undetermined {
  switch (reading.state) {
    case 'value':
      if (reading.value.type !== 'links') return undetermined('gap');
      return reading.value.truncated ? undetermined('truncated') : reading.value.pageIds;

    case 'empty':
      return [];

    case 'absent':
    case 'unread':
    case 'gap':
    case 'non_canonical':
      return undetermined(reading.state);
  }
}
