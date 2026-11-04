import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';
import { FakeNotion } from '../../../test/fixtures/fake-notion-workspace.fixture';
import { bindingFileSchema } from '../binding/binding.schema';
import { loadBinding } from '../binding/load-binding';
import { buildWorkspace } from './workspace-build';
import { readWorkspaceContract } from './workspace-contract';
import { installationFiles, type InstallationFiles } from './workspace-installation';
import { readLedger } from './workspace-ledger';
import { differences } from './workspace-schema';

const CONTRACT = readWorkspaceContract(
  resolve(__dirname, '../../../../contracts/notion-workspace.yaml'),
);

const TITLES = CONTRACT.databases.map(({ title }) => title);

/** The contract's formulas: columns that REST creates empty. */
const FORMULAS = CONTRACT.databases.flatMap(({ title, properties }) =>
  [...properties]
    .filter(([, property]) => property.type === 'formula')
    .map(([name]) => `${title}."${name}"`),
);

/** Returns a formula's expression from the contract: what the person pastes into Notion. */
function expressionOf(database: string, property: string): string {
  const shape = CONTRACT.databases
    .find(({ title }) => title === database)
    ?.properties.get(property);

  if (shape?.type !== 'formula') throw new Error(`${database}."${property}" is not a formula`);

  return shape.expression;
}

describe('notion build', () => {
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

  describe('the build', () => {
    it('creates every contract database at the top level, checks them against the contract and writes the binding', async () => {
      const fake = new FakeNotion();

      const report = await build(fake);

      expect(report.workspace).toBe('workspace-1');
      expect(
        fake
          .shapes()
          .map(({ title }) => title)
          .sort(),
      ).toEqual([...TITLES].sort());
      expect(fake.writes.filter((write) => write.startsWith('create ')).sort()).toEqual(
        TITLES.map((title) => `create ${title} at the top level`).sort(),
      );
      expect(differences(CONTRACT.databases, fake.live())).toEqual([]);
      expect([...readLedger(files.ledger).keys()].sort()).toEqual([...TITLES].sort());

      const text = readFileSync(files.binding, 'utf8');

      expect(() => loadBinding(text, files.binding)).not.toThrow();
      expect(bindingFileSchema.parse(parse(text)).workspace).toBe('workspace-1');
    });

    it('leaves the formulas empty, puts their text in a file and says they are optional', async () => {
      const fake = new FakeNotion();

      const report = await build(fake);
      const formulas = readFileSync(files.formulas, 'utf8');

      expect(report.formulas.map(({ database, property }) => `${database}."${property}"`)).toEqual(
        FORMULAS,
      );
      expect(FORMULAS.length).toBeGreaterThan(0);

      for (const { database, property, expression } of report.formulas) {
        expect(formulas).toContain(`## ${database} → ${property}`);
        expect(formulas).toContain(expression);
      }

      expect(formulas).toMatch(/optional/);
      expect(lines.join('\n')).toMatch(/optional.*entered by hand/s);
      expect(lines.join('\n')).toMatch(/run `notion build` again/);
    });

    it('keeps a signal with an empty formula out of the binding and includes one whose formula is entered', async () => {
      const fake = new FakeNotion();
      const signalsOf = (): string[] =>
        Object.keys(
          bindingFileSchema.parse(parse(readFileSync(files.binding, 'utf8'))).signals ?? {},
        );

      const first = await build(fake);

      expect(signalsOf()).toEqual([]);
      expect(first.unbound).toEqual(Object.keys(CONTRACT.binding.signals));

      const written = fake.writes.length;

      fake.enterFormula('Tasks', 'Blocked', expressionOf('Tasks', 'Blocked'));
      fake.enterFormula('Habits', 'Streak', expressionOf('Habits', 'Streak'));

      const second = await build(fake);

      expect(signalsOf().sort()).toEqual(['behavior_system.streak', 'task.blocked']);
      expect(second.unbound).not.toContain('task.blocked');
      expect(readFileSync(files.formulas, 'utf8')).not.toContain('## Tasks → Blocked');
      // The command neither writes nor overwrites an entered expression, so the second build makes
      // no changes in Notion.
      expect(fake.writes).toHaveLength(written);
    });

    it('creates no database twice, thanks to the ledger: building again creates and changes nothing', async () => {
      const fake = new FakeNotion();

      await build(fake);

      const written = fake.writes.length;
      const before = snapshot();

      await build(fake);

      expect(fake.writes).toHaveLength(written);
      expect(snapshot()).toEqual(before);
    });

    it('resumes an interrupted build from the ledger without duplicating databases', async () => {
      const fake = new FakeNotion();

      fake.breakAfter(4);

      await expect(build(fake)).rejects.toThrow(/network is down/);
      expect(readLedger(files.ledger).size).toBe(4);

      fake.breakAfter(null);
      await build(fake);

      const created = fake.writes.filter((write) => write.startsWith('create '));

      expect(created).toHaveLength(TITLES.length);
      expect(new Set(created).size).toBe(TITLES.length);
      expect(differences(CONTRACT.databases, fake.live())).toEqual([]);
    });

    it('creates a ledger database again when it was trashed before the relations were built', async () => {
      const fake = new FakeNotion();

      fake.breakAfter(3);
      await expect(build(fake)).rejects.toThrow(/network is down/);
      fake.trash('Context');
      fake.breakAfter(null);
      await build(fake);

      expect(fake.writes.filter((write) => write.startsWith('create Context'))).toHaveLength(2);
      expect(differences(CONTRACT.databases, fake.live())).toEqual([]);
    });

    it('refuses tokens from different workspaces before the first write call', async () => {
      const fake = new FakeNotion('workspace-1', 'workspace-2');

      await expect(build(fake)).rejects.toThrow(/belong to different workspaces/);
      expect(fake.writes).toEqual([]);
      expect(readdirSync(folder)).toEqual([]);
    });

    it('names a database the integration does not see, and building again once the integration is given access completes the binding', async () => {
      const fake = new FakeNotion();

      fake.hide('Inbox');
      fake.hide('Tags');

      await expect(build(fake)).rejects.toThrow(
        /does not see .*Inbox.*Tags|does not see .*Tags.*Inbox/,
      );
      expect(readdirSync(folder)).not.toContain('mapping.yaml');

      const created = fake.writes.filter((write) => write.startsWith('create ')).length;

      fake.show('Inbox');
      fake.show('Tags');
      await build(fake);

      expect(fake.writes.filter((write) => write.startsWith('create '))).toHaveLength(created);
      expect(readdirSync(folder)).toContain('mapping.yaml');
    });

    it('refuses a ledger that keeps something other than database titles, before anything is created', async () => {
      const fake = new FakeNotion();

      writeFileSync(files.ledger, 'data_sources:\n  20a47b10-0000-0000-0000-000000000000: ds-1\n');

      await expect(build(fake)).rejects.toThrow(/the ledger names 20a47b10.*keeps database titles/);
      expect(fake.writes).toEqual([]);
    });

    it('does not overwrite a binding of another workspace and builds nothing', async () => {
      const fake = new FakeNotion('workspace-1');
      const foreign = 'workspace: other-workspace\ndata_sources: {}\n';

      writeFileSync(files.binding, foreign);

      await expect(build(fake)).rejects.toThrow(/belongs to workspace other-workspace/);
      expect(fake.writes).toEqual([]);
      expect(readFileSync(files.binding, 'utf8')).toBe(foreign);
    });

    it('does not overwrite a binding without a workspace name either', async () => {
      const fake = new FakeNotion();
      const skeleton = 'workspace: null\ndata_sources: {}\n';

      writeFileSync(files.binding, skeleton);

      await expect(build(fake)).rejects.toThrow(/belongs to no named workspace/);
      expect(readFileSync(files.binding, 'utf8')).toBe(skeleton);
    });

    it('rewrites a binding of the same workspace that was built here', async () => {
      const fake = new FakeNotion('workspace-1');

      await build(fake);
      writeFileSync(files.binding, 'workspace: workspace-1\ndata_sources: {}\n');
      await build(fake);

      expect(() => loadBinding(readFileSync(files.binding, 'utf8'), files.binding)).not.toThrow();
    });

    it('refuses a binding of the same workspace without a ledger before the first write call', async () => {
      const fake = new FakeNotion('workspace-1');
      const bound = 'workspace: workspace-1\ndata_sources: {}\n';

      writeFileSync(files.binding, bound);

      await expect(build(fake)).rejects.toThrow(
        /were not built here, and building now would create them a second time/,
      );
      expect(fake.writes).toEqual([]);
      expect(readdirSync(folder)).toEqual(['mapping.yaml']);
      expect(readFileSync(files.binding, 'utf8')).toBe(bound);
    });
  });

  describe('the scope of changes', () => {
    it('leaves a neighboring foreign database untouched and removes an extra property from its own database', async () => {
      const fake = new FakeNotion();

      fake.addDatabase('Foreign');
      await build(fake);
      fake.setProperty('Tasks', 'Extra', { description: null, type: 'rich_text' });
      fake.setProperty('Foreign', 'Extra', { description: null, type: 'rich_text' });
      await build(fake);

      expect(
        fake
          .shapes()
          .find(({ title }) => title === 'Tasks')
          ?.properties.has('Extra'),
      ).toBe(false);
      expect(
        fake
          .shapes()
          .find(({ title }) => title === 'Foreign')
          ?.properties.has('Extra'),
      ).toBe(true);
      expect(fake.writes.filter((write) => write.includes('Foreign'))).toEqual([]);
    });

    it('refuses a relation from a ledger database to one outside the ledger before the first property change', async () => {
      const fake = new FakeNotion();

      await build(fake);
      fake.addDatabase('Foreign');
      fake.setProperty('Tasks', 'Link', {
        description: null,
        type: 'relation',
        target: 'Foreign',
        synced: null,
      });
      fake.setProperty('Tasks', 'Extra', { description: null, type: 'rich_text' });

      const written = fake.writes.length;

      await expect(build(fake)).rejects.toThrow(
        /Tasks\."Link" relates to a data source outside the schema/,
      );
      expect(fake.writes).toHaveLength(written);
    });
  });
});
