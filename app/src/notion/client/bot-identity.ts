import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Client } from '@notionhq/client';
import { messageOf } from '../../platform/error/message-of';
import { BotIdentityUnknownError } from './notion.error';

/**
 * Who we are, as Notion sees it.
 *
 * The identifier is fetched from Notion itself (`users.me`), not taken from the environment. It is
 * not a hard dependency of startup: the request at startup is an attempt, not a condition, and is
 * repeated on demand (`docs/2-system.md` § “Webhook intake”).
 *
 * The cost of an unknown identifier is spelled out: the system writes nothing to Notion, because
 * there is nothing to check a write against. Intake does not classify events and leaves them to
 * the provider to redeliver (`docs/2-system.md` § “Webhook intake”).
 */
@Injectable()
export class BotIdentity implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(BotIdentity.name);

  private id?: string;

  /** Why Notion did not answer last time: the reason `require()` refuses. */
  private failure?: unknown;

  /** The request sent at startup, which may not have returned yet. */
  private asked?: Promise<string | undefined>;

  constructor(private readonly notion: Client) {}

  onApplicationBootstrap(): void {
    // No `await`: startup does not wait for Notion. `resolve()` does not throw, so the only
    // consequence of a slow or unavailable answer is a later log entry, not a later start of the
    // application.
    this.asked = this.resolve();
  }

  /**
   * Shutdown waits for the request sent at startup: otherwise an application closed right after
   * it came up would leave the request hanging, and the answer would be logged after the process
   * considers itself stopped.
   */
  async onApplicationShutdown(): Promise<void> {
    await this.asked;
  }

  /**
   * Returns the identity without which writing is impossible: the system would not recognize a
   * write as its own if there were nothing to check its author against (`docs/2-system.md`
   * § “System writes to Notion”). An unknown identity yields a refusal with a reason, not a blind
   * write.
   */
  async require(): Promise<string> {
    const id = await this.resolve();
    if (!id) {
      throw new BotIdentityUnknownError({ cause: this.failure });
    }

    return id;
  }

  /**
   * Attempts to find out who we are. Does not throw, because the question is not critical to
   * startup.
   */
  async resolve(): Promise<string | undefined> {
    if (this.id) return this.id;

    try {
      const me = await this.notion.users.me({});

      this.id = me.id;
      this.logger.log(`integration bot identified as ${me.id}`);
    } catch (error) {
      this.failure = error;
      this.logger.warn(
        `bot identity unknown — Notion writes and event classification wait for it: ${messageOf(error)}`,
      );
    }

    return this.id;
  }
}
