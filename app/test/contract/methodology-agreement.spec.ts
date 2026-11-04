import { dependencyState } from '../../src/methodology/dependency';
import { PROJECT_PHASE, TASK_LIFECYCLE } from '../../src/methodology/lifecycle';
import { Records } from '../fixtures/methodology-records';
import { VALID_BINDING_FILE } from '../fixtures/notion-mapping.fixture';
import { canonical } from './contracts';
import { entryText } from './plugin-files';

const CHAT = canonical.pluginEntries().chat;

/** Returns the first column of a Skill section's table: what is in backticks at the line start. */
function tableNames(file: string, heading: string): string[] {
  const text = entryText(CHAT, file);
  const start = text.indexOf(`## ${heading}`);
  const section = text.slice(start + 1).split(/^## /m)[0];

  return [...section.matchAll(/^\| `([^`]+)` \|/gm)].map((match) => match[1]);
}

const names = (record: Readonly<Record<string, unknown>>): string[] => Object.keys(record);

/**
 * The methodology rules in the code name the same statuses as the contract, the binding and the
 * Skill. The rules and the Skill are written separately on purpose: the model reads the Skill,
 * while the gate, the sweep and evals are code, so no one's memory would keep track of a
 * divergence between them.
 */
describe('the methodology in the code and the contract', () => {
  it('the Task statuses are exactly the canonical ones, and the binding names the same', () => {
    expect(names(TASK_LIFECYCLE).sort()).toEqual([...canonical.levels().L0.task_statuses].sort());
    expect(names(TASK_LIFECYCLE).sort()).toEqual(
      names(VALID_BINDING_FILE.options['task.status']?.canonical ?? {}).sort(),
    );
  });

  it("the Project statuses are exactly the contract's `core_statuses`, and the binding names the same", () => {
    expect(names(PROJECT_PHASE).sort()).toEqual([...canonical.projectModel().core_statuses].sort());
    expect(names(PROJECT_PHASE).sort()).toEqual(
      names(VALID_BINDING_FILE.options['project.status']?.canonical ?? {}).sort(),
    );
  });

  it('the contract names the meaning of each of the seven Task statuses', () => {
    expect(Object.keys(canonical.taskModel().status_semantics).sort()).toEqual(
      names(TASK_LIFECYCLE).sort(),
    );
  });

  /**
   * `docs/1-methodology.md` § “Project Status”: a Task of a closed Project is settled with a
   * terminal status (`Failed` is among them, and the person sets it) or by re-linking. The set is
   * derived from the rule table, not from a copy: a terminal status that the contract rule does
   * not name and a non-terminal one that it does name are equally a divergence.
   */
  it('the contract names all the ways to settle a Task of a closed Project, and only those', () => {
    const whole =
      canonical
        .projectModel()
        .rules.find((candidate) =>
          candidate.startsWith('When a Project becomes Done or Canceled'),
        ) ?? '';
    // The list of ways comes after the colon: the start of the rule itself names `Done` and
    // `Canceled`.
    const rule = whole.slice(whole.indexOf(':') + 1);
    const statuses = Object.entries(TASK_LIFECYCLE);

    expect(whole).not.toBe('');
    expect(rule).not.toBe(whole);
    expect(statuses.filter(([name, kind]) => kind === 'terminal' && !rule.includes(name))).toEqual(
      [],
    );
    expect(statuses.filter(([name, kind]) => kind === 'open' && rule.includes(name))).toEqual([]);
    expect(rule).toContain('detached');
  });

  describe('the Skill names the same', () => {
    it('the seven Task statuses match the table in the knowledge about objects', () => {
      expect(tableNames('knowledge/ontology.md', 'Task statuses').sort()).toEqual(
        names(TASK_LIFECYCLE).sort(),
      );
    });

    it('the five Project statuses match the table in the knowledge about the portfolio', () => {
      expect(tableNames('knowledge/portfolio.md', 'Project statuses').sort()).toEqual(
        names(PROJECT_PHASE).sort(),
      );
    });

    /**
     * The mechanical half of the Available Now conditions: the `Next Action` status and a Project
     * in work, or no Project.
     */
    it('the Available Now conditions in reviews use the “in work” Project statuses', () => {
      const text = entryText(CHAT, 'knowledge/reviews.md');
      const working = Object.entries(PROJECT_PHASE)
        .filter(([, phase]) => phase === 'in_work')
        .map(([status]) => `\`${status}\``)
        .join(' or ');

      expect(text).toContain('its `Status` is `Next Action`');
      expect(text).toContain(`its Project is ${working} (or it has none)`);
    });

    /**
     * The test asks the rule itself which blocker statuses resolve a dependency, instead of using
     * a copy of the list. The Skill must name exactly the statuses on which the rule answers
     * “resolved”.
     */
    it('the blockers that resolve a dependency are those the Skill names, and only those', async () => {
      const records = await Records.create();
      const resolving = names(TASK_LIFECYCLE).filter((status) => {
        const blocker = records.task({ id: 'blocker', status });
        const dependent = records.task({
          id: 'dependent',
          status: 'Waiting For',
          dependencies: ['blocker'],
        });

        return dependencyState(dependent, new Map([['blocker', blocker]])).state === 'resolved';
      });
      const listed = resolving.map((status) => `\`${status}\``).join(' or ');

      expect(resolving.length).toBeGreaterThan(0);
      expect(entryText(CHAT, 'knowledge/detectors.md')).toContain(
        `resolves a dependency when it is ${listed};`,
      );
    });

    it('a paused Project suppresses Tasks without changing their statuses', () => {
      const text = entryText(CHAT, 'knowledge/portfolio.md');
      const paused = text.split('\n').find((line) => line.startsWith('| `Paused`')) ?? '';

      expect(paused).toContain('keep their statuses');
      expect(paused).toContain('Available Now');
    });
  });
});
