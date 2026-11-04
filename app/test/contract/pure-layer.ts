import { isIdentifier, isTypeReferenceNode, type Node } from 'typescript';

/**
 * The expressions a pure layer must not contain: the network, the process environment, the clock
 * and randomness. A layer's rule answers a question about what was just read, so any of them would
 * make the answer depend on something that did not come with what was read. The layers that must
 * be pure share this list: `methodology/` (`INV-094`) and `knowledge/` (`INV-099`).
 */
const IMPURE: ReadonlySet<string> = new Set([
  'fetch',
  'process',
  'require',
  'setTimeout',
  'setInterval',
  'Date',
  'Math',
  'performance',
  'crypto',
  'console',
  'Intl',
  'globalThis',
]);

/**
 * Checks whether a node is the identifier of an impure global in an expression (in a type
 * position it runs nothing).
 */
export const isImpureExpression = (node: Node): node is Node =>
  isIdentifier(node) && IMPURE.has(node.text) && !isTypeReferenceNode(node.parent);
