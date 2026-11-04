import { resolve } from 'node:path';
import { GENERATED, importsOf, shippedSources, SRC, within } from './sources';

const PLATFORM = resolve(SRC, 'platform');

/**
 * `INV-078` `platform/` imports no App module except the generated Prisma client: modules depend on
 * it, not the other way around.
 */
describe('INV-078', () => {
  const imports = shippedSources(PLATFORM).flatMap(importsOf);

  it('from the App code, platform/ imports only itself and the generated Prisma client', () => {
    const foreign = imports
      .filter(
        ({ target }) => target !== null && !within(PLATFORM, target) && !within(GENERATED, target),
      )
      .map(({ edge }) => edge);

    expect(foreign).toEqual([]);
  });

  /** Without this, an empty walk of the directory would pass the check above silently. */
  it('finds the imports it checks', () => {
    expect(imports.map(({ target }) => target)).toContain(
      resolve(PLATFORM, 'db/prisma.service.ts'),
    );
  });
});
