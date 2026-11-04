import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { REPO_ROOT, repoFile } from './contracts';
import { CorpusFile, loadCorpus } from './corpus';
import { skillFiles } from './plugin-files';
import { closedRegistersIn, flatten } from './references';

/**
 * A document and a comment describe the system as it is, and a decision stands in its final form,
 * without a path to it (`docs/README.md` § “Where the “why” lives”).
 *
 * What is unambiguous is enforced mechanically: a word or phrase that narrates change, a status or
 * measurement tied to a milestone, and a completed milestone outside the name of its gate. “Still”,
 * “no longer”, “earlier” and “instead of” also have legitimate uses, in the behavior of the system
 * and in a choice between options, so they, along with any contrast with a superseded model, are
 * left to review, not to this check. The check reads the whole corpus, ADRs and appendices
 * included; applied migrations are changes of the schema, and the corpus does not contain them.
 *
 * A mention inside “…” is a quotation, not a statement: that is how a norm gives examples and how
 * a text names a section of the plan.
 */

/**
 * Words and phrases that have nothing to mean in a description of what is: the time of a change, a
 * displaced design, a comparison with what was, and a changelog in prose.
 */
const CHANGE_FORMS: readonly RegExp[] = [
  // A displaced design: "the old rule", "the former behavior".
  /\bthe (?:old|former|previous) (?:rule|behaviou?r|way|version|model|format)\b/u,
  /\b(?:previously|formerly|originally|historically)\b/u,
  // "used to" in the passive is a purpose ("is used to sign"), not the past.
  /(?<!\b(?:is|are|be|been|being|was|were|get|gets|got)\s)\bused\s+to\b/u,
  // A changelog in prose: "Merged from two statements…".
  /\b(?:merged|renamed|restated|reworded)\s+(?:from|into)\b/u,
  // A measurement as an event: "was measured". A "(measured)" mark beside a property of an
  // external system is evidence of what is, not an event.
  /\b(?:was|were)\s+(?:measured|observed|confirmed|verified)\b/u,
  // A version label that the document does not define: "v2 Skill".
  /\bv\d+\s+Skill\b/u,
  // The time of a change: "the App now writes". "Now" alone, "from now on" and "as before" also
  // describe behavior ("it is denied from now on", "check the facts are as before"), so they are
  // left to review.
  /(?<!Available\s)\bnow\s+(?:also\s+)?(?:uses|writes|reads|carries|sends|runs|returns|holds|keeps|takes|goes|lives|sets|asks|says)\b/u,
  // A displaced design by name: "the old model", "a row of the former format", "an earlier
  // version".
  /\b(?:old|former|previous|earlier)\s+(?:rules?|behaviou?rs?|ways?|versions?|models?|formats?|forms?|schemes?|wordings?|implementations?|mechanisms?|approach(?:es)?|protocols?|contracts?|expectations?)\b/u,
  // Comparison with what was: "as on the previous build".
  /\bas\s+(?:on|in|at)\s+the\s+previous\b/u,
  // A story of a change: "after the fix", "following the audit", "replaced by the decision".
  /\b(?:after|before|following)\s+(?:the\s+)?(?:re-?)?(?:audit|refactor(?:ing)?|fix(?:es)?)\b/u,
  /\bas\s+a\s+result\s+of\s+the\s+audit\b/u,
  /\b(?:replaced|superseded)\s+by\s+(?:the|this)\s+(?:decision|rule|norm)\b/u,
  /\b(?:was|were|has\s+been|have\s+been)\s+(?:introduced|renamed|replaced|reworded|rewritten)\b/u,
  /\bfirst\s+(?:brings|brought|introduces|introduced|adds|added)\b/u,
  /\bthe\s+code\s+no\s+longer\b|\bno\s+longer\s+in\s+the\s+code\b/u,
  /\b(?:which|that)\s+is\s+how\b.{0,40}?\b(?:appeared|came\s+about|came\s+to\s+be)\b/u,
  // A register entry that says how it was narrowed.
  /\*\*Narrowed\b[^*]*\*\*/u,
  // A divergence from the text, named separately.
  /\b(?:deviation|divergence)\s+of\s+the\s+implementation\s+from\s+the\s+(?:text|description|document)\b/u,
  // A measurement as a dated event.
  /\b(?:measured|transcripts?)\b(?:\s+\S+){0,4}?\s+20\d{2}-\d{2}-\d{2}(?![\dT])/u,
  // A stage that is gone: "until there is a Skill".
  /\buntil\s+there\s+is\s+(?:a|an)\s+(?:Skill|runner|App|gate)\b|\bwhile\s+there\s+is\s+no\s+(?:Skill|runner|App|gate)\b/u,
];

const CHANGE_WORD = new RegExp(CHANGE_FORMS.map((form) => form.source).join('|'), 'giu');

/** A status or measurement tied to a milestone: “Closed in M3”, “measured at M0”. */
const DATED_STATUS =
  /\b(?:closed|narrowed|measured|read|confirmed|moved|carried\s+over)\s+(?:in|at|on|from|to)\s+M\d+\b/giu;

const MILESTONE = /\bM(\d+)\b/g;

/**
 * A gate is a permanent check, not a point in time, so a completed milestone is legitimate in its
 * name.
 */
const GATE_NAME = /\bgate M\d+\b/gi;

/**
 * Where a completed milestone is legitimate beyond the name of a gate: the plan names milestones
 * because they are its subject, and the status line of `README.md` says which of them are
 * completed.
 */
const MILESTONE_HOMES: ReadonlySet<string> = new Set(['docs/5-plan.md', 'README.md']);

/** A gate command is named after the milestone it checks. */
const GATE_COMMAND = 'app/test/gate/';

/** A legitimate use of a change word, with its reason. */
interface Allowed {
  readonly path: string;
  readonly phrase: string;
}

const ALLOWED: readonly Allowed[] = [];

/** Returns the last implemented milestone from the “Implemented M0–M3” line of `README.md`. */
function lastCompleted(readme: string): number {
  const match = /Implemented M0–M(\d+)/.exec(readme);
  if (!match) {
    throw new Error('README.md does not say which milestones are implemented');
  }

  return Number(match[1]);
}

/**
 * Returns the lines of the text without the quotations in “…”. Quotes can be nested and carry over
 * to the next line; a line without a single letter, which is a paragraph boundary, resets them, so
 * an unclosed quote does not hide the rest of the file.
 */
function unquotedLines(text: string): string[] {
  let depth = 0;

  return text.split('\n').map((line) => {
    if (!/\p{L}/u.test(line)) depth = 0;

    let kept = '';

    for (const char of line) {
      if (char === '“') depth += 1;
      else if (char === '”') depth = Math.max(0, depth - 1);
      else if (depth === 0) kept += char;
    }

    return kept;
  });
}

/**
 * Returns every match of a rule in the text of a file, as `path:line: match`.
 *
 * The text is read as one line without comment markers (`flatten`), so a phrase broken by a line
 * wrap, with “measured on” at the end of one line and “M0” at the start of the next, stays one
 * match, and its line is the one where the match starts.
 */
function matches(
  file: CorpusFile,
  pattern: RegExp,
  keep: (match: RegExpExecArray, line: string) => boolean = () => true,
): string[] {
  const lines = unquotedLines(file.text);
  const flat = flatten(file.path, lines.join('\n'));

  return [...flat.text.matchAll(pattern)].flatMap((match) => {
    const line = flat.lineAt(match.index);

    return keep(match, lines[line - 1]) ? [`${file.path}:${line}: ${match[0]}`] : [];
  });
}

function changeWords(file: CorpusFile): string[] {
  const allowed = ALLOWED.filter((entry) => entry.path === file.path);

  return matches(file, CHANGE_WORD, (_, line) =>
    allowed.every((entry) => !line.includes(entry.phrase)),
  );
}

function datedStatuses(file: CorpusFile): string[] {
  return matches(file, DATED_STATUS);
}

function completedMilestones(file: CorpusFile, completed: number): string[] {
  if (MILESTONE_HOMES.has(file.path) || file.path.startsWith(GATE_COMMAND)) return [];

  const flat = flatten(file.path, unquotedLines(file.text).join('\n'));
  /** The milestone in a gate name ends where the name itself ends. */
  const gateNameEnds = new Set(
    [...flat.text.matchAll(GATE_NAME)].map((match) => match.index + match[0].length),
  );

  return matches(
    file,
    MILESTONE,
    (match) => Number(match[1]) <= completed && !gateNameEnds.has(match.index + match[0].length),
  );
}

/**
 * Returns the Skill as a corpus. The Skill is outside the reference corpus but also describes the
 * system, not its changes, because an agent reads it, and the history of the project is of no use
 * to that agent.
 */
function skillCorpus(): CorpusFile[] {
  return skillFiles().map((file) => ({
    path: file.repoPath,
    role: 'normative',
    text: file.text,
  }));
}

/**
 * Returns the ADRs whose status is not “Accepted”: a decision that does not stand is deleted with
 * its ADR.
 */
function inactiveAdrs(): string[] {
  return readdirSync(resolve(REPO_ROOT, 'docs/decisions'))
    .filter((name) => /^\d{4}-.*\.md$/.test(name))
    .filter(
      (name) => !/^\| \*\*Status\*\* \| Accepted \|$/m.test(repoFile(`docs/decisions/${name}`)),
    );
}

/**
 * Returns the `<a id>` anchors that nothing refers to, since such an anchor keeps the name of
 * what no longer exists.
 */
function orphanAnchors(file: CorpusFile, everything: readonly CorpusFile[]): string[] {
  if (!file.path.endsWith('.md')) return [];

  return file.text.split('\n').flatMap((line, index) =>
    [...line.replace(/`[^`]*`/g, '').matchAll(/<a id="([^"]+)"><\/a>/g)]
      .map((match) => match[1] ?? '')
      .filter((id) => !everything.some((other) => other.text.includes(`#${id}`)))
      .map((id) => `${file.path}:${index + 1}: ${id}`),
  );
}

describe('final state, not history', () => {
  const corpus = loadCorpus();
  const completed = lastCompleted(repoFile('README.md'));

  it('a change word appears only where it is legitimate', () => {
    expect(corpus.flatMap(changeWords)).toEqual([]);
  });

  it('the Skill describes the system as it is and has no change words', () => {
    expect(skillCorpus().flatMap(changeWords)).toEqual([]);
    expect(skillCorpus().flatMap(datedStatuses)).toEqual([]);
    expect(skillCorpus().flatMap((file) => completedMilestones(file, completed))).toEqual([]);
  });

  it('no status or measurement is tied to a milestone', () => {
    expect(corpus.flatMap(datedStatuses)).toEqual([]);
  });

  it('outside the plan, a completed milestone appears only as the name of its gate', () => {
    expect(corpus.flatMap((file) => completedMilestones(file, completed))).toEqual([]);
  });

  /**
   * The registers of the plan hold only what is open: an entry that has stopped being open is
   * removed from the register (`docs/README.md` § “Where the “why” lives”).
   */
  it('the registers of the plan hold only what is open', () => {
    const plan = repoFile('docs/5-plan.md');

    expect([...plan.matchAll(/^\| \*\*(?:DEF|GAP)-\d+\*\* \|/gm)].length).toBeGreaterThan(0);
    expect([...closedRegistersIn(plan)]).toEqual([]);
  });

  it('every ADR describes a decision that stands', () => {
    expect(corpus.some((file) => file.path.startsWith('docs/decisions/'))).toBe(true);
    expect(inactiveAdrs()).toEqual([]);
  });

  it('every anchor has an incoming link', () => {
    const everything = loadCorpus();

    expect(
      corpus
        .filter((file) => file.role === 'normative')
        .flatMap((file) => orphanAnchors(file, everything)),
    ).toEqual([]);
  });

  /** An exception whose phrase is gone would let anything through in the same file. */
  it('every exception still stands in its file', () => {
    const stale = ALLOWED.filter((entry) => !repoFile(entry.path).includes(entry.phrase));

    expect(stale).toEqual([]);
  });

  /** Without this, an empty corpus or a blind regex would pass the checks above silently. */
  it('sees the corpus and the completed milestones', () => {
    expect(corpus.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        'app/src/runs/run-trace.repository.ts',
        'app/prisma/schema.prisma',
        'contracts/canonical.yaml',
        'docs/2-system.md',
        'infra/docker/gbrain/Dockerfile',
        '.dockerignore',
        'infra/postgres/init.sql',
        'contracts/notion-workspace.yaml',
        'docs/decisions/0041-gate-environment.md',
        'docs/appendix/research.md',
      ]),
    );
    expect(
      corpus
        .filter((file) => file.path.startsWith('docs/decisions/'))
        .map((file) => file.path)
        .filter((path) => !/^docs\/decisions\/\d{4}-[a-z0-9-]+\.md$/.test(path)),
    ).toEqual([]);
    expect(skillCorpus().map((file) => file.path)).toContain(
      'plugin/skills/personal-management-system/knowledge/detectors.md',
    );
    expect(completed).toBeGreaterThanOrEqual(0);
  });

  it('the rules catch what they must and pass the rest', () => {
    const file = (path: string, lines: readonly string[]): CorpusFile => ({
      path,
      role: 'normative',
      text: lines.join('\n'),
    });
    const words = file('docs/probe.md', [
      'It is denied from now on, and the facts are as before.',
      'The App now writes the comment itself.',
      'A row of the old format waits.',
      'The former mechanism held a lease.',
      'Check that the facts are as before.',
      'Everything holds, as on the previous build.',
      'The field was added after the fix.',
      'Following the audit, the schema changed.',
      'The behavior was replaced by the decision above.',
      'The probe was renamed last week.',
      'An update that first brings reviews ships switched off.',
      'The code no longer has that branch.',
      'which is how `thinking_tokens` came about',
      '| **GAP-13** | **Narrowed:** the CLI loads policies |',
      '**Deviation of the implementation from the text above:** a flag',
      'measured on gate transcripts 2026-10-20',
      'The runner is off until there is a Skill.',
      'Available Now is the set of Tasks one can start.',
      'The row stays as before the claim.',
      'The page no longer exists.',
      'The proposal still waits for a decision.',
      'Roll back to the previous image.',
      'A snooze instead of a reminder.',
      'the norm cites “the App now writes” as an example',
      'the date 2026-10-20 in a fixture',
      'Not before Friday.',
      'as previously stated',
      'as it used to be',
      'Merged from two statements',
      'the token is used to sign',
      'Follow the old rule here.',
      'Never resend the old one.',
      'The denial was measured on the pinned CLI.',
      'The candidate comparison (v2 Skill)',
      'The branch is no longer in the code.',
      'The review first reached the person on time.',
      'Wait until there is an answer from the person.',
    ]);

    expect(changeWords(words)).toEqual([
      'docs/probe.md:2: now writes',
      'docs/probe.md:3: the old format',
      'docs/probe.md:4: former mechanism',
      'docs/probe.md:6: as on the previous',
      'docs/probe.md:7: after the fix',
      'docs/probe.md:8: Following the audit',
      'docs/probe.md:9: was replaced',
      'docs/probe.md:10: was renamed',
      'docs/probe.md:11: first brings',
      'docs/probe.md:12: The code no longer',
      'docs/probe.md:13: which is how `thinking_tokens` came about',
      'docs/probe.md:14: **Narrowed:**',
      'docs/probe.md:15: Deviation of the implementation from the text',
      'docs/probe.md:16: measured on gate transcripts 2026-10-20',
      'docs/probe.md:17: until there is a Skill',
      'docs/probe.md:27: previously',
      'docs/probe.md:28: used to',
      'docs/probe.md:29: Merged from',
      'docs/probe.md:31: the old rule',
      'docs/probe.md:33: was measured',
      'docs/probe.md:34: v2 Skill',
      'docs/probe.md:35: no longer in the code',
    ]);

    const statuses = file('docs/probe.md', [
      '**Closed in M3.** Description.',
      'Narrowed in M3: a limit.',
      'a grant carried over from M0',
      'the consumer arrives in M10',
      'measured against a live provider',
    ]);

    expect(datedStatuses(statuses)).toEqual([
      'docs/probe.md:1: Closed in M3',
      'docs/probe.md:2: Narrowed in M3',
      'docs/probe.md:3: carried over from M0',
    ]);

    const milestones = [
      'measured on M0',
      'rows older than M3',
      'The gate M3 command and criterion 2 of gate M2',
      'the consumer appears in M4, calibration in M10',
      'the norm cites “rows older than M3”',
    ];

    expect(completedMilestones(file('docs/probe.md', milestones), 3)).toEqual([
      'docs/probe.md:1: M0',
      'docs/probe.md:2: M3',
    ]);
    expect(
      orphanAnchors(
        file('docs/probe.md', ['<a id="gone"></a>', '<a id="kept"></a>', '`<a id="code"></a>`']),
        [file('docs/other.md', ['[see](probe.md#kept)'])],
      ),
    ).toEqual(['docs/probe.md:1: gone']);
    // A line wrap does not break a phrase, in prose or in a comment.
    const wrapped = file('app/src/probe.ts', [
      ' * The row stays as on the',
      ' * previous build; measured on',
      ' * M0, and gate',
      ' * M3 is a name.',
    ]);

    expect(changeWords(wrapped)).toEqual(['app/src/probe.ts:1: as on the previous']);
    expect(datedStatuses(wrapped)).toEqual(['app/src/probe.ts:2: measured on M0']);
    expect(completedMilestones(wrapped, 3)).toEqual(['app/src/probe.ts:3: M0']);
    expect(completedMilestones(file('docs/5-plan.md', milestones), 3)).toEqual([]);
    expect(completedMilestones(file('app/test/gate/probe.ts', milestones), 3)).toEqual([]);
  });
});

/**
 * What must not reach the published text, across the whole corpus, ADRs and appendices included:
 * a commit SHA, a path from an installation, words about several users, and the state of the
 * repository in prose, since a document does not list what the repository lacks.
 */
const UNPUBLISHED: readonly { readonly what: string; readonly pattern: RegExp }[] = [
  { what: 'commit reference', pattern: /commit\s+`[0-9a-f]{7,40}`/giu },
  { what: 'installation path', pattern: /infra\/\.secrets/gu },
  {
    what: 'words about several users',
    pattern: /multi-?user|\bsingle-?user\b|\bsecond\s+user\b|\b(?:several|multiple)\s+users\b/giu,
  },
  {
    what: 'repository state in prose',
    pattern:
      /\b(?:the\s+)?repository\s+(?:has|contains)\s+no\b|\b(?:is|are)\s+absent\s+from\s+the\s+repository\b|\bno\s+longer\s+in\s+the\s+repository\b/giu,
  },
  { what: 'local path', pattern: /\/Users\/[^/\s]+\//gu },
  {
    what: 'e-mail address',
    pattern: /[\w.+-]+@(?![\w-]*\.?example\.|[\w.-]*\.test\b)[\w-]+(?:\.[\w-]+)*\.[A-Za-z]{2,}\b/gu,
  },
  {
    what: 'tunnel address',
    pattern: /\b[\w-]+\.(?:ngrok(?:-free)?\.(?:app|dev|io)|trycloudflare\.com|ts\.net)\b/gu,
  },
];

/**
 * A section about the state of the gate or the current state: milestones and gates live in the
 * plan, and the verdict lives outside the tree.
 */
const STATE_HEADING = /^#{1,6}[ \t]+.*(?:Gate status|Current state)/u;

function unpublished(file: CorpusFile): string[] {
  const flat = flatten(file.path, file.text);

  return UNPUBLISHED.flatMap(({ what, pattern }) =>
    [...flat.text.matchAll(pattern)].map(
      (match) => `${file.path}:${flat.lineAt(match.index)}: ${what}`,
    ),
  );
}

function stateHeadings(file: CorpusFile): string[] {
  if (!file.path.startsWith('docs/')) return [];

  return file.text
    .split('\n')
    .flatMap((line, index) =>
      STATE_HEADING.test(line) ? [`${file.path}:${index + 1}: ${line}`] : [],
    );
}

describe('published text', () => {
  const corpus = loadCorpus();

  it('has no commit, paths, addresses or words about several users, in the Skill too', () => {
    expect(corpus.flatMap(unpublished)).toEqual([]);
    expect(skillCorpus().flatMap(unpublished)).toEqual([]);
  });

  /** An applied migration does not change, so a reference to a document section would go stale. */
  it('applied migrations do not refer to sections of documents', () => {
    const root = resolve(REPO_ROOT, 'app/prisma/migrations');
    const pointers = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `app/prisma/migrations/${entry.name}/migration.sql`)
      .flatMap((path) =>
        repoFile(path)
          .split('\n')
          .flatMap((line, index) =>
            /RUNBOOK\s*§|\.md`?\s*§/u.test(line) ? [`${path}:${index + 1}`] : [],
          ),
      );

    expect(pointers).toEqual([]);
  });

  it('docs has no section on the state of the gate or the current state', () => {
    expect(corpus.flatMap(stateHeadings)).toEqual([]);
  });

  /** Without this, a corpus without ADRs or a blind regex would pass the checks above silently. */
  it('sees the ADRs and catches what it must', () => {
    const file = (path: string, lines: readonly string[]): CorpusFile => ({
      path,
      role: 'normative',
      text: lines.join('\n'),
    });

    expect(corpus.map((entry) => entry.path)).toContain(
      'docs/decisions/0011-capability-modules-over-platform.md',
    );
    expect(
      unpublished(
        file('docs/decisions/probe.md', [
          'At the time of the decision (commit `899f6af`) the map',
          'commit `main` is not a SHA',
          'the file `infra/.secrets/grant.json`',
          'A multi-user system',
          'a single-user system, for a second user, several users',
          'The repository has no re-registration script.',
          'The file is absent from the repository.',
          'The script is no longer in the repository.',
          'The branch is not in the code: it is unreachable.',
          'notes in /Users/someone/notes, mail to owner@mail.org, the tunnel app-1.ngrok-free.app',
          'contact admin@example.com and client@gate.test, host app@127.0.0.1',
        ]),
      ),
    ).toEqual([
      'docs/decisions/probe.md:1: commit reference',
      'docs/decisions/probe.md:3: installation path',
      'docs/decisions/probe.md:4: words about several users',
      'docs/decisions/probe.md:5: words about several users',
      'docs/decisions/probe.md:5: words about several users',
      'docs/decisions/probe.md:5: words about several users',
      'docs/decisions/probe.md:6: repository state in prose',
      'docs/decisions/probe.md:7: repository state in prose',
      'docs/decisions/probe.md:8: repository state in prose',
      'docs/decisions/probe.md:10: local path',
      'docs/decisions/probe.md:10: e-mail address',
      'docs/decisions/probe.md:10: tunnel address',
    ]);
    expect(
      stateHeadings(
        file('docs/probe.md', [
          '# 1. Current state',
          '## Gate status M3',
          'Gate status is not a heading',
        ]),
      ),
    ).toEqual(['docs/probe.md:1: # 1. Current state', 'docs/probe.md:2: ## Gate status M3']);
    expect(stateHeadings(file('app/probe.md', ['# Current state']))).toEqual([]);
  });
});
