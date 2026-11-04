import { z } from 'zod';
import { repoFile } from './contracts';

/**
 * Every lockfile package has `resolved` and `integrity`.
 *
 * `npm ci` checks a package's content against `integrity`; an entry without a hash is installed
 * unchecked, and a tarball swapped in the registry or the cache goes unnoticed. A lockfile built
 * over an already installed `node_modules` loses its hashes: npm takes such packages from disk,
 * not from the registry, and does not fill them in afterwards. The one exception is the root `""`,
 * the App itself, which is not in the registry.
 */
const lockfile = z
  .object({
    packages: z.record(
      z.string(),
      z.object({ resolved: z.string().optional(), integrity: z.string().optional() }),
    ),
  })
  .parse(JSON.parse(repoFile('app/package-lock.json')));

type Packages = typeof lockfile.packages;

/**
 * Lists the entries that `npm ci` cannot check: those without a tarball URL or without a hash.
 */
function unverifiable(packages: Packages): string[] {
  return Object.entries(packages)
    .filter(([path, entry]) => path !== '' && !(entry.resolved && entry.integrity))
    .map(([path]) => path);
}

describe('lockfile integrity', () => {
  it('every package has `resolved` and `integrity`', () => {
    expect(Object.keys(lockfile.packages).length).toBeGreaterThan(1);
    expect(unverifiable(lockfile.packages)).toEqual([]);
  });

  /** Otherwise a rule that catches nothing would pass the check above silently. */
  it('the rule catches entries without a hash or an address and lets the root through', () => {
    const packages: Packages = {
      '': {},
      'node_modules/whole': {
        resolved: 'https://registry.npmjs.org/whole/-/whole-1.0.0.tgz',
        integrity: 'sha512-x',
      },
      'node_modules/no-hash': {
        resolved: 'https://registry.npmjs.org/no-hash/-/no-hash-1.0.0.tgz',
      },
      'node_modules/no-address': { integrity: 'sha512-x' },
      'node_modules/bare': {},
    };

    expect(unverifiable(packages)).toEqual([
      'node_modules/no-hash',
      'node_modules/no-address',
      'node_modules/bare',
    ]);
  });
});
