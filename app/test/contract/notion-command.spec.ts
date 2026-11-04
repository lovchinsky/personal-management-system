import { existsSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import { composeFile, REPO_ROOT, repoFile } from './contracts';

/** The entry point of the command as Compose launches it: a file of the built image in `/app`. */
const ENTRY = 'dist/src/notion/workspace/workspace-command.js';

/**
 * The `notion` command (ADR 0048) is a Compose service, an entry point in the code and files in
 * the image at the same time. Compose launches the compiled command, which writes the binding to
 * the directory the App reads it from, and the image contains the contracts the command reads. If
 * any of these diverged, the command would fail in the installation, not in a check.
 */
describe('the notion command', () => {
  const compose = composeFile('infra/compose.yaml');
  const notion = compose.services.notion;

  it('Compose launches the compiled entry point from the App code; `up` does not start it', () => {
    expect(notion?.entrypoint?.at(-1)).toBe(ENTRY);
    expect(
      existsSync(resolve(REPO_ROOT, 'app', ENTRY.replace(/^dist\//, '').replace(/\.js$/, '.ts'))),
    ).toBe(true);
    expect(notion?.profiles).toEqual(['notion']);
  });

  it('writes only to the directory the App reads the binding from', () => {
    const mounts = notion?.volumes ?? [];
    const [mount] = mounts;
    const binding = notion?.environment?.NOTION_MAPPING_FILE ?? '';

    expect(mounts).toHaveLength(1);
    if (mount === undefined || typeof mount === 'string') throw new Error('no long-form mount');

    expect(posix.dirname(binding)).toBe(mount.target);
    expect(posix.normalize(compose.configs?.['notion_mapping']?.file ?? '')).toBe(
      posix.join(mount.source, posix.basename(binding)),
    );
  });

  it('only the command receives the personal Notion token', () => {
    const holders = Object.entries(compose.services)
      .filter(([, service]) => 'NOTION_PERSONAL_TOKEN' in (service.environment ?? {}))
      .map(([name]) => name);

    expect(holders).toEqual(['notion']);
  });

  it('the App image contains both contracts the command reads, and the build lets them through', () => {
    const dockerfile = repoFile('app/Dockerfile');
    const copy = dockerfile.indexOf(
      'COPY --chown=node:node contracts/notion-workspace.yaml contracts/canonical.yaml ./contracts/',
    );

    expect(copy).toBeGreaterThan(dockerfile.indexOf('FROM node:22-alpine AS app-base'));
    expect(copy).toBeLessThan(dockerfile.indexOf('FROM app-base AS gate'));
    expect(repoFile('.dockerignore')).toMatch(
      /^!contracts\/notion-workspace\.yaml$[\s\S]*^!contracts\/canonical\.yaml$/m,
    );
  });
});
