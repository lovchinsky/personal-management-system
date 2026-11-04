import { GATE_GBRAIN_SOURCE, scopeProblems, type ConnectorScopes } from './connector-scopes';

const GATE_WORKSPACE = 'gate-workspace';

const GATE: ConnectorScopes = {
  notion: { id: GATE_WORKSPACE, name: 'Personal Management System gate' },
  gbrain: { source: GATE_GBRAIN_SOURCE, reads: [GATE_GBRAIN_SOURCE] },
};

describe('the gate connector credentials', () => {
  it('a grant on the gate workspace and a client with only the gate source raise no problems', () => {
    expect(scopeProblems(GATE, GATE_WORKSPACE)).toEqual([]);
  });

  it('a grant on a foreign workspace is refused with the name of that workspace and advice', () => {
    const [problem] = scopeProblems(
      { ...GATE, notion: { id: 'owner-workspace', name: 'Main' } },
      GATE_WORKSPACE,
    );

    expect(problem).toMatch(/belongs to workspace Main \(owner-workspace\)/);
    expect(problem).toMatch(/bin\/gate notion-mcp/);
  });

  it.each([
    ['writes to the main source', { source: 'default', reads: [GATE_GBRAIN_SOURCE] }],
    [
      'also reads the main source',
      { source: GATE_GBRAIN_SOURCE, reads: [GATE_GBRAIN_SOURCE, 'default'] },
    ],
    ['reads only the main one', { source: GATE_GBRAIN_SOURCE, reads: ['default'] }],
    ['reads nothing', { source: GATE_GBRAIN_SOURCE, reads: [] }],
  ])('a GBrain client that %s is refused', (_case, gbrain) => {
    expect(scopeProblems({ ...GATE, gbrain }, GATE_WORKSPACE)).toEqual([
      expect.stringMatching(/not only the gate source: register it with --source gate/),
    ]);
  });

  it('without a grant and without a client, both reasons come together', () => {
    expect(scopeProblems({ notion: null, gbrain: null }, GATE_WORKSPACE)).toEqual([
      expect.stringMatching(/no Notion MCP grant/),
      expect.stringMatching(/no GBrain client/),
    ]);
  });
});
