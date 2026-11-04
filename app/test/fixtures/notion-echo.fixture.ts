import { RestProperty } from '../../src/notion/client/page';
import { PropertyWrite } from '../../src/notion/client/property-write';
import { run } from './notion-page.fixture';

/**
 * Builds what Notion returns for a property write, in the form the adapter reads.
 *
 * A time comes back in Notion's own notation, not the one it was written in, so a check against the
 * read-back value must compare the time, not the string.
 */
export function echoOf(id: string, write: PropertyWrite): RestProperty {
  if ('title' in write) {
    return { id, type: 'title', title: write.title.map((piece) => run(piece.text.content)) };
  }

  if ('rich_text' in write) {
    return {
      id,
      type: 'rich_text',
      rich_text: write.rich_text.map((piece) => run(piece.text.content)),
    };
  }

  if ('status' in write) {
    return {
      id,
      type: 'status',
      status: { id: write.status.id, name: 'echoed', color: 'default' },
    };
  }

  if ('select' in write) {
    return {
      id,
      type: 'select',
      select: write.select && { id: write.select.id, name: 'echoed', color: 'default' },
    };
  }

  if ('date' in write) {
    return {
      id,
      type: 'date',
      date: write.date && {
        start: notionMoment(write.date.start),
        end: write.date.end && notionMoment(write.date.end),
        time_zone: write.date.time_zone,
      },
    };
  }

  return {
    id,
    type: 'relation',
    relation: write.relation.map((link) => ({ id: link.id })),
    has_more: false,
  };
}

/** Keeps a date as a date. Notion rewrites a time in UTC with milliseconds. */
function notionMoment(value: string): string {
  return value.length === 10 ? value : new Date(value).toISOString();
}
