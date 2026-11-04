import { registerAs, type ConfigType } from '@nestjs/config';
import { optional } from '../../src/platform/config/env-value';

/**
 * How many allowance-metered calls per hour a Free workspace allows (measured on gate transcripts).
 */
export const FREE_ALLOWANCE = 10;

/**
 * Returns the hourly Notion MCP query allowance from the setting: a number or `unlimited` (a
 * Business workspace, no quota). Unset means the Free quota.
 */
export function allowanceOf(value: string | undefined): number | null {
  if (value === undefined) return FREE_ALLOWANCE;
  if (value === 'unlimited') return null;

  const limit = Number(value);

  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(
      `GATE_NOTION_QUERY_ALLOWANCE takes a whole number of queries per hour or unlimited, not ${value}`,
    );
  }

  return limit;
}

/**
 * The gate configuration. `appMcpUrl` is the public address of the App MCP that the gate calls from
 * outside. It is optional: without it the gate checks only its own endpoint. `notionQueryAllowance`
 * is the hourly Notion MCP query allowance of the gate workspace (`null` means no quota).
 * `transcriptsDir` is the directory of the attempt streams: the gate writes the stream of every
 * run there and restores the quota bookkeeping from it.
 */
export const gateConfig = registerAs('gate', () => ({
  appMcpUrl: optional(process.env.APP_MCP_URL),
  notionQueryAllowance: allowanceOf(optional(process.env.GATE_NOTION_QUERY_ALLOWANCE)),
  transcriptsDir: optional(process.env.GATE_TRANSCRIPTS_DIR),
}));

export type GateConfig = ConfigType<typeof gateConfig>;
