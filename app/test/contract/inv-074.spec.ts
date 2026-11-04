import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { REPO_ROOT } from './contracts';

/**
 * `INV-074` Docker Compose, Caddy, infrastructure env files, DB bootstrap and infrastructure
 * wrappers live under `infra/`, not in the repository root.
 */
describe('INV-074', () => {
  const INFRASTRUCTURE = /^(docker-)?compose.*\.ya?ml$|^Caddyfile$|^\.env/;

  it('the repository root has no infrastructure files', () => {
    const stray = readdirSync(REPO_ROOT).filter((entry) => INFRASTRUCTURE.test(entry));

    expect(stray).toEqual([]);
  });

  it('the infrastructure files live under infra/', () => {
    const infra = readdirSync(resolve(REPO_ROOT, 'infra'));

    expect(infra.filter((entry) => INFRASTRUCTURE.test(entry)).length).toBeGreaterThan(0);
    expect(existsSync(resolve(REPO_ROOT, 'infra/caddy'))).toBe(true);
  });
});
