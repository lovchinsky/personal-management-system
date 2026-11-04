import {
  DECISION_MARKER,
  GBRAIN_CALL_BUDGET,
  LINK_VERBS,
  MEMORY_THRESHOLDS,
  MEMORY_WRITES,
  STANDARD_MARKER,
} from '../../src/knowledge/memory-writes';
import { MCP_TOOLSETS } from '../../src/runs/toolsets';
import { FORBIDDEN_GBRAIN_WRITES } from '../gate/gate-claims';
import { canonical } from './contracts';
import { entryText } from './plugin-files';

/**
 * Returns the App and GBrain capabilities that the `mode_toolsets` rows provide, expanded from the
 * bundles of the contract.
 */
function runCapabilities(): Set<string> {
  const toolsets = canonical.mcpToolsets();
  const gbrain = toolsets['gbrain']?.bundles ?? {};
  const app = toolsets['app']?.bundles ?? {};

  return new Set(
    Object.values(canonical.modeToolsets().rows).flatMap((row) => [
      ...row.gbrain.flatMap((bundle) => gbrain[bundle] ?? []),
      ...row.app.flatMap((bundle) => app[bundle] ?? []),
    ]),
  );
}

/** Returns the GBrain capabilities from the contract's map. */
const gbrainCapabilities = (): Set<string> =>
  new Set(Object.keys(canonical.mcpToolsets()['gbrain']?.capabilities ?? {}));

/**
 * `INV-100` GBrain write authority (`memory_writes`) matches the mode toolsets: a run authority
 * other than `none` is possible for exactly those capabilities that have `mode_toolsets` rows, and
 * `autonomous_gbrain_fact` and `autonomous_gbrain_lesson` from `capture_policy` are the same
 * statements in the form of standing authorization.
 *
 * The same fact is stated in four places: the authority table, the mode toolsets, standing
 * authorization and the thresholds in the Skill text. Here they are checked against each other,
 * not against the author's memory.
 */
describe('INV-100', () => {
  const contract = canonical.memoryWrites();

  it('the table in the code is exactly the contract table: the same kinds, with the same capabilities and authority', () => {
    expect(
      Object.fromEntries(
        MEMORY_WRITES.map((write) => [
          write.kind,
          {
            capability: write.capability,
            run: write.run,
            chat: write.chat,
            ...(write.threshold === undefined ? {} : { threshold: write.threshold }),
          },
        ]),
      ),
    ).toEqual(
      Object.fromEntries(
        Object.entries(contract.kinds).map(([kind, row]) => [
          kind,
          {
            capability: row.capability,
            run: row.run,
            chat: row.chat,
            ...(row.threshold === undefined ? {} : { threshold: row.threshold }),
          },
        ]),
      ),
    );
  });

  it('authority values come from the list in the contract, and the decision marker matches the contract', () => {
    for (const row of Object.values(contract.kinds)) {
      expect(contract.authority).toContain(row.run);
      expect(contract.authority).toContain(row.chat);
    }

    expect(contract.kinds['decision']?.marker).toBe(DECISION_MARKER);
    expect(contract.kinds['standard']?.marker).toBe(STANDARD_MARKER);
  });

  it('the GBrain call budget in the code matches retrieval_budgets in the contract', () => {
    expect(canonical.retrievalBudgets()['max_gbrain_tool_calls']).toBe(GBRAIN_CALL_BUDGET);
  });

  it('the link types in the code match the contract', () => {
    expect([...LINK_VERBS]).toEqual(contract.link_verbs);
  });

  it('every kind names an App or GBrain capability that is in the capability map', () => {
    const known = new Set([
      ...gbrainCapabilities(),
      ...Object.keys(canonical.mcpToolsets()['app']?.capabilities ?? {}),
    ]);

    expect(
      Object.values(contract.kinds)
        .map((row) => row.capability)
        .filter((capability) => !known.has(capability)),
    ).toEqual([]);
  });

  it('a run has authority for a kind exactly when the capability is in a mode_toolsets row', () => {
    const given = runCapabilities();

    for (const [kind, row] of Object.entries(contract.kinds)) {
      expect({ kind, hasTools: given.has(row.capability) }).toEqual({
        kind,
        hasTools: row.run !== 'none',
      });
    }
  });

  it('standing authorization in capture_policy is the same statement as the run authority', () => {
    const policy = canonical.capturePolicy();

    expect(policy.autonomous_gbrain_fact).toBe(contract.kinds['fact']?.run !== 'none');
    expect(policy.autonomous_gbrain_lesson).toBe(contract.kinds['lesson']?.run !== 'none');
  });

  it('the thresholds in the code are exactly those of the contract', () => {
    const thresholds = canonical.memoryThresholds();

    for (const key of ['lesson', 'cognitive_observation'] as const) {
      expect(MEMORY_THRESHOLDS[key]).toEqual({
        minIndependentEpisodes: thresholds[key].min_independent_episodes,
        requires: thresholds[key].requires,
      });
    }
  });

  it('in GBrain a run writes only through an App intent: a kind with a native capability has no run authority', () => {
    const native = gbrainCapabilities();

    expect(
      Object.entries(contract.kinds)
        .filter(([, row]) => native.has(row.capability) && row.run !== 'none')
        .map(([kind]) => kind),
    ).toEqual([]);
  });

  it('the native writes forbidden to a run in the gate are exactly the tools of the GBrain write bundle', () => {
    const gbrain = canonical.mcpToolsets()['gbrain'];
    const written = (gbrain?.bundles['write'] ?? []).flatMap(
      (capability) => gbrain?.capabilities[capability] ?? [],
    );

    expect([...FORBIDDEN_GBRAIN_WRITES].sort()).toEqual(written.sort());
    expect(FORBIDDEN_GBRAIN_WRITES.length).toBeGreaterThan(0);
  });

  it('a run has none of the forbidden native write tools in the allow-set of any mode', () => {
    const granted = new Set(
      Object.values(canonical.modeToolsets().rows).flatMap((row) =>
        row.gbrain.flatMap((bundle) =>
          (MCP_TOOLSETS.gbrain.bundles[bundle] ?? []).flatMap(
            (capability) => MCP_TOOLSETS.gbrain.capabilities[capability] ?? [],
          ),
        ),
      ),
    );

    expect(FORBIDDEN_GBRAIN_WRITES.filter((tool) => granted.has(tool))).toEqual([]);
  });

  describe('Skill text', () => {
    const chat: string = canonical.pluginEntries().chat;
    const lessons: string = entryText(chat, 'knowledge/lessons.md');
    const memory: string = entryText(chat, 'knowledge/memory.md');
    const countAfter = (text: string, subject: string): number =>
      Number(new RegExp(`${subject} needs at least (\\d+) independent episodes`).exec(text)?.[1]);

    it('the threshold numbers in the Skill match the contract', () => {
      const thresholds = canonical.memoryThresholds();

      expect(countAfter(lessons, 'A lesson')).toBe(thresholds.lesson.min_independent_episodes);
      expect(countAfter(lessons, 'A pattern')).toBe(
        thresholds.cognitive_observation.min_independent_episodes,
      );
    });

    it('the Chat Skill lists exactly the link types from the contract for the agent', () => {
      const conversation: string = entryText(chat, 'conversation/pages.md');
      const named = /one of these types, or none: ([^.]*)\./.exec(conversation)?.[1] ?? '';

      expect([...named.matchAll(/`(\w+)`/g)].map((match) => match[1])).toEqual(
        canonical.memoryWrites().link_verbs,
      );
    });

    it('the markers of a decision and of the acceptable state of an Area of Focus in the Skill match the contract', () => {
      const kinds = canonical.memoryWrites().kinds;

      expect(memory).toContain(`\`${kinds['decision']?.marker}\``);
      expect(memory).toContain(`\`${kinds['standard']?.marker}\``);
    });
  });
});
