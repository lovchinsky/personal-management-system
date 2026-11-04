import { Test } from '@nestjs/testing';
import { bindingOf } from '../../src/notion/binding/binding';
import { BindingFile, CanonicalType } from '../../src/notion/binding/binding.schema';
import { canonicalPage, Page, PageBlock, RestProperty } from '../../src/notion/client/page';
import { propertyIdFromBinding } from '../../src/notion/client/property-id';
import { AdapterConfigurationError, MisboundSlot } from '../../src/notion/semantics/adapter.error';
import { SemanticAdapter } from '../../src/notion/semantics/semantic.adapter';
import { TASK_STATUS_SPELLED, VALID_BINDING_FILE } from './notion-mapping.fixture';
import { bindingProvider } from './test-module';

/**
 * Synthetic Notion pages for the synthetic binding.
 *
 * Shared by the adapter's unit spec and the conformance tests: both suites exercise the same
 * resolution, and a second description of the physical payload would drift from the first.
 */

export const DATE = '2026-09-25';
export const LAST_EDITED = '2026-09-24T08:00:00.000Z';

/**
 * Slots whose physical property is a date. The list is needed because the binding alone does not
 * show a property's type: `native` names an id, not a shape.
 */
const DATE_PROPERTIES: ReadonlySet<string> = new Set(['p_task_date', 'p_task_deadline']);

/** The model of the same binding: pages are built from whatever it names as a carrier. */
const BINDING = bindingOf(VALID_BINDING_FILE, 'fixture');

/** Payload shapes are derived from the union, so there is no second description of a shape. */
type RichTextRun = Extract<RestProperty, { type: 'title' }>['title'][number];

export const run = (content: string): RichTextRun => ({
  type: 'text',
  text: { content, link: null },
  annotations: {
    bold: false,
    italic: false,
    strikethrough: false,
    underline: false,
    code: false,
    color: 'default',
  },
  plain_text: content,
  href: null,
});

export const textProperty = (id: string, text: string): RestProperty =>
  id === 'title'
    ? { id, type: 'title', title: [run(text)] }
    : { id, type: 'rich_text', rich_text: [run(text)] };

export const optionProperty = (id: string, optionId: string, name: string): RestProperty => ({
  id,
  type: 'status',
  status: { id: optionId, name, color: 'default' },
});

/** Builds a date property, with a time zone only when the person set one in Notion. */
export const dateProperty = (
  id: string,
  start: string | null,
  timeZone: string | null = null,
): RestProperty => ({
  id,
  type: 'date',
  date: start === null ? null : { start, end: null, time_zone: timeZone },
});

export const relationProperty = (id: string, pageIds: string[], hasMore = false): RestProperty => ({
  id,
  type: 'relation',
  relation: pageIds.map((pageId) => ({ id: pageId })),
  has_more: hasMore,
});

const user = { object: 'user', id: 'user-1' } as const;

export const block: PageBlock = {
  object: 'block',
  id: 'block-1',
  parent: { type: 'page_id', page_id: 'page-1' },
  type: 'paragraph',
  paragraph: { rich_text: [run('межа роботи')], color: 'default', icon: null },
  created_time: '2026-09-24T08:00:00.000Z',
  created_by: user,
  last_edited_time: '2026-09-24T08:00:00.000Z',
  last_edited_by: user,
  has_children: false,
  in_trash: false,
  archived: false,
};

const textFormula = (id: string, text: string | null): RestProperty => ({
  id,
  type: 'formula',
  formula: { type: 'string', string: text },
});

export const numberFormula = (id: string, value: number | null): RestProperty => ({
  id,
  type: 'formula',
  formula: { type: 'number', number: value },
});

export const numberRollup = (id: string, value: number | null): RestProperty => ({
  id,
  type: 'rollup',
  rollup: { type: 'number', number: value, function: 'percent_per_group' },
});

/**
 * Builds a page of a type in REST shape, translated by the same `canonicalPage` the reader uses.
 * The properties have IDs in the form the binding writes and Notion returns. A page built by
 * bypassing `canonicalPage` would not test the translation at all.
 *
 * The page is one on which everything the binding names is actually present. It is built from the
 * binding itself, not from a hand-written list. A slot that appears in the contract gets a carrier
 * at once, so the test does not start failing on something it never described.
 */
export function pageFor(type: CanonicalType, overrides: Record<string, RestProperty> = {}): Page {
  const properties: Record<string, RestProperty> = {};

  for (const { slot, property } of BINDING.signalsOf(type)) {
    const id = property.spelled;

    properties[id] = slot.endsWith('streak')
      ? numberFormula(id, 3)
      : textFormula(id, `computed ${slot}`);
  }

  for (const { slot, field, carrier } of BINDING.fieldsOf(type)) {
    if (carrier.kind === 'native') {
      const id = carrier.property.spelled;
      const [name, optionId] = BINDING.optionSet(slot)?.canonical[0] ?? [];

      properties[id] = DATE_PROPERTIES.has(id)
        ? dateProperty(id, DATE)
        : name && optionId
          ? optionProperty(id, optionId, name)
          : textProperty(id, `text of ${field}`);
    }

    if (carrier.kind === 'relation') {
      const id = carrier.property.spelled;

      properties[id] = relationProperty(id, []);
    }
  }

  return canonicalPage({
    in_trash: false,
    parent: {
      type: 'data_source_id',
      data_source_id: VALID_BINDING_FILE.data_sources[type],
      database_id: `db_${type}`,
    },
    id: 'page-1',
    last_edited_time: LAST_EDITED,
    properties: { ...properties, ...overrides },
  });
}

/** Returns a page without the named properties. Their IDs are in the binding form. */
export function without(page: Page, ...spelled: readonly string[]): Page {
  const gone = new Set(spelled.map((id) => propertyIdFromBinding(id)));

  return {
    ...page,
    properties: new Map([...page.properties].filter(([id]) => !gone.has(id))),
  };
}

export function taskWithStatus(optionId: string, name: string): Page {
  return pageFor('task', {
    [TASK_STATUS_SPELLED]: optionProperty(TASK_STATUS_SPELLED, optionId, name),
  });
}

/** Returns the slots the adapter named as unusable. Throws when the adapter did not. */
export function misbound(decode: () => unknown): readonly MisboundSlot[] {
  try {
    decode();
  } catch (error) {
    if (error instanceof AdapterConfigurationError) return error.misbound;

    throw error;
  }

  throw new Error('decode accepted a mapping it had to reject');
}

export async function adapterWith(
  file: BindingFile = VALID_BINDING_FILE,
): Promise<SemanticAdapter> {
  const moduleRef = await Test.createTestingModule({
    providers: [SemanticAdapter, bindingProvider(file)],
  }).compile();

  return moduleRef.get(SemanticAdapter);
}
