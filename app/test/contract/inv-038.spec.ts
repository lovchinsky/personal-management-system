import { bindingOf } from '../../src/notion/binding/binding';
import { schemaMappingOf, SchemaMappingWire } from '../../src/notion/semantics/schema-mapping';
import { liveSchemasOf } from '../fixtures/live-schemas.fixture';
import { VALID_BINDING_FILE } from '../fixtures/notion-mapping.fixture';
import { pluginFiles } from './plugin-files';

/** A Notion identifier is a uuid with or without hyphens: a database, property or page id. */
const NOTION_ID = /\b[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}\b/i;

/** A Notion property id in the percent-encoded form in which REST returns it (`K%7BhG`). */
const ENCODED_PROPERTY_ID = /%[0-9A-F]{2}/;

/**
 * Lists what the response leaves unnamed: a property id without a name or an option without a
 * label.
 */
function unnamed(wire: SchemaMappingWire): string[] {
  return wire.types.flatMap(({ semantics, signals }) => [
    ...semantics.flatMap(({ slot, carrier, options }) => [
      ...((carrier.kind === 'native' || carrier.kind === 'relation') && carrier.name === undefined
        ? [slot]
        : []),
      ...(carrier.kind === 'relation' &&
      carrier.synced_property_id !== undefined &&
      carrier.synced_name === undefined
        ? [`${slot} synced`]
        : []),
      ...(carrier.kind === 'traversed' && carrier.via_name === undefined ? [`${slot} via`] : []),
      ...[
        ...Object.keys(options?.canonical ?? {}),
        ...Object.keys(options?.known_non_canonical ?? {}),
      ]
        .filter((name) => options?.labels[name] === undefined)
        .map((name) => `${slot} ${name}`),
    ]),
    ...signals.filter((signal) => signal.name === undefined).map(({ slot }) => slot),
  ]);
}

/**
 * `INV-038` The Skill operates on canonical semantics; physical names come from
 * `get_schema_mapping`.
 *
 * The check has two parts. The static part checks that the plugin's text has no physical Notion
 * identifiers, because the binding lives in the installation's environment, not in the Skill,
 * which stays independent of the workspace. The structural part checks that, over a live schema
 * that has every property of the binding, the response includes a name for every property id and
 * a label for every option.
 */
describe('INV-038', () => {
  it('the plugin contains no physical Notion identifiers', () => {
    const files = pluginFiles();
    const physical = files
      .filter((file) => NOTION_ID.test(file.text) || ENCODED_PROPERTY_ID.test(file.text))
      .map((file) => file.path);

    expect(files.length).toBeGreaterThan(0);
    expect(physical).toEqual([]);
  });

  it('get_schema_mapping returns a name for every property id and a label for every option', () => {
    const binding = bindingOf(VALID_BINDING_FILE, 'test');
    const wire = schemaMappingOf(
      binding,
      liveSchemasOf(binding, (id) => `назва ${id}`),
    );

    expect(unnamed(wire)).toEqual([]);
  });
});
