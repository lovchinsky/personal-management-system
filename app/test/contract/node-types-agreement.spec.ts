import { z } from 'zod';
import { repoFile } from './contracts';

/**
 * The Node types match the Node of the image: an `@types/node` newer than the runtime would let
 * code use an API that is not there, and the compiler would not catch it.
 */
const manifest = z
  .object({ devDependencies: z.record(z.string(), z.string()) })
  .parse(JSON.parse(repoFile('app/package.json')));
const dockerfile = repoFile('app/Dockerfile');

describe('the Node types and the image', () => {
  it('the `@types/node` major matches the `node` major in every Dockerfile stage', () => {
    const types = /\d+/.exec(manifest.devDependencies['@types/node'])?.[0];
    const stages = [...dockerfile.matchAll(/^FROM node:(\d+)-/gm)].map(([, major]) => major);

    expect(stages.length).toBeGreaterThan(0);
    expect(stages.filter((major) => major !== types)).toEqual([]);
  });
});
