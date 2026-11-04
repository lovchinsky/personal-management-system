import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { composeFile, REPO_ROOT } from './contracts';
import { CHAT_PLUGIN_ROOT, RUNNER_PLUGIN_ROOT } from './plugin-files';

/**
 * `INV-075` The App Docker build context is the repository root, not `app/`: the image takes the
 * runner plugin from `app/` and the knowledge from `plugin/`, so a narrower context puts the
 * behavior contract out of the build's reach.
 */
describe('INV-075', () => {
  const compose = composeFile('infra/compose.yaml');

  it('the App build context resolves to the repository root', () => {
    const context = compose.services.app?.build?.context;

    expect(context).toBeDefined();
    expect(resolve(REPO_ROOT, 'infra', context ?? '.')).toBe(REPO_ROOT);
  });

  it('both sources of the behavior contract exist in this context', () => {
    expect(existsSync(RUNNER_PLUGIN_ROOT)).toBe(true);
    expect(existsSync(CHAT_PLUGIN_ROOT)).toBe(true);
  });
});
