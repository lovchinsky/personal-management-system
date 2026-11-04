import { Injectable } from '@nestjs/common';
import { Client, isFullPage, type PageObjectResponse } from '@notionhq/client';
import { NotionAccessError } from './notion.error';
import { canonicalPage, Page, RestProperty } from './page';

/** How many relation items to fetch per request. Notion allows up to 100. */
const RELATION_PAGE_SIZE = 100;

/**
 * Reads a Notion page in a form suitable for canonical decoding.
 *
 * Relations are read to the end here instead of being left truncated: a page returns only the
 * first 25 references, and the rest is available through a separate request. A reader that
 * silently returned 25 of 40 would make an incomplete list indistinguishable from a complete one.
 *
 * `INV-003`: nothing is cached. Every call reads Notion.
 */
@Injectable()
export class PageReader {
  constructor(private readonly notion: Client) {}

  async page(pageId: string): Promise<Page> {
    const response = await this.notion.pages.retrieve({ page_id: pageId });

    if (!isFullPage(response)) {
      throw new NotionAccessError(
        `page ${pageId}`,
        'the integration has no access to page content',
      );
    }

    return this.completed(response);
  }

  /**
   * Takes a page that Notion has already returned (a data source query returns whole pages) and
   * returns it in canonical form, with relations read beyond the first 25.
   */
  async completed(response: PageObjectResponse): Promise<Page> {
    const properties: Record<string, RestProperty> = {};

    for (const [name, property] of Object.entries(response.properties)) {
      properties[name] = await this.whole(response.id, property);
    }

    return canonicalPage({
      id: response.id,
      parent: response.parent,
      last_edited_time: response.last_edited_time,
      in_trash: response.in_trash,
      properties,
    });
  }

  /**
   * Reads a relation to the end using the ID as REST returned it, because that form is already
   * suitable for a URL, while the canonical form contains characters that break the request path
   * (`?`, `\\`).
   */
  private async whole(pageId: string, property: RestProperty): Promise<RestProperty> {
    if (property.type !== 'relation' || property.has_more !== true) return property;

    return {
      ...property,
      relation: await this.allRelated(pageId, property.id),
      has_more: false,
    };
  }

  private async allRelated(pageId: string, propertyId: string): Promise<{ id: string }[]> {
    const related: { id: string }[] = [];
    let cursor: string | undefined = undefined;

    do {
      const response = await this.notion.pages.properties.retrieve({
        page_id: pageId,
        property_id: propertyId,
        start_cursor: cursor,
        page_size: RELATION_PAGE_SIZE,
      });

      if (response.object !== 'list') {
        throw new NotionAccessError(
          `page ${pageId}`,
          `property ${propertyId} returned no list of relations`,
        );
      }

      for (const item of response.results) {
        if (item.type === 'relation') related.push(item.relation);
      }

      cursor = response.next_cursor ?? undefined;
    } while (cursor !== undefined);

    return related;
  }
}
