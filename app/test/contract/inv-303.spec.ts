import { MAX_PROPOSAL_CHARS, OPEN_PROPOSALS_LIMIT } from '../../src/approvals/approvals.service';
import { LISTED_EFFECTS, ProposalListWire } from '../../src/approvals/proposal.wire';
import { MAX_MCP_OUTPUT_TOKENS } from '../../src/claude/runner/run-env';
import { ContinuationStateWire } from '../../src/continuations/continuation.wire';
import { CONTINUATION_STATE_LIMIT } from '../../src/continuations/continuations.service';
import { ReasonCode } from '../../src/generated/prisma/enums';
import { RESULT_BOUNDS_CHARS } from '../../src/mcp/server/tools/app-tools';
import { bindingOf } from '../../src/notion/binding/binding';
import { MAX_NAME_CHARS, schemaMappingOf } from '../../src/notion/semantics/schema-mapping';
import { liveSchemasOf } from '../fixtures/live-schemas.fixture';
import { VALID_BINDING_FILE } from '../fixtures/notion-mapping.fixture';
import { everyAppMcpTool } from './app-mcp.surface';

/**
 * The second layer of the CLI: it saves output above ~100 KB to a file and gives the model only a
 * preview. Cyrillic in UTF-8 takes two bytes per character.
 */
const PERSISTED_OUTPUT_BYTES = 100_000;
const BYTES_PER_CHAR = 2;

/**
 * `INV-303` No App MCP tool result exceeds the threshold beyond which the CLI replaces it with an
 * error containing the file name, and the run cannot read that file.
 *
 * The bound is a property of each tool, and it can be checked without the model. Each tool declares
 * how many characters it can return. The declared bound fits both the run's token limit and the
 * output persistence limit. Where the response depends on data, the declared bound is checked
 * against the worst case.
 */
describe('INV-303', () => {
  it('every App MCP tool declares a bound on its result', async () => {
    const names = (await everyAppMcpTool()).map((tool) => tool.name);

    expect(names.filter((name) => RESULT_BOUNDS_CHARS[name] === undefined)).toEqual([]);
  });

  /** One character per token is deliberately the worst case: JSON with ids yields three to four. */
  it.each(Object.entries(RESULT_BOUNDS_CHARS))(
    '%s fits within the run limit and the output persistence limit',
    (_, bound) => {
      expect(bound).toBeLessThanOrEqual(MAX_MCP_OUTPUT_TOKENS);
      expect(bound * BYTES_PER_CHAR).toBeLessThanOrEqual(PERSISTED_OUTPUT_BYTES);
    },
  );

  /**
   * The response is bounded by the binding and by the longest name it contains. The
   * installation's binding is not part of the repository (`.gitignore`), so the lane without a
   * database does not read it: the fixture has the full set of semantics, so it exceeds the
   * installation's binding in size. The worst case is every property and every option with a name
   * of `MAX_NAME_CHARS` characters.
   */
  it('a binding with the full set of semantics and the longest names fits within the get_schema_mapping bound', () => {
    const binding = bindingOf(VALID_BINDING_FILE, 'test');
    const longest = liveSchemasOf(binding, () => 'ш'.repeat(MAX_NAME_CHARS));
    const size = JSON.stringify(schemaMappingOf(binding, longest)).length;

    expect(size).toBeLessThanOrEqual(RESULT_BOUNDS_CHARS.get_schema_mapping);
  });

  /**
   * The worst case: the limit of a page's open continuations plus one written by this run for each
   * reason, each with the longest field values.
   */
  it('the worst continuation state fits within the get_continuation_state bound', () => {
    const longest: ContinuationStateWire = {
      discussion_id: '00000000-0000-0000-0000-000000000000',
      page_id: '00000000-0000-0000-0000-000000000000',
      reason_code: 'resolution_reconciliation',
      run_at: '2026-12-31T23:59:59.999Z',
      status: 'running',
    };
    const rows = CONTINUATION_STATE_LIMIT + Object.values(ReasonCode).length;
    const size = JSON.stringify({
      continuations: Array<object>(rows).fill(longest),
      truncated: true,
    }).length;

    expect(size).toBeLessThanOrEqual(RESULT_BOUNDS_CHARS.get_continuation_state);
  });

  /** A proposal is bounded when it is written, and the display adds only the status and times. */
  it('the display bound of a proposal covers the largest proposal the App accepts', () => {
    expect(RESULT_BOUNDS_CHARS.get_pending_action).toBeGreaterThan(MAX_PROPOSAL_CHARS);
  });

  /** The worst case: the most rows, each with the most named effects and the longest ids. */
  it('the worst list of open proposals fits within the list_pending_actions bound', () => {
    const id = '00000000-0000-0000-0000-000000000000';
    const longest: ProposalListWire = {
      proposals: Array.from({ length: OPEN_PROPOSALS_LIMIT }, () => ({
        pending_action_id: id,
        discussion_id: id,
        proposed_at: '2026-12-31T23:59:59.999Z',
        effects: Array.from({ length: LISTED_EFFECTS }, () => ({ page_id: id, property_id: id })),
        effects_total: 9_999,
      })),
      truncated: true,
    };

    expect(JSON.stringify(longest).length).toBeLessThanOrEqual(
      RESULT_BOUNDS_CHARS.list_pending_actions,
    );
  });
});
