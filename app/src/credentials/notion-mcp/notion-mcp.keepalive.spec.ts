import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { addDays, addHours, subDays } from 'date-fns';
import { workersConfig, type WorkersConfig } from '../../platform/worker/workers.config';
import { notionMcpConfig, type NotionMcpConfig } from './notion-mcp.config';
import { GrantStatus, KeepAlive, NotionMcpGrant } from './notion-mcp.grant';
import { NotionMcpKeepalive } from './notion-mcp.keepalive';

/** The loop does not start here: the test calls the tick itself. */
const WORKERS: WorkersConfig = { enabled: false };

const NOTION_MCP: NotionMcpConfig = notionMcpConfig();

function status(ceilingInDays: number): GrantStatus {
  const now = new Date();

  return {
    obtainedAt: subDays(now, 1),
    refreshedAt: now,
    accessTokenExpiresAt: addHours(now, 8),
    inactiveAfter: addDays(now, 30),
    ceilingAt: addDays(now, ceilingInDays),
  };
}

/**
 * Creates a keepalive over a stub grant. The grant decides “refresh or not”; here the question is
 * what to say about it.
 */
async function keepaliveAnswering(kept: KeepAlive): Promise<NotionMcpKeepalive> {
  const grant: Pick<NotionMcpGrant, 'keepAlive'> = { keepAlive: () => Promise.resolve(kept) };
  const moduleRef = await Test.createTestingModule({
    providers: [
      NotionMcpKeepalive,
      { provide: NotionMcpGrant, useValue: grant },
      { provide: notionMcpConfig.KEY, useValue: NOTION_MCP },
      { provide: workersConfig.KEY, useValue: WORKERS },
    ],
  }).compile();

  return moduleRef.get(NotionMcpKeepalive);
}

describe('Notion MCP grant keepalive', () => {
  let warned: jest.SpyInstance;

  beforeEach(() => {
    warned = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  it('with no grant, says where the person should go', async () => {
    await expect((await keepaliveAnswering({ kind: 'absent' })).runOnce()).resolves.toBe(0);
    expect(warned).toHaveBeenCalledWith('Notion MCP is not authorized — RUNBOOK §6.3');
  });

  it('counts a refreshed grant as work done and stays silent about a distant ceiling', async () => {
    const kept: KeepAlive = { kind: 'refreshed', status: status(100) };

    await expect((await keepaliveAnswering(kept)).runOnce()).resolves.toBe(1);
    expect(warned).not.toHaveBeenCalled();
  });

  it('two weeks before the ceiling, warns that the person is needed', async () => {
    await (await keepaliveAnswering({ kind: 'fresh', status: status(10) })).runOnce();

    expect(warned).toHaveBeenCalledWith(expect.stringContaining('authorize again before then'));
  });
});
