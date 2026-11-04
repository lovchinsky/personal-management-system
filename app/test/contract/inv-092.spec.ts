import { resolve } from 'node:path';
import {
  EntityName,
  forEachChild,
  isIdentifier,
  isParameter,
  isTypeReferenceNode,
  Node,
} from 'typescript';
import { appSources, locations, locationsIn, SRC, within } from './sources';

/** The App MCP transport: its tools accept the wire shape by design. */
const MCP_SERVER = resolve(SRC, 'mcp/server');

/**
 * Checks whether the file is a capability's wire module: the tool schemas and the translation
 * between wire and domain.
 */
function isWireModule(file: string): boolean {
  return file.endsWith('.wire.ts');
}

function nameOf(name: EntityName): string {
  return isIdentifier(name) ? name.text : name.right.text;
}

/**
 * Checks whether the type names a wire shape: by itself, in a union, an array or a type argument.
 */
function namesWire(type: Node): boolean {
  if (isTypeReferenceNode(type) && nameOf(type.typeName).endsWith('Wire')) return true;

  return forEachChild(type, (child) => (namesWire(child) ? true : undefined)) ?? false;
}

/**
 * Checks whether the node is a parameter with a wire type, in a function, a method, a constructor
 * or an arrow function. A return type and an interface field are not input but a kind of response
 * that the capability returns itself.
 */
function isWireParameter(node: Node): boolean {
  return isParameter(node) && node.type !== undefined && namesWire(node.type);
}

function wireParametersIn(file: string, code: string): string[] {
  return locationsIn(file, code, isWireParameter);
}

function wireParameters(file: string): string[] {
  return locations(file, isWireParameter);
}

/**
 * `INV-092` Only App MCP tools and a capability's wire module (`*.wire.ts`) see the wire shape of
 * App MCP input. A capability service accepts the domain shape from a tool and from any other
 * caller alike.
 */
describe('INV-092', () => {
  const outside = appSources().filter((file) => !within(MCP_SERVER, file) && !isWireModule(file));

  it('outside the tools and wire modules no parameter has a wire type', () => {
    expect(outside.flatMap(wireParameters)).toEqual([]);
  });

  /** Otherwise an empty walk or a blind scanner would pass the check above silently. */
  it('finds the capability services and the wire shape where it exists', () => {
    expect(outside).toEqual(
      expect.arrayContaining([
        resolve(SRC, 'approvals/approvals.service.ts'),
        resolve(SRC, 'attention/attention.service.ts'),
        resolve(SRC, 'capture/capture.service.ts'),
        resolve(SRC, 'continuations/continuations.service.ts'),
        resolve(SRC, 'delivery/delivery.service.ts'),
      ]),
    );
    expect(wireParameters(resolve(MCP_SERVER, 'tools/attention.tools.ts'))).not.toHaveLength(0);
    expect(wireParameters(resolve(SRC, 'continuations/continuation.wire.ts'))).not.toHaveLength(0);
  });

  /** A scanner blind to one form would let that form through. */
  it('recognizes every form of parameter, but not a kind of response or a comment', () => {
    const forms: string[] = [
      'function f(query: DeliveryQueryWire) {}',
      'const f = (requests: readonly CommentWire[]) => requests;',
      'class S { state(query: ContinuationQueryWire | undefined) {} }',
      'class S { constructor(readonly proposal: ProposalWire) {} }',
      "function f(query: Pick<ContinuationQueryWire, 'page_id'>) {}",
      'function f(comment: wire.CommentWire) {}',
    ];
    const answers: string[] = [
      'function f(): DeliveryStateWire { return state; }',
      'interface Answer { readonly state: DeliveryStateWire }',
      '// state(query: DeliveryQueryWire)\n',
    ];

    expect(forms.filter((code) => wireParametersIn('probe.ts', code).length === 0)).toEqual([]);
    expect(answers.flatMap((code) => wireParametersIn('probe.ts', code))).toEqual([]);
  });
});
