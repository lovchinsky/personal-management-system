import { Injectable } from '@nestjs/common';
import { Client, isFullPage, type QueryDataSourceParameters } from '@notionhq/client';
import { NotionAccessError } from './notion.error';
import { Page } from './page';
import { PageReader } from './page.reader';

/**
 * A data source query filter in Notion's form; the semantic adapter builds it from canonical
 * slots.
 */
export type QueryFilter = NonNullable<QueryDataSourceParameters['filter']>;

/**
 * The order of the pages in the response, in Notion's form: the query limit cuts off the end of
 * this order.
 */
export type QuerySorts = NonNullable<QueryDataSourceParameters['sorts']>;

/** The maximum number of pages Notion returns in one request. */
const MAX_PAGE_SIZE = 100;

interface QueryResult {
  readonly pages: readonly Page[];
  /**
   * Whether everything that passes the filter was returned. `false` means the limit cut the query
   * off: “the candidate is not among those read” then does not mean “there is no candidate”.
   */
  readonly complete: boolean;
}

/**
 * Reads the pages of a data source that pass the filter. The App makes this deterministic read
 * over REST.
 *
 * The limit is mandatory: a pass that read everything the filter returns would be unbounded by
 * construction. `INV-003`: nothing is cached.
 */
@Injectable()
export class DataSourceQuery {
  constructor(
    private readonly notion: Client,
    private readonly reader: PageReader,
  ) {}

  async query(
    dataSourceId: string,
    filter: QueryFilter,
    limit: number,
    sorts?: QuerySorts,
  ): Promise<QueryResult> {
    const pages: Page[] = [];
    let cursor: string | undefined = undefined;
    let more = false;

    do {
      const response = await this.notion.dataSources.query({
        data_source_id: dataSourceId,
        filter,
        ...(sorts ? { sorts } : {}),
        start_cursor: cursor,
        page_size: Math.min(MAX_PAGE_SIZE, limit - pages.length),
      });

      for (const result of response.results) {
        if (result.object !== 'page') continue;

        if (!isFullPage(result)) {
          throw new NotionAccessError(
            `data source ${dataSourceId}`,
            `the integration has no access to the content of page ${result.id}`,
          );
        }

        pages.push(await this.reader.completed(result));
      }

      more = response.has_more;
      cursor = response.next_cursor ?? undefined;
    } while (more && cursor !== undefined && pages.length < limit);

    return { pages, complete: !more };
  }
}
