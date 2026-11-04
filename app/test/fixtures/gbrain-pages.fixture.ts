import { parse } from 'yaml';
import { z } from 'zod';
import type { PageRead } from '../../src/knowledge/gbrain-pages';

/** The Project id from the contract's example (`gbrain_anchor_shape.example`). */
export const ALPHA_ID = 'a0865184-6cda-69f0-e8e0-3884c8610ce5';
export const BETA_ID = '6da95a57-78ae-72fc-a71d-23a267cf2aa6';

/**
 * Builds a page the way `get_page` returns it. Whatever the test does not override is taken from
 * the anchor of the Alpha Project.
 */
export function pageRead(overrides: Partial<PageRead> = {}): PageRead {
  return {
    slug: `projects/${ALPHA_ID.replaceAll('-', '')}`,
    type: 'project',
    title: 'Launch Alpha',
    compiledTruth: `# Launch Alpha\n\nNotion: ${ALPHA_ID}\n`,
    timeline: '',
    frontmatter: { notion_id: ALPHA_ID, aliases: ['Alpha launch'] },
    deleted: false,
    ...overrides,
  };
}

const contentSchema = z.object({
  type: z.string(),
  title: z.string(),
});

/**
 * Converts page content (`put_page`) into the form in which `get_page` will return it. GBrain
 * moves `type` and `title` out of the frontmatter into separate fields, and the body before the
 * timeline is the compiled truth.
 */
export function pageFromContent(slug: string, content: string): PageRead {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(content);

  if (match === null) throw new Error('the content has no frontmatter block');

  const meta: Record<string, unknown> = z
    .record(z.string(), z.unknown())
    .parse(parse(match[1] ?? ''));
  const { type, title } = contentSchema.parse(meta);
  const frontmatter = Object.fromEntries(
    Object.entries(meta).filter(([key]) => key !== 'type' && key !== 'title'),
  );

  return {
    slug,
    type,
    title,
    compiledTruth: (match[2] ?? '').trim(),
    timeline: '',
    frontmatter,
    deleted: false,
  };
}
