/** The Notion workspace: where to send the person when the message is not about any page. */
export const WORKSPACE_LINK = 'https://www.notion.so/';

/**
 * Builds a link to a page from its id. A system message does not read the page, so the link has
 * no title: Notion opens the page from the bare id without hyphens too.
 */
export function pageLink(pageId: string): string {
  return `${WORKSPACE_LINK}${pageId.replaceAll('-', '')}`;
}
