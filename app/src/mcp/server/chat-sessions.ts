import { Injectable } from '@nestjs/common';
import { RunWrites } from '../../effects/run-writes';
import { CHAT } from '../../runs/actor';
import { ChatSession } from './chat-session';

/**
 * Chat sessions in the App MCP. Each chat request gets its own session: it keeps nothing between
 * requests, because writes are applied at once and the token says only that the person connected
 * (`docs/2-system.md` § “Authentication boundary”).
 */
@Injectable()
export class ChatSessions {
  constructor(private readonly writes: RunWrites) {}

  open(): ChatSession {
    return new ChatSession(this.writes.immediate(CHAT));
  }
}
