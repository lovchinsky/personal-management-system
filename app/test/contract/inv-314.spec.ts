import { skillFiles } from './plugin-files';

/**
 * Signs that the author's context has crept into the text of the Skill. The agent that reads it
 * does not know the project: not its norms, not its decisions, not the gap register, not how the
 * App is built. Each pattern names one of these signs.
 */
const MARKERS: readonly (readonly [RegExp, string])[] = [
  [/\b(?:ADR|INV|GAP|DEF|SCEN)-\d+/, 'a reference to a norm, a decision or a register'],
  [/\bM\d{1,2}\b/, 'a milestone number'],
  [/\byou are not\b|\bnot a set of\b|\bpersonas?\b|\bdetector agents?\b/i, 'identity by negation'],
  [
    /\b(?:facade|state machine|atomic(?:ally)?)\b/i,
    'a word from the architecture, not from behavior',
  ],
  [
    /\bthe (?:contract|norm|spec|specification)\b|\bacceptance\b|\bgate\b/i,
    'a pointer to a norm or to acceptance',
  ],
  [/\b(?:validator|executor|harness|runner)\b/i, 'a mechanism the agent does not see'],
  [/\binstallation\b/i, '“installation”: the Skill says “this workspace”'],
  [/\bdetectors?\b/i, '“detector”: the Skill says “attention label”'],
  [
    /\bshadow mode\b|\bin the future\b|\buntil (?:the person has )?configured\b/i,
    'the future or the rollout',
  ],
  [
    /\bthe bot\b|\bsystem voice\b|\bperson's voice\b|\bnative writes?\b/i,
    'a word the Skill does not use',
  ],
  [/\barchived\b/i, '“archived”: a record goes to the trash'],
  [/\bapproval(?:-required)?\b/i, '“approval”: the Skill says proposal or decision'],
  [/\buser\b/i, '“user”: the Skill says “the person”'],
];

/**
 * Removes what is in backticks. That is a capability name or a value, not prose, so it is not
 * checked.
 */
function prose(text: string): string {
  return text.replace(/`[^`\n]*`/g, '');
}

/**
 * `INV-314` The Skill is an instruction for an agent that does not know the project, not a copy of
 * the norms.
 *
 * The check is static and partial: it catches signs of the author's context leaking in —
 * references to norms, implementation requirements, acceptance criteria, words the Skill does not
 * use. The rest is editorial judgment (`INV-037`): whether each sentence changes the agent's
 * behavior or supplies a fact the agent does not see in the tools.
 */
describe('INV-314', () => {
  const files = skillFiles();

  it('there is something to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(MARKERS)('the Skill does not contain %s: %s', (marker) => {
    const found = files.flatMap((file) =>
      prose(file.text)
        .split('\n')
        .map((line, at) => ({ path: file.path, line: at + 1, text: line }))
        .filter((row) => marker.test(row.text))
        .map((row) => `${row.path}:${row.line} ${row.text.trim().slice(0, 100)}`),
    );

    expect(found).toEqual([]);
  });
});
