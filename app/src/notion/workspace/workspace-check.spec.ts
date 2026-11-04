import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { FakeNotion } from '../../../test/fixtures/fake-notion-workspace.fixture';
import { buildWorkspace } from './workspace-build';
import { checkWorkspace } from './workspace-check';
import { readWorkspaceContract } from './workspace-contract';
import { installationFiles, type InstallationFiles } from './workspace-installation';

const CONTRACT = readWorkspaceContract(
  resolve(__dirname, '../../../../contracts/notion-workspace.yaml'),
);

/** The contract's formulas: columns that REST creates empty. */
const FORMULAS = CONTRACT.databases.flatMap(({ title, properties }) =>
  [...properties]
    .filter(([, property]) => property.type === 'formula')
    .map(([name]) => `${title}."${name}"`),
);

describe('notion check', () => {
  let folder: string;
  let files: InstallationFiles;
  let lines: string[];
  const log = (line: string): void => {
    lines.push(line);
  };

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'notion-workspace-'));
    files = installationFiles(join(folder, 'mapping.yaml'));
    lines = [];
  });

  afterEach(() => {
    rmSync(folder, { recursive: true, force: true });
  });

  const build = (fake: FakeNotion) =>
    buildWorkspace({
      personal: fake.client,
      integration: fake.integration,
      contract: CONTRACT,
      files,
      log,
    });

  const snapshot = (): Record<string, string> =>
    Object.fromEntries(
      readdirSync(folder).map((name) => [name, readFileSync(join(folder, name), 'utf8')]),
    );

  describe('the check', () => {
    const check = (fake: FakeNotion) =>
      checkWorkspace({ notion: fake.client, contract: CONTRACT, bindingFile: files.binding, log });

    it('finds a built workspace matching the contract and reports the formulas as optional', async () => {
      const fake = new FakeNotion();

      await build(fake);
      lines = [];

      const report = await check(fake);

      expect(report.differences).toEqual([]);
      expect(report.formulas.length).toBe(FORMULAS.length);
      expect(lines.at(-1)).toBe('the schema matches the contract');
      expect(lines.filter((line) => line.includes('optional'))).toHaveLength(FORMULAS.length);
    });

    it('names how the schema differs and writes nothing', async () => {
      const fake = new FakeNotion();

      await build(fake);
      fake.setProperty('Tasks', 'Deadline', null);
      fake.setProperty('Tasks', 'Extra', { description: null, type: 'rich_text' });
      fake.setProperty('Tasks', 'Date', { description: null, type: 'rich_text' });

      const before = snapshot();
      const written = fake.writes.length;
      const report = await check(fake);

      expect(report.differences).toEqual([
        expect.stringMatching(/^Tasks\."Date" differs/),
        'Tasks."Deadline" is missing',
        'Tasks."Extra" is not in the target',
      ]);
      expect(snapshot()).toEqual(before);
      expect(fake.writes).toHaveLength(written);
    });

    it('refuses with advice when there is no binding', async () => {
      await expect(check(new FakeNotion())).rejects.toThrow(/does not exist: build the workspace/);
    });

    it('refuses a binding of another workspace', async () => {
      const fake = new FakeNotion('workspace-1');

      writeFileSync(files.binding, 'workspace: other-workspace\ndata_sources:\n  task: ds-1\n');

      await expect(check(fake)).rejects.toThrow(/belongs to workspace other-workspace/);
    });
  });
});
