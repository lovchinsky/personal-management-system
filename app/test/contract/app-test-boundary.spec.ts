import { resolve } from 'node:path';
import { APP, appSources, importsOf } from './sources';

const TESTS = resolve(APP, 'test');

/**
 * App code that ships in the image imports nothing from the tests. The gate is an acceptance test
 * (`app/test/gate/`). It imports the App and the App knows nothing of it, so the production image
 * builds completely without the tests.
 */
describe('the boundary between the App and the tests', () => {
  it('App code does not import from test/', () => {
    const crossing = appSources().flatMap((file) =>
      importsOf(file)
        .filter(({ target }) => target !== null && target.startsWith(`${TESTS}/`))
        .map(({ edge }) => edge),
    );

    expect(crossing).toEqual([]);
  });

  /** Without this, a walk that sees no import at all would pass silently. */
  it('finds the imports of App code', () => {
    expect(appSources().some((file) => importsOf(file).some(({ target }) => target !== null))).toBe(
      true,
    );
  });
});
