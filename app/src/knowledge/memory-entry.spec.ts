import type { FactRead, TimelineEntry } from './gbrain-pages';
import {
  entryWrite,
  provenanceOf,
  storedAlready,
  type EntryContent,
  type EntrySource,
  type GbrainEntryWrite,
} from './memory-entry';

const PAGE = '5edbcc8c-3b2f-e938-c6a8-0380c810bdf3';
const THREAD = '99377236-610e-7024-a5d5-c07ad8e47219';
const SLUG = 'projects/5edbcc8c3b2fe938c6a80380c810bdf3';

const fromThread: EntrySource = { kind: 'notion', pageId: PAGE, discussionId: THREAD };

const entry = (kind: EntryContent['kind'], text: string): EntryContent => ({
  kind,
  text,
  date: '2026-10-14',
  source: fromThread,
});

const SOURCE = `Notion page ${PAGE}, thread ${THREAD}, 2026-10-14`;

describe('provenanceOf', () => {
  it('names the page, the thread and the day', () => {
    expect(provenanceOf(fromThread, '2026-10-14')).toBe(SOURCE);
  });

  it('without a thread names only the page', () => {
    const source: EntrySource = { kind: 'notion', pageId: PAGE };

    expect(provenanceOf(source, '2026-10-14')).toBe(`Notion page ${PAGE}, 2026-10-14`);
  });

  it('for a conversation says the source is a conversation', () => {
    const source: EntrySource = { kind: 'conversation' };

    expect(provenanceOf(source, '2026-10-14')).toBe('Conversation, 2026-10-14');
  });
});

describe('entryWrite', () => {
  it('an event is a timeline write on the anchor with the day and the source', () => {
    const expected: GbrainEntryWrite = {
      tool: 'timeline',
      slug: SLUG,
      date: '2026-10-14',
      summary: 'Постачальник підтвердив доставку',
      source: SOURCE,
    };

    expect(entryWrite(entry('event', 'Постачальник підтвердив доставку'), SLUG)).toEqual(expected);
  });

  it('a decision on an anchor is an event with the `Decision:` marker', () => {
    const expected: GbrainEntryWrite = {
      tool: 'timeline',
      slug: SLUG,
      date: '2026-10-14',
      summary: 'Decision: беремо Kestrel',
      source: SOURCE,
    };

    expect(entryWrite(entry('decision', 'беремо Kestrel'), SLUG)).toEqual(expected);
  });

  it('a marker the text already has is not added twice', () => {
    const write: GbrainEntryWrite = entryWrite(entry('decision', 'Decision: беремо Kestrel'), SLUG);

    expect(write).toMatchObject({ summary: 'Decision: беремо Kestrel' });
  });

  it('a decision with no Notion object is a fact with no entity and the same marker', () => {
    const expected: GbrainEntryWrite = {
      tool: 'fact',
      fact: 'Decision: ескалація після двох днів',
      kind: 'fact',
      provenance: SOURCE,
      entity: null,
    };

    expect(entryWrite(entry('decision', 'ескалація після двох днів'), null)).toEqual(expected);
  });

  it('a fact is about the anchor, and with no object it has no entity', () => {
    expect(entryWrite(entry('fact', 'Замовник дивиться макети в четвер'), SLUG)).toEqual({
      tool: 'fact',
      fact: 'Замовник дивиться макети в четвер',
      kind: 'fact',
      provenance: SOURCE,
      entity: SLUG,
    });
    expect(entryWrite(entry('fact', 'Іван відповідає за юридичне'), null)).toMatchObject({
      entity: null,
    });
  });

  it('the acceptable state of an Area of Focus is a `preference` fact with the `Standard:` marker', () => {
    const expected: GbrainEntryWrite = {
      tool: 'fact',
      fact: 'Standard: дві пробіжки на тиждень',
      kind: 'preference',
      provenance: SOURCE,
      entity: 'areas-of-focus/aaaa',
    };

    expect(entryWrite(entry('standard', 'дві пробіжки на тиждень'), 'areas-of-focus/aaaa')).toEqual(
      expected,
    );
  });

  it.each<EntryContent['kind']>(['event', 'standard'])(
    'kind %s without a page for the object is a caller error',
    (kind) => {
      expect(() => entryWrite(entry(kind, 'щось'), null)).toThrow(RangeError);
    },
  );
});

describe('storedAlready', () => {
  const timelineEntry = (date: string, summary: string): TimelineEntry => ({
    date,
    summary,
    source: '',
    detail: '',
  });
  const storedFact = (text: string): FactRead => ({
    fact: text,
    kind: 'fact',
    entitySlug: SLUG,
    provenance: '',
  });
  const decision: GbrainEntryWrite = entryWrite(entry('decision', 'беремо Kestrel'), SLUG);

  it('the same event on the same day is stored even when the whitespace differs', () => {
    expect(
      storedAlready(decision, [timelineEntry('2026-10-14', 'Decision:  беремо\nKestrel')], []),
    ).toBe(true);
  });

  it('the same event on another day is a different event', () => {
    expect(
      storedAlready(decision, [timelineEntry('2026-10-13', 'Decision: беремо Kestrel')], []),
    ).toBe(false);
  });

  it('the same fact among the page facts is stored', () => {
    const write: GbrainEntryWrite = entryWrite(entry('fact', 'Макети в четвер'), SLUG);

    expect(storedAlready(write, [], [storedFact('Макети в четвер')])).toBe(true);
    expect(storedAlready(write, [], [storedFact('Макети в п’ятницю')])).toBe(false);
  });

  it('a fact with no entity is not compared because it cannot be found reliably', () => {
    const write: GbrainEntryWrite = entryWrite(entry('fact', 'Макети в четвер'), null);

    expect(storedAlready(write, [], [storedFact('Макети в четвер')])).toBe(false);
  });
});
