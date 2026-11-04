import { Injectable } from '@nestjs/common';
import { BotIdentity } from '../../notion/client/bot-identity';
import { NotionEvent } from './notion-event.schema';

/** Who changed Notion: the system, by its own write, or the person. */
type Author = 'system' | 'person';

/**
 * Classifies the author of an event by Notion's attribution (`docs/2-system.md` § “Webhook
 * intake”).
 *
 * Changes have two authors (ADR 0017). The system writes only through the App and REST, and
 * Notion attributes its writes to the integration bot. Notion attributes the writes Claude makes
 * through the Notion MCP to the person, and they really are the person's writes. So an event is
 * the system's own write exactly when **all** its authors are our bot. Notion aggregates a
 * person's write and the system's next write into one event. That event contains the person's
 * action and belongs to them. An event with no authors, with a foreign bot or with a bot without
 * an id is the person's too: erring on the side of a run is cheaper than missing their words.
 *
 * While the bot's identity is unknown there is nothing to classify with, so the error propagates,
 * the receipt stays `failed`, and the provider redelivers (`INV-087`).
 */
@Injectable()
export class NotionAuthorship {
  constructor(private readonly identity: BotIdentity) {}

  async of(event: NotionEvent): Promise<Author> {
    const bot = await this.identity.require();
    const { authors } = event;

    const ours =
      authors.length > 0 && authors.every((author) => author.type === 'bot' && author.id === bot);

    return ours ? 'system' : 'person';
  }
}
