import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { invariants, repoFile } from './contracts';
import { anchorsOf, CHECKER, CorpusFile, headingsOf, loadCorpus, sectionKey, slug } from './corpus';
import {
  closedRegistersIn,
  Form,
  FORMS,
  formViolations,
  originReferences,
  Problem,
  PROBLEMS,
  Reference,
  referencesIn,
  resolves,
  show,
  targetsOf,
  Violation,
} from './references';

/**
 * References from code, contracts and documents lead where they say.
 *
 * The rationale lives once, in the rule's home, and everything else refers to it (`docs/README.md`
 * § “Where the “why” lives”). A dangling reference is the same defect as a copy that has diverged:
 * the reader gets what no longer exists. So it fails `npm test` just as a broken import does.
 */
describe('references', () => {
  const corpus = loadCorpus();
  const entries = invariants();
  const targets = targetsOf(corpus, entries);
  const contractKeys: ReadonlySet<string> = new Set(Object.keys(targets.canonical));
  const references: Reference[] = [
    ...corpus.flatMap(referencesIn),
    ...originReferences(entries, repoFile('contracts/invariants.yaml')),
  ];
  const violations: Violation[] = corpus.flatMap((file) => formViolations(file, contractKeys));

  const of = (form: Form): Reference[] => references.filter((reference) => reference.form === form);
  const shown = (found: readonly Violation[]): string[] =>
    found.map((violation) => `${violation.file}:${violation.line} ${violation.problem}`);

  it.each(FORMS)('%s: no reference dangles', (form) => {
    const dangling = of(form).filter((reference) => !resolves(reference, targets));

    expect(dangling.map(show)).toEqual([]);
  });

  /** Without this, a resolver that accepts everything would pass the check above silently. */
  it('rejects a target that does not exist, in every form', () => {
    const missing: Record<Form, readonly string[]> = {
      invariant: ['INV-999'],
      section: ['docs/2-system.md § No such section', 'docs/missing.md § Scheduler and outbox'],
      'contract key': ['missing', 'scheduled_check.missing'],
      ADR: ['0999'],
      'decision D': ['D99'],
      'RUNBOOK step': ['99', '12.99'],
      'defect or gap': ['DEF-999', 'GAP-999'],
      conflict: ['C99'],
      scenario: ['SCEN-99-99'],
      markdown: [
        'docs/missing.md',
        'docs/2-system.md#no-such-section',
        'docs/2-system.md#%E0%A4%A',
        '../outside/README.md',
      ],
    };
    const accepted = FORMS.flatMap((form) =>
      missing[form]
        .map((target): Reference => ({ form, target, file: 'probe', line: 1 }))
        .filter((reference) => resolves(reference, targets))
        .map(show),
    );

    expect(accepted).toEqual([]);
  });

  /** Documents refer to each other in another way, but a section number is forbidden there too. */
  it('a section number outside RUNBOOK is a violation in a document, not in RUNBOOK itself', () => {
    const text =
      'Steps in RUNBOOK §15–31; section §5 of the audit.\n```text\n§7 in an example\n```\n';
    const probes: CorpusFile[] = [
      { path: 'probe.md', role: 'normative', text },
      { path: 'infra/RUNBOOK.md', role: 'normative', text },
    ];
    const expected: Violation[] = [
      { file: 'probe.md', line: 1, problem: 'section number outside RUNBOOK' },
    ];

    expect(probes.flatMap((probe) => formViolations(probe, contractKeys))).toEqual(expected);
  });

  it.each(PROBLEMS)('the corpus has no violation: %s', (problem) => {
    expect(shown(violations.filter((violation) => violation.problem === problem))).toEqual([]);
  });

  /** Without this, a detector blind to a violation would pass the check above silently. */
  it('reports every near-miss form as a violation', () => {
    const probe: CorpusFile = {
      path: 'probe.ts',
      role: 'code',
      text: [
        '// `docs/2-system.md` § Scheduler and outbox',
        '// `docs/2-system.md`, section “Scheduler and outbox”',
        '// and here § “Scheduler and outbox” with no path',
        '// `docs/2-system.md` § “Scheduler and outbox',
        '// see § 5 of the audit',
        '// key `scheduled_check` with no path',
        '// lifecycle `scheduled_check` with no path',
        '// `contracts/canonical.yaml` `pending_action`',
        '// [section](../docs/2-system.md#scheduler-and-outbox)',
        '// see docs/2-system.md#scheduler-і-outbox',
        '// INV-42 and ADR 11',
        '// ADR 00011 and ADR0099',
      ].join('\n'),
    };
    const expected: string[] = [
      '1 section without “”',
      '2 section in words, not §',
      '3 section without a document path',
      '4 section without the closing ”',
      '5 section number outside RUNBOOK',
      '6 contract key without a path',
      '7 contract key without a path',
      '8 contract key not in the form',
      '9 markdown link instead of §',
      '10 markdown link instead of §',
      '11 invariant not in three digits',
      '11 ADR not in four digits',
      '12 ADR not in four digits',
      '12 ADR not in four digits',
    ];
    const probed: Problem[] = expected.map((line) => {
      const problem = PROBLEMS.find((candidate) => line.endsWith(candidate));
      if (problem === undefined) {
        throw new Error(`no such problem: ${line}`);
      }

      return problem;
    });

    expect(
      formViolations(probe, contractKeys)
        .map((violation) => `${violation.line} ${violation.problem}`)
        .sort(),
    ).toEqual([...expected].sort());
    expect([...new Set(probed)].sort()).toEqual([...PROBLEMS].sort());
  });

  /** The register itself sets the closing mark, and each half of it is checked on its own. */
  it('recognizes a closed defect and a closed gap and leaves the open ones', () => {
    const plan = [
      '| **DEF-01** | **Closed in M0.** Description. |',
      '| **DEF-02** | Description. |',
      '| **GAP-03** | Gap | state | closed in M0 |',
      '| **GAP-04** | Gap | state | M3 |',
      '| S5 | risk | consequence | closed in M0 |',
      'Text of the plan, not a register.',
    ].join('\n');

    expect([...closedRegistersIn(plan)].sort()).toEqual(['DEF-01', 'GAP-03']);
  });

  it('reads a section and contract keys, singly and in a list', () => {
    const probe: CorpusFile = {
      path: 'probe.ts',
      role: 'code',
      text: [
        '// `docs/2-system.md` § “Scheduler and outbox”',
        '// `contracts/canonical.yaml`, keys `scheduled_check` and `pending_action`',
        '// `contracts/canonical.yaml`, key `webhook_receipt`; `contracts/canonical.yaml`, keys',
        '// `sweep`, `run_budget` or `run_priority`',
      ].join('\n'),
    };
    const expected: Reference[] = [
      {
        form: 'section',
        target: 'docs/2-system.md § Scheduler and outbox',
        file: 'probe.ts',
        line: 1,
      },
      { form: 'contract key', target: 'scheduled_check', file: 'probe.ts', line: 2 },
      { form: 'contract key', target: 'pending_action', file: 'probe.ts', line: 2 },
      { form: 'contract key', target: 'webhook_receipt', file: 'probe.ts', line: 3 },
      { form: 'contract key', target: 'sweep', file: 'probe.ts', line: 3 },
      { form: 'contract key', target: 'run_budget', file: 'probe.ts', line: 3 },
      { form: 'contract key', target: 'run_priority', file: 'probe.ts', line: 3 },
    ];

    expect(referencesIn(probe)).toEqual(expected);
    expect(formViolations(probe, contractKeys)).toEqual([]);
  });

  /**
   * RUNBOOK tells the operator what to do. The rationale lives in the documents, and RUNBOOK does
   * not lead there.
   */
  it('RUNBOOK does not refer into docs/', () => {
    const livingInDocs: readonly Form[] = ['ADR', 'decision D', 'defect or gap', 'scenario'];
    const intoDocs = references.filter(
      (reference) =>
        reference.file === 'infra/RUNBOOK.md' &&
        (reference.target.startsWith('docs/') || livingInDocs.includes(reference.form)),
    );

    expect(intoDocs.map(show)).toEqual([]);
  });

  /** The field itself gives the bounds of the value, so quotes would become part of the heading. */
  it('origin writes the heading without quotes', () => {
    const quoted = entries.flatMap((entry) =>
      (entry.origin ?? [])
        .filter((origin) => / § “.*”$/.test(origin))
        .map((origin) => `${entry.id}: ${origin}`),
    );

    expect(quoted).toEqual([]);
  });

  /** Two sections with one key would make a reference to either of them ambiguous. */
  it('the headings of a document stay distinct after normalization', () => {
    const repeated = corpus
      .filter((file) => file.role === 'normative')
      .flatMap((file) => {
        const keys = headingsOf(file.text).map((heading) => sectionKey(heading.text));

        return keys
          .filter((key, index) => keys.indexOf(key) !== index)
          .map((key) => `${file.path}: ${key}`);
      });

    expect(repeated).toEqual([]);
  });

  /**
   * Without this, a scanner blind to a form would pass the check above silently. A form whose
   * register is empty legitimately does not occur in the corpus: a resolved conflict is removed
   * from `conflicts`. The probe below catches the scanner's blindness to it.
   */
  it('sees every form in the corpus itself', () => {
    const empty: readonly Form[] = targets.conflicts.size === 0 ? ['conflict'] : [];
    const unseen = FORMS.filter((form) => of(form).length === 0 && !empty.includes(form));

    expect(unseen).toEqual([]);
    expect(
      of('section').some(
        (reference) =>
          reference.file === 'app/src/approvals/preconditions/precondition.ts' &&
          reference.target === 'docs/2-system.md § Preconditions and executor',
      ),
    ).toBe(true);
  });

  it('reads a conflict in backticks', () => {
    const probe: CorpusFile = {
      path: 'probe.ts',
      role: 'code',
      text: '// see `C7` in `conflicts`.\n',
    };
    const expected: Reference[] = [{ form: 'conflict', target: 'C7', file: 'probe.ts', line: 1 }];

    expect(referencesIn(probe)).toEqual(expected);
  });

  it('reads a form broken by the wrap of a comment or a quote', () => {
    const probes: CorpusFile[] = [
      {
        path: 'probe.ts',
        role: 'code',
        text: '/**\n * See `contracts/canonical.yaml`, key\n * `scheduled_check`.\n */\n',
      },
      {
        path: 'probe.md',
        role: 'normative',
        text: '> The mechanism is in `docs/2-system.md` § “Scheduler\n> and outbox”.\n',
      },
    ];
    const expected: Reference[] = [
      { form: 'contract key', target: 'scheduled_check', file: 'probe.ts', line: 2 },
      {
        form: 'section',
        target: 'docs/2-system.md § Scheduler and outbox',
        file: 'probe.md',
        line: 1,
      },
    ];

    expect(probes.flatMap(referencesIn)).toEqual(expected);
    expect(probes.flatMap((probe) => formViolations(probe, contractKeys))).toEqual([]);
  });

  /** This is how a contract names the decision its entry rests on. */
  it('reads a decision from the `decision` field of a contract', () => {
    const probe: CorpusFile = {
      path: 'probe.yaml',
      role: 'contract',
      text: 'known_non_canonical:\n  - value: Hidden\n    decision: D5\n',
    };

    expect(referencesIn(probe)).toEqual([
      { form: 'decision D', target: 'D5', file: 'probe.yaml', line: 3 },
    ]);
  });

  /** The `Source` column in `docs/4-acceptance.md` writes a key this way. */
  it('reads a key written as an anchor of the contract', () => {
    const probe: CorpusFile = {
      path: 'probe.md',
      role: 'normative',
      text: '| SCEN-17-01 | … | contracts/canonical.yaml#run_trace_fields | … |\n',
    };

    expect(referencesIn(probe).filter((reference) => reference.form === 'contract key')).toEqual([
      { form: 'contract key', target: 'run_trace_fields', file: 'probe.md', line: 1 },
    ]);
  });

  /** In a fenced block, `[x](y)` is the text of an example, not a link. */
  it('ignores links inside fenced blocks', () => {
    const probe: CorpusFile = {
      path: 'probe.md',
      role: 'normative',
      text: '```markdown\n[example](missing.md#nothing)\n```\n[live](docs/README.md)\n',
    };

    expect(referencesIn(probe).map((reference) => reference.target)).toEqual(['docs/README.md']);
  });

  it('reads every key of a list, after a comma, “and” and “or”', () => {
    const probe: CorpusFile = {
      path: 'probe.ts',
      role: 'code',
      text: '// `contracts/canonical.yaml`, keys `scheduled_check`, `evaluation_window`, and `pending_action` or `run_budget`.\n',
    };

    expect(referencesIn(probe).map((reference) => reference.target)).toEqual([
      'scheduled_check',
      'evaluation_window',
      'pending_action',
      'run_budget',
    ]);
  });

  it('ignores placeholders and other keys', () => {
    const text =
      'Band INV-2xx; scenario SCEN-20-NN; key `digest:<day>`; key `idempotencyKey`; ' +
      'config-key `scheduled_check`; model C4.';
    const probes: CorpusFile[] = [
      { path: 'probe.md', role: 'normative', text: `${text}\n` },
      { path: 'probe.ts', role: 'code', text: `// ${text}\n` },
    ];

    expect(probes.flatMap(referencesIn)).toEqual([]);
    expect(probes.flatMap((probe) => formViolations(probe, contractKeys))).toEqual([]);
  });

  /**
   * The examples are the ones that `docs/README.md` § “Reference forms” gives, plus characters at
   * the edges of Unicode.
   */
  it('computes the slug as GitHub does', () => {
    const slugs: string[] = [
      '### 11.3. Scheduled',
      '### 11.5. Someday/Maybe',
      '### App MCP — runtime/control interface',
      '## ‡ “Project `Done` без висновку про Key Result” vs G13',
      '## Ступінь x² і ½ ① Ⓐ',
    ].map((heading) => slug(heading.replace(/^#+\s+/, '')));

    expect(slugs).toEqual([
      '113-scheduled',
      '115-somedaymaybe',
      'app-mcp--runtimecontrol-interface',
      '-project-done-без-висновку-про-key-result-vs-g13',
      'ступінь-x-і---ⓐ',
    ]);
  });

  /** Repeats, nested fences and explicit anchors are counted the way GitHub counts them. */
  it('computes anchors as GitHub does', () => {
    const text = [
      '# x',
      '## x',
      '### x-1',
      '# y',
      '## y-1',
      '### y',
      '````markdown',
      '```',
      '# not a heading',
      '```',
      '````',
      'Example: `<a id="in-code"></a>` and <a href="#x" id="explicit"></a>.',
    ].join('\n');

    expect([...anchorsOf(text)].sort()).toEqual(
      ['x', 'x-1', 'x-1-1', 'y', 'y-1', 'y-2', 'explicit'].sort(),
    );
  });

  /**
   * The corpus skips nothing except the samples of the check itself: they deliberately name what
   * does not exist.
   */
  it('the corpus excludes only its own samples', () => {
    const contractDir = resolve(__dirname);
    const onDisk = readdirSync(contractDir)
      .filter((name) => name.endsWith('.ts'))
      .map((name) => `app/test/contract/${name}`);
    const scanned = corpus
      .filter((file) => file.path.startsWith('app/test/contract/'))
      .map((file) => file.path);

    expect(onDisk.filter((path) => !scanned.includes(path)).sort()).toEqual([...CHECKER].sort());
  });
});
