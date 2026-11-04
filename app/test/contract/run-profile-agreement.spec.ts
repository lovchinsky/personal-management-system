import { DEFAULT_RUN_PROFILE, profileFor, RunProfile } from '../../src/claude/run-profile';
import { WorkflowMode } from '../../src/generated/prisma/enums';
import { canonical } from './contracts';
import { runRouter } from './skill-router';

type DeclaredProfile = ReturnType<typeof canonical.runProfile>['default'];

/** Converts the contract's profile into the terms of the code. */
function profileOf(declared: DeclaredProfile): RunProfile {
  return {
    model: declared.model,
    effort: declared.effort,
    thinking: declared.thinking,
    maxTurns: declared.max_turns,
    maxBudgetUsd: declared.max_budget_usd,
  };
}

/** The steps a run always takes, beyond reads and files: the time first, the conclusion last. */
const ALWAYS = ['runtime_read', 'StructuredOutput'];

/** The run profile in the code is the same as in the contract (ADR 0012). */
describe('the run profile and the contract', () => {
  const declared = canonical.runProfile();

  it('the shared profile matches', () => {
    expect(DEFAULT_RUN_PROFILE).toEqual(profileOf(declared.default));
  });

  it.each(Object.values(WorkflowMode))(
    'the %s profile is the shared one with the mode differences',
    (mode) => {
      expect(profileFor(mode)).toEqual(
        profileOf({ ...declared.default, ...declared.per_mode[mode] }),
      );
    },
  );

  it('the differences name only modes that exist', () => {
    const modes: readonly string[] = Object.values(WorkflowMode);

    expect(Object.keys(declared.per_mode).filter((mode) => !modes.includes(mode))).toEqual([]);
  });

  /**
   * A run makes about one call per turn. A ceiling below the total of the reads budget, the
   * first-read files, the steps a run always takes and the new discussions and notifications it may
   * write cuts the run off before its conclusion.
   */
  describe('the turn ceiling fits the reads budget, the writes and the fixed steps', () => {
    const budgets = canonical.retrievalBudgets();
    const rows = runRouter();
    const framed = Object.values(WorkflowMode).filter((mode) =>
      canonical.runFrames().includes(mode),
    );

    it.each(framed)('%s', (mode) => {
      const row = rows.find((candidate) => candidate.situation === mode);
      const reads = budgets.per_mode[mode]?.max_total_tool_calls ?? budgets['max_total_tool_calls'];
      const writes = budgets['max_new_discussions_per_run'] + budgets['max_notifications_per_run'];
      const floor = reads + (row?.first.length ?? 0) + ALWAYS.length + writes;

      expect(row).toBeDefined();
      expect(profileFor(mode).maxTurns).toBeGreaterThanOrEqual(floor);
    });
  });
});
