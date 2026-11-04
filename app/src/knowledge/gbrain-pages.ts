import { z } from 'zod';
import { AppError } from '../platform/error/app-error';

/**
 * The GBrain responses the knowledge layer reads, and the only place where their shape is
 * written down. The gate and `anchors:check` parse responses here instead of each doing its own
 * text parsing, because the shape belongs to the GBrain version the App is bound to
 * (`docs/2-system.md` § “Runtime baseline GBrain”). If the shape diverges, the divergence must
 * be confined to one place.
 *
 * The schemas read only the fields the rules need and ignore the rest of the response. A
 * response without these fields is not “empty” but malformed: reading it throws
 * `GbrainShapeError`.
 */

/** GBrain answered in a shape other than the one the schema describes. */
export class GbrainShapeError extends AppError {
  constructor(
    readonly tool: string,
    detail: string,
    options?: ErrorOptions,
  ) {
    super(`gbrain ${tool}: ${detail}`, options);
  }
}

/**
 * Parses the JSON that a response starts with. For an empty search GBrain answers `[]` and a
 * status line (`0 results. … this is a clean miss.`). The status is not part of the data, and
 * “nothing found” is an answer, not a parsing failure.
 */
function leadingJson(text: string): unknown {
  const lines = text.split('\n');

  for (let count = lines.length; count > 0; count -= 1) {
    try {
      return JSON.parse(lines.slice(0, count).join('\n'));
    } catch {
      // A status line at the end: try without it.
    }
  }

  throw new SyntaxError('no JSON at the start of the answer');
}

function read<T>(tool: string, text: string, schema: z.ZodType<T>, trailer = false): T {
  let json: unknown;

  try {
    json = trailer ? leadingJson(text) : JSON.parse(text);
  } catch (cause) {
    throw new GbrainShapeError(tool, 'the answer is not JSON', { cause });
  }

  const parsed = schema.safeParse(json);

  if (!parsed.success) throw new GbrainShapeError(tool, z.prettifyError(parsed.error));

  return parsed.data;
}

const searchHitSchema = z.looseObject({
  slug: z.string().min(1),
  title: z.string(),
  type: z.string(),
  evidence: z.string().optional(),
});

/** A page in a `search` response: GBrain marks how it was found (`evidence`). */
export interface SearchHit {
  readonly slug: string;
  readonly title: string;
  readonly type: string;
  /** `keyword_exact` is an exact text match; the other values mean similarity. */
  readonly evidence: string | null;
}

export function parseSearchHits(text: string): SearchHit[] {
  return read('search', text, z.array(searchHitSchema), true).map((hit) => ({
    slug: hit.slug,
    title: hit.title,
    type: hit.type,
    evidence: hit.evidence ?? null,
  }));
}

const pageSchema = z.looseObject({
  slug: z.string().min(1),
  type: z.string(),
  title: z.string(),
  compiled_truth: z.string(),
  timeline: z.string(),
  frontmatter: z.record(z.string(), z.unknown()),
  deleted_at: z.string().nullish(),
});

/**
 * A page as `get_page` returns it: frontmatter without `type` and `title`, which GBrain returns
 * separately.
 */
export interface PageRead {
  readonly slug: string;
  readonly type: string;
  readonly title: string;
  /** Compiled truth together with the facts section, if there is one. */
  readonly compiledTruth: string;
  /** The text of the timeline section. */
  readonly timeline: string;
  readonly frontmatter: Readonly<Record<string, unknown>>;
  readonly deleted: boolean;
}

export function parsePage(text: string): PageRead {
  const page = read('get_page', text, pageSchema);

  return {
    slug: page.slug,
    type: page.type,
    title: page.title,
    compiledTruth: page.compiled_truth,
    timeline: page.timeline,
    frontmatter: page.frontmatter,
    deleted: page.deleted_at != null,
  };
}

/** A text field GBrain may leave unfilled: an empty value is read as an empty string. */
const optionalText = z
  .string()
  .nullish()
  .transform((value) => value ?? '');

const timelineEntrySchema = z.looseObject({
  date: z.string(),
  summary: z.string(),
  source: optionalText,
  detail: optionalText,
});

/** A row of the page's structured timeline. */
export interface TimelineEntry {
  /** A day in the form `YYYY-MM-DD`. */
  readonly date: string;
  readonly summary: string;
  readonly source: string;
  readonly detail: string;
}

export function parseTimeline(text: string): TimelineEntry[] {
  return read('get_timeline', text, z.array(timelineEntrySchema)).map((entry) => ({
    date: entry.date.slice(0, 10),
    summary: entry.summary,
    source: entry.source,
    detail: entry.detail,
  }));
}

const factsSchema = z.looseObject({
  facts: z.array(
    z.looseObject({
      fact: z.string(),
      kind: z.string(),
      entity_slug: z.string().nullable(),
      provenance: optionalText,
    }),
  ),
});

/** A fact from a `recall` response. */
export interface FactRead {
  readonly fact: string;
  readonly kind: string;
  readonly entitySlug: string | null;
  readonly provenance: string;
}

export function parseFacts(text: string): FactRead[] {
  return read('recall', text, factsSchema).facts.map((fact) => ({
    fact: fact.fact,
    kind: fact.kind,
    entitySlug: fact.entity_slug,
    provenance: fact.provenance,
  }));
}

const rememberedSchema = z.looseObject({ id: z.string().min(1), status: z.string() });

/**
 * A `remember` response: the fact id and what happened to it (`inserted`, `duplicate`,
 * `updated`).
 */
export interface Remembered {
  readonly id: string;
  readonly status: string;
}

export function parseRemembered(text: string): Remembered {
  const { id, status } = read('remember', text, rememberedSchema);

  return { id, status };
}

const pageListSchema = z.array(
  z.looseObject({ slug: z.string().min(1), type: z.string(), title: z.string() }),
);

/** A row of the `list_pages` list, without the page content. */
export interface PageSummary {
  readonly slug: string;
  readonly type: string;
  readonly title: string;
}

export function parsePageList(text: string): PageSummary[] {
  return read('list_pages', text, pageListSchema).map(({ slug, type, title }) => ({
    slug,
    type,
    title,
  }));
}
