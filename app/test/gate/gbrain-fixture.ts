import { stringify } from 'yaml';
import { anchorSlug, renderAnchor } from '../../src/knowledge/anchor-page';
import type { AnchorType } from '../../src/knowledge/anchor-types';
import type { GbrainPort } from '../../src/memory/gbrain-client';
import { canonicalNotionId } from '../../src/notion/client/notion-id';
import type { Residue } from './gate-cleanup';

/**
 * The GBrain pages that the gate puts into its worlds, and the wait until search finds them. The
 * GBrain client is in `gbrain-client.ts`, and the shape of an anchor is set by
 * `knowledge/anchor-page.ts`, so a gate world page follows the same convention as a real anchor
 * (`gbrain_anchor_shape`).
 */

/** A page ready for `put_page`: the slug and the content. */
export interface GbrainPage {
  readonly slug: string;
  readonly content: string;
}

/** What an anchor says about an object. */
interface AnchorInput {
  readonly type: AnchorType;
  /** The id of the object's Notion page, in either of the two forms. */
  readonly notionId: string;
  readonly title: string;
  /** The paragraphs of the body: a lesson or a note kept in memory about the object. */
  readonly paragraphs: readonly string[];
  readonly aliases?: readonly string[];
  /**
   * The slug when someone put the page “by hand” under another address (a duplicate); otherwise
   * by convention.
   */
  readonly slug?: string;
}

/**
 * Builds an anchor by convention: the slug from the object's id, the id in the frontmatter and in
 * the identity line of the body.
 */
export function anchorPage(input: AnchorInput): GbrainPage {
  return {
    slug: input.slug ?? anchorSlug(input.type, input.notionId),
    content: renderAnchor({
      type: input.type,
      title: input.title,
      notionId: input.notionId,
      aliases: input.aliases ?? [],
      paragraphs: input.paragraphs,
    }),
  };
}

/** What the scenario says about an ordinary page. */
interface PlainInput {
  readonly slug: string;
  readonly type: string;
  readonly title: string;
  readonly paragraphs: readonly string[];
  /** The id of a Notion page mentioned in the text: the page mentions it but is not its anchor. */
  readonly mentions?: string;
}

/**
 * Builds a page that is not an anchor: a note or lesson. Its frontmatter has only `type` and
 * `title`.
 */
export function plainPage(input: PlainInput): GbrainPage {
  const mention =
    input.mentions === undefined
      ? []
      : [`Стосується сторінки ${canonicalNotionId(input.mentions)}.`];

  return {
    slug: input.slug,
    content: [
      '---',
      stringify({ type: input.type, title: input.title }).trimEnd(),
      '---',
      '',
      `# ${input.title}`,
      ...[...mention, ...input.paragraphs].flatMap((paragraph) => ['', paragraph]),
      '',
    ].join('\n'),
  };
}

/** How many times and how often to ask search whether the page has appeared. */
export interface Waiting {
  readonly attempts: number;
  readonly pauseMs: number;
  readonly sleep: (ms: number) => Promise<void>;
}

export const DEFAULT_WAITING: Waiting = {
  attempts: 10,
  pauseMs: 2_000,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** How much of the search answer to show in the failure message. */
const ANSWER_EXCERPT_CHARS = 300;

/**
 * Repeats a probe until it succeeds or the attempts run out; `false` means it did not succeed. The
 * pause comes between attempts, not after the last one, because there is nothing to wait for.
 */
export async function until(waiting: Waiting, probe: () => Promise<boolean>): Promise<boolean> {
  for (let attempt = 0; attempt < waiting.attempts; attempt += 1) {
    if (await probe()) return true;

    if (attempt + 1 < waiting.attempts) await waiting.sleep(waiting.pauseMs);
  }

  return false;
}

/**
 * Waits until search for this text names the page with this slug. A GBrain write may be accepted
 * but not finished, and the index lags behind the write, so one query is not enough. The limit
 * keeps the wait from going on forever and keeps a scenario from starting on a world without the
 * page.
 */
export async function found(
  port: Pick<GbrainPort, 'search'>,
  text: string,
  waiting: Waiting,
  slug: string,
): Promise<void> {
  let answer = '';
  const named = await until(waiting, async () => {
    answer = await port.search(text);

    return answer.toLowerCase().includes(slug);
  });

  if (named) return;

  throw new Error(
    `GBrain search for ${text} does not name ${slug} after ${waiting.attempts} attempts: ${answer.slice(0, ANSWER_EXCERPT_CHARS)}`,
  );
}

/** The gate's cleanup register: the GBrain pages it wrote and must delete. */
type GbrainResidue = Pick<Residue, 'gbrainPages'>;

/** A GBrain page the gate puts in for a scenario: the slug, content and what search finds it by. */
export interface PlantedPage extends GbrainPage {
  /** The text by which search must name the page once it is indexed. */
  readonly findBy: string;
}

/**
 * Writes the page and waits until search finds it. The slug is added to the register before the
 * write, because a write the client did not wait for may be completed by GBrain later. Cleanup
 * must know about the page even if the write looked like a failure. Deleting a page that did not
 * come into being is not a cleanup failure.
 */
export async function plantPage(
  port: GbrainPort,
  residue: GbrainResidue,
  page: PlantedPage,
  waiting: Waiting = DEFAULT_WAITING,
): Promise<void> {
  residue.gbrainPages.push(page.slug);
  await port.putPage(page.slug, page.content);
  await found(port, page.findBy, waiting, page.slug);
}

/** What the anchor page knows about a project. */
interface ProjectInput {
  /** The id of the project's Notion page, in either of the two forms. */
  readonly notionId: string;
  readonly projectName: string;
  /**
   * The compiled truth paragraphs: what the anchor already remembers. The scenario's world names
   * them, not the fixture.
   */
  readonly paragraphs: readonly string[];
}

/**
 * Writes a project's anchor and waits until search finds it by the project id. Returns the
 * anchor's slug, because a run cites the page by it, and cleanup deletes the page by it.
 */
export async function plantAnchor(
  port: GbrainPort,
  residue: GbrainResidue,
  input: ProjectInput,
  waiting: Waiting = DEFAULT_WAITING,
): Promise<string> {
  const page = anchorPage({
    type: 'project',
    notionId: input.notionId,
    title: input.projectName,
    paragraphs: input.paragraphs,
    aliases: [input.projectName],
  });

  await plantPage(port, residue, { ...page, findBy: canonicalNotionId(input.notionId) }, waiting);

  return page.slug;
}
