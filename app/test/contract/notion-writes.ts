import {
  CallExpression,
  isCallExpression,
  isIdentifier,
  isObjectLiteralExpression,
  isPropertyAccessExpression,
  isStringLiteral,
  isTemplateLiteralToken,
  Node,
} from 'typescript';
import { locationsIn, nodesIn } from './sources';

/**
 * Methods of the Notion client that write, as a chain of names by resource. Reads (`retrieve`,
 * `list`, `query`, `users.me`, `properties.retrieve`) are unrestricted.
 */
const WRITING_CHAINS: readonly (readonly string[])[] = [
  ['pages', 'create'],
  ['pages', 'update'],
  ['pages', 'move'],
  ['comments', 'create'],
  ['blocks', 'update'],
  ['blocks', 'delete'],
  ['blocks', 'children', 'append'],
  ['dataSources', 'create'],
  ['dataSources', 'update'],
  ['databases', 'create'],
  ['databases', 'update'],
  ['fileUploads'],
];

/** Fields of a page request that write its body. */
export const BODY_FIELDS: readonly string[] = [
  'children',
  'content',
  'markdown',
  'erase_content',
  'template',
];

/**
 * Returns the chain of names of a call:
 * `this.notion.pages.update(...)` → `this notion pages update`.
 */
function chainOf(call: CallExpression): string[] {
  const names: string[] = [];
  let node: Node = call.expression;

  while (isPropertyAccessExpression(node)) {
    names.unshift(node.name.text);
    node = node.expression;
  }

  if (isIdentifier(node)) names.unshift(node.text);

  return names;
}

function endsWith(chain: readonly string[], tail: readonly string[]): boolean {
  if (tail.length === 1) return chain.includes(tail[0]);

  return chain.slice(-tail.length).join('.') === tail.join('.');
}

interface WriteCall {
  readonly at: string;
  readonly chain: string;
  /** Names of the fields of the object passed as the first argument, if it is a literal. */
  readonly fields: readonly string[];
}

/** Checks whether a node is a call of a method that writes to Notion, on a client of any name. */
function isWriteCall(node: Node): node is CallExpression {
  if (!isCallExpression(node)) return false;

  const chain = chainOf(node);

  return WRITING_CHAINS.some((tail) => endsWith(chain, tail));
}

/** Returns the field names of the object passed as the first argument, if it is a literal. */
function fieldsOf(call: CallExpression): string[] {
  const [first] = call.arguments;

  return first && isObjectLiteralExpression(first)
    ? first.properties.flatMap((property) =>
        property.name && isIdentifier(property.name) ? [property.name.text] : [],
      )
    : [];
}

/** Finds every call of a method that writes to Notion. */
export function writeCallsIn(file: string, code: string): WriteCall[] {
  return nodesIn(file, code, isWriteCall).map(({ at, node }) => ({
    at,
    chain: chainOf(node).join('.'),
    fields: fieldsOf(node),
  }));
}

/** Lists the strings that address the Notion REST API directly, bypassing the client. */
export function rawNotionUrlsIn(file: string, code: string): string[] {
  return locationsIn(
    file,
    code,
    (node) =>
      (isStringLiteral(node) || isTemplateLiteralToken(node)) &&
      node.text.includes('api.notion.com'),
  );
}
