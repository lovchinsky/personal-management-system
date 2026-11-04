import { z } from 'zod';
import { repoFile } from './contracts';

/**
 * `INV-305` The image contains exactly one SDK CLI binary — the one for its own libc.
 *
 * The binary arrives as an optional dependency pinned to the SDK version. `npm ci` selects by
 * `libc` only when the lockfile keeps that field; without it the alpine image pulls in the glibc
 * variant too, which does not run there.
 */
const lockfile = z
  .object({
    packages: z.record(
      z.string(),
      z.object({ version: z.string().optional(), libc: z.array(z.string()).optional() }),
    ),
  })
  .parse(JSON.parse(repoFile('app/package-lock.json')));
const manifest = z
  .object({ dependencies: z.record(z.string(), z.string()) })
  .parse(JSON.parse(repoFile('app/package.json')));
const dockerfile = repoFile('app/Dockerfile');
const SDK = '@anthropic-ai/claude-agent-sdk';

describe('INV-305', () => {
  it('the SDK is pinned exactly, and the lockfile has the same version', () => {
    const pinned = manifest.dependencies[SDK];

    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
    expect(lockfile.packages[`node_modules/${SDK}`]?.version).toBe(pinned);
  });

  it('every linux binary in the lockfile has its own libc', () => {
    const linux = Object.entries(lockfile.packages).filter(([path]) =>
      path.startsWith(`node_modules/${SDK}-linux-`),
    );
    const wrong = linux
      .filter(([path, entry]) => {
        const expected = path.endsWith('-musl') ? ['musl'] : ['glibc'];

        return JSON.stringify(entry.libc) !== JSON.stringify(expected);
      })
      .map(([path]) => path);

    expect(linux.length).toBeGreaterThan(0);
    expect(wrong).toEqual([]);
  });

  it('the image installs dependencies without --omit=optional and on musl', () => {
    expect(dockerfile).not.toMatch(/--omit=optional/);
    // The main image and the gate image share one base, alpine, so the CLI binary is the musl one.
    expect(dockerfile).toMatch(/^FROM node:\d+-alpine AS app-base$/m);
    expect(dockerfile).toMatch(/^FROM app-base AS runtime$/m);
    expect(dockerfile).toMatch(/^RUN npm ci --omit=dev /m);
  });
});
