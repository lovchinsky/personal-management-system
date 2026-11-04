import { assertGateEnvironment, exitCodeOf, GATE_DATABASE, GATE_MAPPING_FILE } from './gate-boot';

/** The environment the `gate` service sets in Compose. */
const GATE: NodeJS.ProcessEnv = {
  DATABASE_URL: `postgresql://app_user:secret@postgres:5432/${GATE_DATABASE}`,
  NOTION_API_TOKEN: 'ntn_gate',
  NOTION_MAPPING_FILE: GATE_MAPPING_FILE,
  GBRAIN_CLIENT_ID: 'gate-client',
  GBRAIN_CLIENT_SECRET: 'gate-secret',
};

describe('the gate environment', () => {
  it('lets the gate environment through', () => {
    expect(() => assertGateEnvironment(GATE)).not.toThrow();
  });

  it.each([
    [
      'main database',
      { DATABASE_URL: 'postgresql://app_user:secret@postgres:5432/app_db' },
      'app_db',
    ],
    ['no database', { DATABASE_URL: undefined }, 'no database'],
    ['no token', { NOTION_API_TOKEN: '' }, 'NOTION_API_TOKEN is empty'],
    [
      'main binding',
      { NOTION_MAPPING_FILE: '/etc/app/notion-mapping.yaml' },
      'NOTION_MAPPING_FILE',
    ],
    ['no gate GBrain client', { GBRAIN_CLIENT_SECRET: '' }, 'GBrain client'],
  ])('%s: the environment is refused', (_name, change, says) => {
    expect(() => assertGateEnvironment({ ...GATE, ...change })).toThrow(says);
  });
});

/**
 * The exit code is a contract with `infra/bin/gate`: the code distinguishes “not proven” from
 * “residue remains”.
 */
describe('the gate exit code', () => {
  it.each([
    [{ ok: true, clean: true }, 0],
    [{ ok: false, clean: true }, 1],
    [{ ok: false, clean: false }, 1],
    [{ ok: true, clean: false }, 3],
  ])('%j → %i', (result, code) => {
    expect(exitCodeOf(result)).toBe(code);
  });
});
