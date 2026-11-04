import { TASK_LIFECYCLE } from '../../src/methodology/lifecycle';
import { PROJECT_MOVES } from '../../src/methodology/project-path';
import { canonical, repoFile } from './contracts';
import { entryText } from './plugin-files';

const RUN = canonical.pluginEntries().run;
const CHAT = canonical.pluginEntries().chat;

/** Returns the values in backticks, which is how the Skill and the norm name statuses and modes. */
const quoted = (text: string): string[] =>
  [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? '');

/** Formats a list in words: “`a`, `b` or `c`”. */
function listed(values: readonly string[], or: string): string {
  const names = values.map((value) => `\`${value}\``);

  return `${names.slice(0, -1).join(', ')} ${or} ${names.at(-1) ?? ''}`;
}

/** Returns the options of a contract field: `Advance | Maintain | Minimum`. */
function optionsOf(type: string, field: string): string[] {
  const options = canonical.fieldContract()[type]?.[field];

  if (options === undefined) throw new Error(`contracts/canonical.yaml has no ${type}.${field}`);

  return options.split('|').map((option) => option.trim());
}

/** Returns the section of a label in `knowledge/detectors.md`, from its heading to the next one. */
function labelSection(label: string): string {
  const text = entryText(CHAT, 'knowledge/detectors.md');
  const start = text.indexOf(`### ${label}\n`);

  if (start === -1) throw new Error(`knowledge/detectors.md has no section ${label}`);

  const rest = text.slice(start);
  const end = rest.indexOf('\n### ', 1);

  return end === -1 ? rest : rest.slice(0, end);
}

/** Returns the bullet of a section that starts with `prefix`. */
function bullet(section: string, prefix: string): string {
  const line = section.split('\n').find((candidate) => candidate.startsWith(`- ${prefix}`));

  if (line === undefined) throw new Error(`no bullet starting with “${prefix}”`);

  return line;
}

/** Returns the paragraph of the norm about `area_of_focus_risk`. */
function policyParagraph(): string {
  const paragraph = repoFile('docs/3-policy.md')
    .split('\n')
    .find((line) => line.startsWith('`area_of_focus_risk` requires'));

  if (paragraph === undefined) throw new Error('docs/3-policy.md has no area_of_focus_risk rule');

  return paragraph;
}

/**
 * Returns the sentence that starts with `marker`, up to a period followed by a space or the end.
 */
function sentence(text: string, marker: string): string {
  const start = text.indexOf(marker);

  if (start === -1) throw new Error(`no sentence starting with “${marker}”`);

  return text.slice(start).split(/\.(?:\s|$)/)[0] ?? '';
}

const OPEN = Object.entries(TASK_LIFECYCLE)
  .filter(([, lifecycle]) => lifecycle === 'open')
  .map(([status]) => status);

/**
 * The stages at which a habit is in motion: it is being installed, stabilized or maintained.
 * `Designed` has not started yet and `Retired` has already been withdrawn, so both stay outside
 * motion.
 */
const MOVING_STAGES: readonly string[] = ['Installing', 'Stabilizing', 'Maintenance'];

/**
 * The third ground of `area_of_focus_risk` is what the recorded statuses show: under `Advance`,
 * nothing in the Area of Focus is in motion. Motion has one definition, `PROJECT_MOVES` in the
 * code, which is the way a Project in work moves. `project_integrity` and `area_of_focus_risk` in
 * the Skill and the norm repeat it. The test fails as soon as any of them names motion
 * differently, adds a condition to it that cannot be decided from what was read (a window, an
 * edit time), extends the ground to another `Mode`, or drops the rule that the absence of motion
 * is not urgent. A ground that cannot be decided from what was read yields a label at random.
 */
describe('the motion of an Area of Focus and of a Project has one definition', () => {
  const area = labelSection('area_of_focus_risk');
  const modes = optionsOf('area_of_focus', 'mode');

  it('the stages of habit motion are canonical', () => {
    const lifecycle = optionsOf('behavior_system', 'lifecycle');

    expect(MOVING_STAGES.every((stage) => lifecycle.includes(stage))).toBe(true);
    expect(sorted(PROJECT_MOVES.Planning)).toEqual(sorted(OPEN));
  });

  it('`project_integrity` names `Active` Project motion by the same statuses as the code', () => {
    const integrity = bullet(labelSection('project_integrity'), 'Claim read from properties');
    const active = /an `Active` Project with nothing in motion \(([^)]*)\)/.exec(integrity)?.[1];

    expect(sorted(quoted(active ?? ''))).toEqual(sorted(PROJECT_MOVES.Active));
  });

  it('Area of Focus motion in the Skill is exactly Project motion plus habit stages, nothing else', () => {
    expect(bullet(area, 'In motion,')).toBe(
      `- In motion, linked directly, through a Project or its Objectives' Key Results: a ${listed(PROJECT_MOVES.Active, 'or')} Task, with no Project or in an \`Active\` one; an open Task in a \`Planning\` Project; a Behavior System ${listed(MOVING_STAGES, 'or in')}.`,
    );
  });

  it('Area of Focus motion in the norm is the same', () => {
    const form = `a ${listed(PROJECT_MOVES.Active, 'or')} Task with no Project or in an \`Active\` Project, an open Task in a \`Planning\` Project or a Behavior System in lifecycle ${listed(MOVING_STAGES, 'or')}`;

    expect(policyParagraph()).toContain(form);
  });

  it('there are three grounds up to the period, and the third is only motion under `Advance`', () => {
    const opening = 'Claim, on one of three grounds only: ';
    const claim = bullet(area, opening);
    const grounds = sentence(claim, opening).slice(opening.length).split(';');

    expect(grounds).toHaveLength(3);
    expect(grounds[2]?.trim()).toBe('under `Advance`, nothing linked to it is in motion');
    expect(quoted(claim).filter((value) => modes.includes(value))).toEqual(['Advance']);
  });

  it('in the norm, the motion ground is also only under `Advance`; silence under the other modes is not a ground', () => {
    const policy = policyParagraph();
    const grounds = sentence(policy, 'Grounds:');
    const quiet = /under ([^,]*), a comparison/.exec(bullet(area, 'Not a claim when'))?.[1];
    const policyQuiet = /Under ([^.]*?),? silence is expected/.exec(policy)?.[1];

    expect(grounds).toMatch(/; or under `Advance`, nothing in the Area of Focus is in motion$/);
    expect(quoted(grounds).filter((value) => modes.includes(value))).toEqual(['Advance']);
    expect(sorted(['Advance', ...quoted(quiet ?? '')])).toEqual(sorted(modes));
    expect(sorted(quoted(policyQuiet ?? ''))).toEqual(sorted(quoted(quiet ?? '')));
  });

  it('the absence of motion is not urgent: event evaluation and recheck do not raise it', () => {
    const row = entryText(RUN, 'claims.md')
      .split('\n')
      .find((line) => line.startsWith('|') && line.includes('`area_of_focus_risk`'));

    expect(row).toContain('nothing in motion in an Area of Focus never is');
    expect(policyParagraph()).toContain('Under `Advance`, the absence of motion is never urgent');
  });
});

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}
