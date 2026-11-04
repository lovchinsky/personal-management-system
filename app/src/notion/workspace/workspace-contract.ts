import { readFileSync } from 'node:fs';
import { parseDocument } from 'yaml';
import { z } from 'zod';
import { CANONICAL_TYPES, SIGNAL_SLOTS } from '../binding/binding.schema';
import {
  PLAIN_TYPES,
  type DatabaseShape,
  type IconShape,
  type PropertyShape,
} from './workspace-schema';

/**
 * The physical Notion schema and the binding of the canonical model to it by names:
 * `contracts/notion-workspace.yaml`. The file is edited by hand; the workspace is built and
 * checked from it, and the binding is written by substituting the live workspace's ids for the
 * names. The schema is strict: an unknown key is refused, not silently let through.
 */

const COLORS = [
  'default',
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red',
] as const;

const ICON_COLORS = [
  'gray',
  'lightgray',
  'brown',
  'yellow',
  'orange',
  'green',
  'blue',
  'purple',
  'pink',
  'red',
] as const;

const ROLLUP_FUNCTIONS = [
  'count',
  'count_values',
  'empty',
  'not_empty',
  'unique',
  'show_unique',
  'percent_empty',
  'percent_not_empty',
  'sum',
  'average',
  'median',
  'min',
  'max',
  'range',
  'earliest_date',
  'latest_date',
  'date_range',
  'checked',
  'unchecked',
  'percent_checked',
  'percent_unchecked',
  'count_per_group',
  'percent_per_group',
  'show_original',
] as const;

const name = z.string().min(1);
const description = z.string().optional();

const optionSchema = z.strictObject({ name, color: z.enum(COLORS), description });

const propertySchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.enum(PLAIN_TYPES), description }),
  z.strictObject({ type: z.literal('number'), format: name, description }),
  z.strictObject({
    type: z.enum(['select', 'multi_select', 'status']),
    options: z.array(optionSchema),
    description,
  }),
  z.strictObject({
    type: z.literal('relation'),
    target: name,
    synced: name.nullable(),
    description,
  }),
  z.strictObject({
    type: z.literal('rollup'),
    relation: name,
    rollup: name,
    function: z.enum(ROLLUP_FUNCTIONS),
    description,
  }),
  z.strictObject({ type: z.literal('formula'), expression: z.string(), description }),
  z.strictObject({ type: z.literal('unique_id'), prefix: z.string().nullable(), description }),
]);

const iconSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('emoji'), emoji: name }),
  z.strictObject({ type: z.literal('icon'), name, color: z.enum(ICON_COLORS) }),
  z.strictObject({ type: z.literal('external'), url: name }),
]);

const databaseSchema = z.strictObject({
  title: name,
  icon: iconSchema.optional(),
  description,
  properties: z.record(name, propertySchema),
});

/**
 * How a binding slot is represented in the workspace: the same as in the binding file, but with
 * names.
 */
const representationSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('native'), property: name }),
  z.strictObject({
    kind: z.literal('relation'),
    twoWay: z.boolean(),
    property: name,
    database: name,
    syncedProperty: name.optional(),
  }),
  z.strictObject({ kind: z.literal('traversed'), rule: name, via: name }),
  z.strictObject({ kind: z.literal('page_body') }),
  z.strictObject({ kind: z.literal('gbrain') }),
  z.strictObject({ kind: z.literal('absent'), reason: name }),
]);

const optionNamesSchema = z.strictObject({
  canonical: z.record(name, name),
  known_non_canonical: z.record(name, name).optional(),
});

const bindingSchema = z.strictObject({
  /** Canonical type → database title. */
  data_sources: z.record(z.enum(CANONICAL_TYPES), name),
  /** Canonical type → canonical field → representation kind. */
  fields: z.record(z.enum(CANONICAL_TYPES), z.record(name, representationSchema)),
  /** `type.field` → canonical name → option name in the property. */
  options: z.record(name, optionNamesSchema),
  /** `type.signal` → formula name. */
  signals: z.partialRecord(z.enum(SIGNAL_SLOTS), name),
});

const contractSchema = z.strictObject({
  databases: z.array(databaseSchema),
  binding: bindingSchema,
});

/** The binding with names instead of ids. */
export type NamedBinding = z.infer<typeof bindingSchema>;

export type NamedRepresentation = z.infer<typeof representationSchema>;

export interface WorkspaceContract {
  /** The databases the workspace must have: the target of the build and the check. */
  readonly databases: readonly DatabaseShape[];
  readonly binding: NamedBinding;
}

/**
 * Reads the contract from a file. The result is a schema and a binding that agree with each other,
 * or a refusal listing all the problems.
 */
export function readWorkspaceContract(file: string): WorkspaceContract {
  return loadWorkspaceContract(readFileSync(file, 'utf8'), file);
}

/** Reads the contract from text. `origin` says in the refusal where the text comes from. */
export function loadWorkspaceContract(text: string, origin: string): WorkspaceContract {
  const document = parseDocument(text);
  // A duplicated key is not a YAML syntax error: the last one silently wins.
  const syntax = [...document.errors, ...document.warnings].map(
    (problem) => `yaml :: ${problem.message.split('\n')[0]}`,
  );

  if (syntax.length > 0) throw refusal(origin, syntax);

  const parsed = contractSchema.safeParse(document.toJS());

  if (!parsed.success) throw refusal(origin, parsed.error.issues.flatMap(problemsOf));

  const databases = parsed.data.databases.map(databaseOf);
  const problems = [
    ...schemaProblems(databases),
    ...bindingProblems(databases, parsed.data.binding),
  ];

  if (problems.length > 0) throw refusal(origin, problems);

  return { databases, binding: parsed.data.binding };
}

function refusal(origin: string, problems: readonly string[]): Error {
  return new Error(`${origin} is not a workspace contract:\n  ${problems.join('\n  ')}`);
}

function problemsOf(issue: z.core.$ZodIssue): string[] {
  const path = issue.path.map(String);

  if (issue.code === 'unrecognized_keys') {
    return issue.keys.map((key) => `${[...path, key].join('.')} :: Unrecognized key`);
  }

  return [`${path.join('.') || '(file)'} :: ${issue.message}`];
}

type ParsedDatabase = z.infer<typeof databaseSchema>;
type ParsedProperty = z.infer<typeof propertySchema>;

function databaseOf(database: ParsedDatabase): DatabaseShape {
  return {
    title: database.title,
    icon: database.icon ? iconOf(database.icon) : null,
    description: database.description ?? '',
    properties: new Map(
      Object.entries(database.properties).map(([key, property]) => [key, propertyOf(property)]),
    ),
  };
}

function iconOf(icon: NonNullable<ParsedDatabase['icon']>): IconShape {
  if (icon.type === 'emoji') return { type: 'emoji', emoji: icon.emoji };
  if (icon.type === 'icon') return { type: 'icon', name: icon.name, color: icon.color };

  return { type: 'external', url: icon.url };
}

function propertyOf(property: ParsedProperty): PropertyShape {
  const text = property.description ?? null;

  switch (property.type) {
    case 'number':
      return { description: text, type: 'number', format: property.format };
    case 'select':
    case 'multi_select':
    case 'status':
      return {
        description: text,
        type: property.type,
        options: property.options.map((option) => ({
          name: option.name,
          color: option.color,
          description: option.description ?? null,
        })),
      };
    case 'relation':
      return {
        description: text,
        type: 'relation',
        target: property.target,
        synced: property.synced,
      };
    case 'rollup':
      return {
        description: text,
        type: 'rollup',
        relation: property.relation,
        rollup: property.rollup,
        function: property.function,
      };
    case 'formula':
      return { description: text, type: 'formula', expression: property.expression };
    case 'unique_id':
      return { description: text, type: 'unique_id', prefix: property.prefix };
    default:
      return { description: text, type: property.type };
  }
}

type Databases = ReadonlyMap<string, DatabaseShape>;

/**
 * Returns the problems in the schema itself: titles, relations and their pairs, rollups over
 * existing properties.
 */
function schemaProblems(databases: readonly DatabaseShape[]): string[] {
  const byTitle: Databases = new Map(databases.map((database) => [database.title, database]));
  const repeated = databases.filter(
    ({ title }, index) => databases.findIndex((other) => other.title === title) !== index,
  );

  return [
    ...repeated.map(({ title }) => `databases :: title ${title} repeats`),
    ...databases.flatMap((database) => [
      ...titleProblems(database),
      ...[...database.properties].flatMap(([property, shape]) =>
        propertyProblems(database, property, shape, byTitle),
      ),
    ]),
  ];
}

function titleProblems(database: DatabaseShape): string[] {
  const titles = [...database.properties.values()].filter(({ type }) => type === 'title');

  return titles.length === 1 ? [] : [`${database.title} :: needs exactly one title property`];
}

function propertyProblems(
  database: DatabaseShape,
  name: string,
  property: PropertyShape,
  byTitle: Databases,
): string[] {
  const at = `${database.title}."${name}"`;

  if (property.type === 'relation') {
    const target = byTitle.get(property.target);

    if (target === undefined) return [`${at} :: relates to ${property.target}, which is not there`];

    return property.synced === null || pairs(database.title, name, target, property.synced)
      ? []
      : [`${at} :: ${property.target}."${property.synced}" is not its pair`];
  }

  if (property.type !== 'rollup') return [];

  const relation = database.properties.get(property.relation);

  if (relation?.type !== 'relation') {
    return [`${at} :: rollup names ${property.relation}, which is not a relation of the database`];
  }

  return byTitle.get(relation.target)?.properties.has(property.rollup)
    ? []
    : [`${at} :: rollup names ${relation.target}."${property.rollup}", which is not there`];
}

/**
 * Checks whether `paired` in `database` is a relation back to `source.property` that names it as
 * its pair.
 */
function pairs(source: string, property: string, database: DatabaseShape, paired: string): boolean {
  const back = database.properties.get(paired);

  return back?.type === 'relation' && back.target === source && back.synced === property;
}

function bindingProblems(databases: readonly DatabaseShape[], binding: NamedBinding): string[] {
  const byTitle: Databases = new Map(databases.map((database) => [database.title, database]));
  const titles = new Map(Object.entries(binding.data_sources));
  const fields = new Map(Object.entries(binding.fields));
  const databaseOfType = (type: string): DatabaseShape | undefined =>
    byTitle.get(titles.get(type) ?? '');

  return [
    ...[...titles].flatMap(([type, title]) =>
      byTitle.has(title) ? [] : [`binding.data_sources.${type} :: database ${title} is not there`],
    ),
    ...sharedDatabases(titles),
    ...[...fields].flatMap(([type, slots]) => {
      const database = databaseOfType(type);

      return Object.entries(slots).flatMap(([field, representation]) =>
        database === undefined
          ? []
          : slotProblems(`binding.fields.${type}.${field}`, database, representation, byTitle),
      );
    }),
    ...optionProblems(binding, fields, databaseOfType),
    ...signalProblems(binding, databaseOfType),
  ];
}

/**
 * Checks that one database does not back two types, because a page belongs to a type by the
 * database it lives in.
 */
function sharedDatabases(titles: ReadonlyMap<string, string>): string[] {
  const claimed = new Map<string, string>();

  return [...titles].flatMap(([type, title]) => {
    const first = claimed.get(title);

    claimed.set(title, first ?? type);

    return first === undefined ? [] : [`binding.data_sources.${type} :: ${title} is also ${first}`];
  });
}

function slotProblems(
  at: string,
  database: DatabaseShape,
  representation: NamedRepresentation,
  byTitle: Databases,
): string[] {
  switch (representation.kind) {
    case 'native':
      return database.properties.has(representation.property)
        ? []
        : [`${at} :: ${database.title}."${representation.property}" is not there`];

    case 'traversed':
      return database.properties.get(representation.via)?.type === 'relation'
        ? []
        : [`${at} :: ${database.title}."${representation.via}" is not a relation`];

    case 'relation':
      return relationSlotProblems(at, database, representation, byTitle);

    default:
      return [];
  }
}

function relationSlotProblems(
  at: string,
  database: DatabaseShape,
  slot: Extract<NamedRepresentation, { kind: 'relation' }>,
  byTitle: Databases,
): string[] {
  const property = database.properties.get(slot.property);

  if (property?.type !== 'relation' || property.target !== slot.database) {
    return [`${at} :: ${database.title}."${slot.property}" is not a relation to ${slot.database}`];
  }

  if (slot.twoWay !== (slot.syncedProperty !== undefined)) {
    return [`${at} :: a two-way slot names its pair, and a one-way slot does not`];
  }

  const target = byTitle.get(slot.database);

  if (slot.syncedProperty === undefined) return [];

  return target && property.synced === slot.syncedProperty
    ? []
    : [`${at} :: ${slot.database}."${slot.syncedProperty}" is not the pair of "${slot.property}"`];
}

function optionProblems(
  binding: NamedBinding,
  fields: ReadonlyMap<string, Readonly<Record<string, NamedRepresentation>>>,
  databaseOfType: (type: string) => DatabaseShape | undefined,
): string[] {
  return Object.entries(binding.options).flatMap(([slot, sets]) => {
    const [type = '', field = ''] = slot.split('.');
    const representation = fields.get(type)?.[field];
    const database = databaseOfType(type);

    if (representation?.kind !== 'native' || database === undefined) {
      return [`binding.options.${slot} :: ${slot} is not a native field`];
    }

    const property = database.properties.get(representation.property);
    const known = new Set(
      property && 'options' in property ? property.options.map((option) => option.name) : [],
    );

    return [...Object.values(sets.canonical), ...Object.values(sets.known_non_canonical ?? {})]
      .filter((option) => !known.has(option))
      .map(
        (option) => `binding.options.${slot} :: ${representation.property} has no option ${option}`,
      );
  });
}

function signalProblems(
  binding: NamedBinding,
  databaseOfType: (type: string) => DatabaseShape | undefined,
): string[] {
  return Object.entries(binding.signals).flatMap(([slot, property]) => {
    const database = databaseOfType(slot.split('.')[0] ?? '');

    return database?.properties.get(property)?.type === 'formula'
      ? []
      : [`binding.signals.${slot} :: ${property} is not a formula of its database`];
  });
}
