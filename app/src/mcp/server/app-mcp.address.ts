/** The path of the App MCP endpoint. */
export const APP_MCP_PATH = 'mcp';

/** The loopback of this process, on which the App listens for runs. */
export const LOOPBACK_HOST = '127.0.0.1';

/** Returns the App MCP address on the loopback. A run uses it, and the gate probes it. */
export function loopbackAppMcpUrl(port: number): string {
  return `http://${LOOPBACK_HOST}:${port}/${APP_MCP_PATH}`;
}
