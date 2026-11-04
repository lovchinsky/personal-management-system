import { Injectable, Logger } from '@nestjs/common';
import {
  Client,
  isFullBlock,
  iteratePaginatedAPI,
  type ListBlockChildrenParameters,
} from '@notionhq/client';
import { PageBlock } from '../page';

/** How many blocks to fetch per request. Notion allows up to 100. */
const BLOCK_PAGE_SIZE = 100;

/**
 * A ceiling for one body. It is a safeguard, not a size policy: a page with thousands of nested
 * blocks would use up the request quota before it returned any content.
 */
const MAX_BLOCKS = 500;

/**
 * Reads the page body.
 *
 * The body is read **in full**: there are no named sections, and the prose semantics (the
 * boundary of the work, the behavior description, a note) share one carrier. Nested blocks are
 * part of what is read and come back in reading order, right after their parent: the tree is
 * flattened and the order is kept.
 *
 * The cost is spelled out: every block with children costs a request of its own.
 */
@Injectable()
export class BodyReader {
  private readonly logger = new Logger(BodyReader.name);

  constructor(private readonly notion: Client) {}

  /** An empty array means an empty body, which is an answer, not an absence. */
  async body(pageId: string): Promise<readonly PageBlock[]> {
    const blocks: PageBlock[] = [];

    await this.collect(pageId, blocks);

    if (blocks.length >= MAX_BLOCKS) {
      this.logger.warn(`Body of page ${pageId} is cut at ${MAX_BLOCKS} blocks`);
    }

    return blocks;
  }

  private async collect(blockId: string, into: PageBlock[]): Promise<void> {
    const children = iteratePaginatedAPI(
      (args: ListBlockChildrenParameters) => this.notion.blocks.children.list(args),
      { block_id: blockId, page_size: BLOCK_PAGE_SIZE },
    );

    for await (const block of children) {
      if (into.length >= MAX_BLOCKS) return;
      if (!isFullBlock(block)) continue;

      into.push(block);

      if (block.has_children) await this.collect(block.id, into);
    }
  }
}
