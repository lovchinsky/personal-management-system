import { resolve } from 'node:path';
import { isIdentifier, Node } from 'typescript';
import { appSources, importsOf, locations, SRC, within } from './sources';

const BINDING = resolve(SRC, 'notion/binding');
const SEMANTICS = resolve(SRC, 'notion/semantics');
const WORKSPACE = resolve(SRC, 'notion/workspace');
const PROPERTY_ID = resolve(SRC, 'notion/client/property-id.ts');

/**
 * Checks whether a path is a Nest module, which is DI wiring. A Nest module can be imported from
 * anywhere, because it does not expose the binding.
 */
function isModuleFile(path: string): boolean {
  return path.endsWith('.module.ts');
}

/** Lists the accesses to the binding outside its owners: everything except Nest modules. */
function bindingReadsOutside(file: string): string[] {
  return importsOf(file)
    .filter(({ target }) => target !== null && within(BINDING, target) && !isModuleFile(target))
    .map(({ edge }) => edge);
}

/** The names a string is decoded by: only `property-id.ts` should translate the ID shape. */
const DECODERS: ReadonlySet<string> = new Set(['decodeURIComponent', 'decodeURI']);

/**
 * Checks whether a node names a decoder. A decoder appears not only as a direct call:
 * `.transform(...)`, `.map(...)` or `globalThis.` decode the same way.
 */
function namesDecoder(node: Node): boolean {
  return isIdentifier(node) && DECODERS.has(node.text);
}

function decodingCalls(file: string): string[] {
  return locations(file, namesDecoder);
}

/**
 * Lists the imports of `notion/workspace/` from the rest of the App. The `notion` command reaches
 * this directory, not the running App.
 */
function workspaceUses(file: string): string[] {
  return importsOf(file)
    .filter(({ target }) => target !== null && within(WORKSPACE, target))
    .map(({ edge }) => edge);
}

/**
 * `INV-081` Only `notion/binding/` and `notion/semantics/` read the binding, and only
 * `notion/client/property-id.ts` translates the shape of a property ID. `notion/workspace/` knows
 * the format of the binding file in order to write it; the running App does not load this
 * directory.
 */
describe('INV-081', () => {
  const shipped = appSources();
  const outside = shipped.filter(
    (file) => !within(BINDING, file) && !within(SEMANTICS, file) && !within(WORKSPACE, file),
  );

  it('nothing outside binding/, semantics/ and workspace/ reads the binding', () => {
    expect(outside.flatMap(bindingReadsOutside)).toEqual([]);
  });

  it('the running App does not load workspace/: the notion command and the gate reach it', () => {
    expect(shipped.filter((file) => !within(WORKSPACE, file)).flatMap(workspaceUses)).toEqual([]);
  });

  it('only property-id.ts translates the shape of a property ID', () => {
    const translating = shipped.filter((file) => file !== PROPERTY_ID).flatMap(decodingCalls);

    expect(translating).toEqual([]);
  });

  /** Without this, an empty walk or a blind scanner would pass the check above silently. */
  it('finds the code and the accesses it checks', () => {
    expect(outside).toContain(resolve(SRC, 'intake/notion/relevance.gate.ts'));
    expect(decodingCalls(PROPERTY_ID)).not.toHaveLength(0);
    expect(bindingReadsOutside(resolve(SEMANTICS, 'semantic.adapter.ts')).length).toBeGreaterThan(
      0,
    );
    expect(bindingReadsOutside(resolve(WORKSPACE, 'workspace-binding.ts')).length).toBeGreaterThan(
      0,
    );
    expect(workspaceUses(resolve(WORKSPACE, 'workspace-command.ts')).length).toBeGreaterThan(0);
  });
});
