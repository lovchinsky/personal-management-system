import { ImmediateWrites } from '../../effects/immediate-writes';
import { Actor, CHAT } from '../../runs/actor';
import { chatTools } from '../../runs/toolsets';
import { McpIdentity, McpSession } from './mcp-session';

/**
 * A chat session in the App MCP, with the person speaking for themselves, the `chat_toolset` and
 * a write policy that writes at once.
 *
 * A chat has no run trace and is not an App-triggered run. The session keeps nothing between
 * requests, because each request stands alone (ADR 0014). The OAuth token says who connected. The
 * session has only the consequence: it is the person, and the person is speaking.
 */
export class ChatSession implements McpSession {
  readonly identity: McpIdentity = { surface: 'chat' };

  readonly actor: Actor = CHAT;

  readonly tools: ReadonlySet<string> = new Set(chatTools());

  constructor(readonly writes: ImmediateWrites) {}
}
