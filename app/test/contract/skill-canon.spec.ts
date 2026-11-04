import { evaluationResultSchema } from '../../src/claude/result/evaluation-result';
import { outboundMessageSchema } from '../../src/delivery/port/channel.port';
import { canonical } from './contracts';
import { entryFiles, entryText, skillFiles } from './plugin-files';
import { runRouter } from './skill-router';

const CHAT = canonical.pluginEntries().chat;
const RUN = canonical.pluginEntries().run;

const runSkill = entryText(RUN, 'SKILL.md');
const chatFiles = entryFiles(CHAT);
const runFiles = entryFiles(RUN);
const files = skillFiles();

/**
 * Wake reasons the agent does not choose: only the App sets them, so the Skill's text says nothing
 * about them.
 */
const SET_BY_APP: readonly string[] = ['resolution_reconciliation'];

/**
 * The numbers and lists in the Skill are the same as in the contract. The Skill duplicates them on
 * purpose: the model reads it, not `canonical.yaml`. A duplicate that rests on the author's memory
 * alone would be the first to diverge, so a test keeps it in line.
 */
describe('the Skill and the canonical contract', () => {
  it('there is something to check', () => {
    expect(runSkill.length).toBeGreaterThan(0);
    expect(chatFiles.length).toBeGreaterThan(0);
    expect(runFiles.length).toBeGreaterThan(0);
  });

  it("the budget in the run entry is exactly the contract's retrieval_budgets", () => {
    const number = (pattern: RegExp): number => Number(pattern.exec(runSkill)?.[1]);
    const budgets: Record<string, unknown> = { ...canonical.retrievalBudgets() };

    delete budgets.per_mode;

    expect({
      max_total_tool_calls: number(/Reads:\s*(\d+) in all/),
      max_notion_tool_calls: number(/Notion (\d+)/),
      max_gbrain_tool_calls: number(/GBrain (\d+)\)/),
      max_graph_depth: number(/graph depth (\d+)/),
      max_volunteered_pages: number(/at most (\d+) of the pages GBrain suggests/),
      max_new_discussions_per_run: number(/New threads:\s*(\d+)/),
      max_notifications_per_run: number(/Notifications:\s*(\d+)/),
    }).toEqual(budgets);
  });

  /**
   * A review reads several databases, so its frame names its own budget — the one in the contract.
   */
  it.each(Object.entries(canonical.retrievalBudgets().per_mode))(
    "the %s review budget in its frame is exactly the contract's budget",
    (mode, budget) => {
      const frame = entryText(RUN, `frames/${mode}.md`);
      const [, total, notion, gbrain] =
        /Reads: (\d+) in all \(Notion (\d+), GBrain (\d+)\)/.exec(frame) ?? [];

      expect({
        max_total_tool_calls: Number(total),
        max_notion_tool_calls: Number(notion),
        max_gbrain_tool_calls: Number(gbrain),
      }).toEqual(budget);
    },
  );

  /**
   * The queue wire has only the shape (`delivery.wire.ts`): the model learns the length of the
   * question from the Skill, not from a refusal.
   */
  it('the packet question limit in the Skill is the one in the queue schema', () => {
    const limit = `in at most ${outboundMessageSchema.shape.ask.maxLength} characters`;

    expect(
      ['reviewing.md', 'notifications.md'].filter((file) => !entryText(RUN, file).includes(limit)),
    ).toEqual([]);
  });

  it("the review limits in the knowledge files are the contract's numbers", () => {
    const reviews = entryText(CHAT, 'knowledge/reviews.md');
    const scope = canonical.reviewScope();

    expect(reviews).toContain(`today and the next ${scope.daily_horizon_days} days`);
    expect(reviews).toContain(
      `the past ${scope.weekly_window_days} days and the coming ${scope.weekly_window_days} days`,
    );
    expect(reviews).toContain(`captured at least ${scope.inbox_stale_after_days} days ago`);
  });

  it("the Clarify destinations are a numbered list in the clarify knowledge file, in the contract's order", () => {
    const clarify = entryText(CHAT, 'knowledge/clarify.md');
    const listed = [...clarify.matchAll(/^\d+\. `([^`]+)`/gm)].map((match) => match[1]);

    expect(listed).toEqual(canonical.clarifyDestinations());
  });

  it('the operating loop phases are named in the result file as the contract declares them', () => {
    const result = entryText(RUN, 'result.md');

    expect(
      canonical.operatingLoop().filter((phase) => !result.includes(`| \`${phase}\` |`)),
    ).toEqual([]);
  });

  it("the wake reasons the agent chooses are named in the run entry's follow-ups file; the rest are not", () => {
    const acting = entryText(RUN, 'follow-ups.md');
    const chosen = canonical.reasonCodes().filter((code) => !SET_BY_APP.includes(code));

    expect(chosen.filter((code) => !acting.includes(`\`${code}\``))).toEqual([]);
    expect(SET_BY_APP.filter((code) => files.some((file) => file.text.includes(code)))).toEqual([]);
  });

  it('every detector label of the contract is named in the knowledge files', () => {
    const detectors = entryText(CHAT, 'knowledge/detectors.md');

    expect(
      canonical.detectorLabels().filter((label) => !detectors.includes(`### ${label}`)),
    ).toEqual([]);
  });
});

/**
 * The Skill names capabilities, and only real ones: a capability that is not in the contract
 * cannot be found by the model through the `[capability: …]` label, and the tool name differs on
 * the two paths.
 */
describe('the Skill and the App capabilities', () => {
  const app = canonical.mcpToolsets().app;
  const capabilities = Object.keys(app.capabilities);
  const toolNames = Object.values(app.capabilities).flat();

  /**
   * An identifier of the form `group_action` in backticks, where the group and the action come
   * from capability names. That restriction keeps `capture_policy` (a permission value, not a
   * capability) out.
   */
  const groups = new Set(capabilities.map((name) => name.split('_')[0]));
  const verbs = new Set(capabilities.map((name) => name.split('_')[1]));

  function mentioned(texts: readonly string[]): string[] {
    return [
      ...new Set(
        texts.flatMap((text) =>
          [...text.matchAll(/`([a-z]+_[a-z]+)`/g)]
            .map((match) => match[1])
            .filter((name) => {
              const [group, verb] = name.split('_');

              return groups.has(group) && verbs.has(verb);
            }),
        ),
      ),
    ];
  }

  /** Returns the capabilities the App provides to a mode: the expanded bundles of its row. */
  function capabilitiesOf(mode: string): string[] {
    const bundles = canonical.modeToolsets().rows[mode]?.app ?? [];

    return bundles.flatMap((bundle) => app.bundles[bundle] ?? []);
  }

  it('every named capability exists in the contract', () => {
    expect(
      mentioned(files.map((file) => file.text)).filter((name) => !capabilities.includes(name)),
    ).toEqual([]);
  });

  it('the Skill names capabilities, not tool names', () => {
    const text = files.map((file) => file.text).join('\n');

    expect(toolNames.filter((name) => new RegExp(`\\b${name}\\b`).test(text))).toEqual([]);
  });

  /** The Chat entry promises the person only what their session actually has. */
  it('Chat names only the capabilities of chat_toolset', () => {
    const inChat = canonical.chatToolset().app;

    expect(
      mentioned(chatFiles.map((file) => file.text)).filter((name) => !inChat.includes(name)),
    ).toEqual([]);
  });

  it.each(canonical.runFrames())('the %s frame names only the capabilities of its mode', (mode) => {
    const own = capabilitiesOf(mode);

    expect(
      mentioned([entryText(RUN, `frames/${mode}.md`)]).filter((name) => !own.includes(name)),
    ).toEqual([]);
  });

  /**
   * An action file teaches how to use a capability — a comment, a continuation, a notification, a
   * proposal. A mode that reads it first must have that capability: otherwise the model is given
   * an instruction it has no means to follow.
   * The check covers only action files: `result.md` and `SKILL.md` legitimately name all tools.
   */
  it.each(canonical.runFrames())(
    'mode %s reads first only action files whose capability it has',
    (mode) => {
      const actionFiles: Readonly<Record<string, string>> = {
        'acting.md': 'attention',
        'follow-ups.md': 'continuation',
        'notifications.md': 'delivery',
        'proposals.md': 'approval',
      };
      const bundles = canonical.modeToolsets().rows[mode]?.app ?? [];
      const first = runRouter().find((row) => row.situation === mode)?.first ?? [];
      const lacking = first.filter((path) => {
        const bundle = actionFiles[path.split('/').pop() ?? ''];

        return bundle !== undefined && !bundles.includes(bundle);
      });

      expect(lacking).toEqual([]);
    },
  );

  it('the shared run files name only capabilities that at least one of its modes has', () => {
    const anyFrame = new Set(canonical.runFrames().flatMap(capabilitiesOf));
    const shared = ['acting.md', 'result.md', 'SKILL.md'].map((path) => entryText(RUN, path));

    expect(mentioned(shared).filter((name) => !anyFrame.has(name))).toEqual([]);
  });
});

/** The result examples in the run entry are results the App would actually accept. */
describe('result examples', () => {
  const examples = entryFiles(RUN).flatMap((file) =>
    [...file.text.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => match[1]),
  );

  it('there are examples', () => {
    expect(examples.length).toBeGreaterThan(0);
  });

  it.each(examples.map((example, at) => [at + 1, example] as const))(
    'example %i passes the result schema, and its labels come from the contract',
    (_at, example) => {
      const parsed = evaluationResultSchema.safeParse(JSON.parse(example));

      expect(parsed.error?.issues ?? []).toEqual([]);
      expect(
        (parsed.data?.detections ?? [])
          .map((detection) => detection.type)
          .filter((label) => !canonical.detectorLabels().includes(label)),
      ).toEqual([]);
    },
  );
});

/**
 * Where the platform reads an entry, its rules apply, so the shape of an entry is a set of limits,
 * not style.
 */
describe.each([
  ['Chat', CHAT],
  ['run', RUN],
] as const)('the shape of the %s entry', (_label, entry) => {
  const skill = entryText(entry, 'SKILL.md');
  const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(skill)?.[1] ?? '';
  const keys = frontmatter.split('\n').flatMap((line) => /^([a-z-]+):/.exec(line)?.[1] ?? []);
  const description = /^description: (.*)$/m.exec(frontmatter)?.[1] ?? '';

  /**
   * The frontmatter keeps to the keys common to all clients, because claude.ai may reject the rest
   * along with the plugin.
   */
  it('the frontmatter has only name and description, and name is the directory name', () => {
    expect(keys).toEqual(['name', 'description']);
    expect(new RegExp(`^name: ${entry}$`, 'm').test(frontmatter)).toBe(true);
  });

  it('description fits the platform limit and contains no angle-bracket tags', () => {
    expect(description.length).toBeGreaterThan(0);
    expect(description.length).toBeLessThanOrEqual(1024);
    expect(description).not.toMatch(/[<>]/);
  });
});

/**
 * Substitution happens before the model reads the text. `$ARGUMENTS`, `$0`…`$9`, `${…}` and
 * `!`command`` act only in the body of an entry's `SKILL.md`, and only the run entry needs a
 * substitution, the trigger envelope. In the other files, which `Read` reads, the substitution
 * notation would stay raw text.
 */
describe('substitution syntax', () => {
  it('the trigger envelope is substituted exactly once, in the run entry', () => {
    expect(runSkill.match(/\$ARGUMENTS/g)).toHaveLength(1);
    expect(
      files
        .filter((file) => file.path !== `skills/${RUN}/SKILL.md`)
        .filter((file) => file.text.includes('$ARGUMENTS'))
        .map((file) => file.path),
    ).toEqual([]);
  });

  /** Files are read from the directory of their entry, so the text needs no plugin variables. */
  it('there are no plugin variables in the text', () => {
    expect(files.filter((file) => /\$\{/.test(file.text)).map((file) => file.path)).toEqual([]);
  });

  it('no file contains positional arguments or executable commands', () => {
    expect(
      files
        .filter((file) => /\$\d|!`/.test(file.text.replaceAll('$ARGUMENTS', '')))
        .map((file) => file.path),
    ).toEqual([]);
  });
});
