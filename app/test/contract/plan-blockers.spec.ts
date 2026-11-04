import { repoFile } from './contracts';

/**
 * The M11 blockers in the plan are exactly the gaps whose “Blocks” column names M11
 * (`docs/5-plan.md` § “M11 — Production”): a list that has fallen behind the register would
 * promise production while omitting what really blocks it.
 */
describe('the M11 blockers in the plan', () => {
  const plan = repoFile('docs/5-plan.md');

  const listed = (): string[] => {
    const start = plan.indexOf('## M11 — Production');
    const section = plan.slice(start, plan.indexOf('## Dependency graph', start));
    const paragraph = section.slice(section.indexOf('**Blockers:**')).split('\n\n')[0] ?? '';

    return [...paragraph.matchAll(/GAP-\d+/g)].map((match) => match[0]);
  };

  const blocking = (): string[] =>
    plan.split('\n').flatMap((line) => {
      const row = /^\| \*\*(GAP-\d+)\*\* \|.*\| M11\b[^|]*\|\s*$/.exec(line);

      return row ? [row[1]] : [];
    });

  it('name every gap that blocks M11 and nothing extra', () => {
    expect(blocking().length).toBeGreaterThan(0);
    expect(listed().sort()).toEqual(blocking().sort());
  });
});
