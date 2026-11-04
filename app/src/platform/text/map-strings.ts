/**
 * Returns the same record with every text value at every level replaced by the result of `map`.
 * The arguments of tool calls can be nested (a list, an object), so the traversal descends; the
 * remaining values (numbers, `null`, booleans) stay as they are.
 */
export function mapStrings(record: object, map: (text: string) => string): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]): [string, unknown] => [key, mapValue(value, map)]),
  );
}

function mapValue(value: unknown, map: (text: string) => string): unknown {
  if (typeof value === 'string') return map(value);

  if (Array.isArray(value)) return value.map((item): unknown => mapValue(item, map));

  return typeof value === 'object' && value !== null ? mapStrings(value, map) : value;
}
