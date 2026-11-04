import { z } from 'zod';
import { canonicalNotionId } from '../../notion/client/notion-id';
import { propertyIdFromNotion } from '../../notion/client/property-id';

/**
 * The shape of a delivered Notion event.
 *
 * The field names are **measured**, not relayed from the contract. The payload field is named
 * `data.updated_properties`, while `updated_property_ids` is the name of the envelope field that
 * goes into the prompt. Code that looked for the canonical name in the payload would read
 * `undefined` and discard everything. The renaming happens here, once.
 *
 * The required fields are those confirmed by two sources: live capture of events (`type`,
 * `authors`, `attempt_number`, `subscription_id`, `data.*`) and the provider's documentation
 * (`id`, `timestamp`, `entity`). The rest of the payload is ignored: `workspace_name` and
 * `accessible_by` exist, but change no decision.
 */
const author = z.object({
  id: z.string().optional(),
  type: z.string(),
});

const parent = z.object({
  id: z.string().optional(),
  type: z.string().optional(),
  data_source_id: z.string().optional(),
});

export const notionEventSchema = z.object({
  id: z.string(),
  type: z.string(),
  // The format is checked, not taken on trust: this is the only measured field that goes straight
  // into a `DateTime` column. Otherwise a string that is not a date would produce `Invalid Date`,
  // Prisma would reject the write, and the receipt would stay `failed`. A `failed` receipt is
  // deliberately not counted as settled, so each of the provider's eight deliveries would hit the
  // same error, and the event would be lost.
  timestamp: z.iso.datetime({ offset: true }),
  entity: z.object({ id: z.string(), type: z.string() }),
  authors: z.array(author).default([]),
  /** The PROVIDER's attempt number, from 1 to 8. It does not count our attempts. */
  attempt_number: z.number().int().optional(),
  subscription_id: z.string().optional(),
  integration_id: z.string().optional(),
  workspace_id: z.string().optional(),
  data: z
    .object({
      parent: parent.optional(),
      /**
       * Present only in `page.properties_updated`. It stays in the form it arrived in: the form on
       * the wire is not measured, and the receipt that stores it is its only evidence. What gets
       * compared is not this field but `changedPropertyIds`.
       */
      updated_properties: z.array(z.string()).optional(),
      /**
       * Present in `comment.created`: the attention thread's identifier arrives directly in the
       * event.
       */
      discussion_id: z.string().optional(),
      page_id: z.string().optional(),
    })
    .default({})
    .transform((data) => ({
      ...data,
      /**
       * The changed properties in canonical form, translated on the way in, once
       * (`propertyIdFromNotion`). The translation does not fail on any form.
       */
      changedPropertyIds: (data.updated_properties ?? []).map((wire) => propertyIdFromNotion(wire)),
      /** The thread in canonical form, the same form in which the system's registry stores it. */
      discussionId:
        data.discussion_id === undefined ? undefined : canonicalNotionId(data.discussion_id),
    })),
});

export type NotionEvent = z.infer<typeof notionEventSchema>;

/**
 * Notion's first call to the endpoint: a one-time token and **nothing more**.
 *
 * `.strict()` is load-bearing here. An ordinary zod object strips unknown keys, so a body that
 * contains both the token and a full event would pass as the handshake, and the event would
 * bypass the signature check. The length limit and the character set enforce something else: the
 * value goes into a file that the operator copies into a secret, and nothing but the token may get
 * there (`docs/2-system.md` § “Subscription verification token”).
 */
export const verificationSchema = z
  .object({
    verification_token: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9_-]+$/, 'verification_token carries unexpected characters'),
  })
  .strict();

/**
 * Returns the page an event concerns.
 *
 * `entity.id` is the page for page events, but for `comment.created` it is the comment, and the
 * page comes in a separate field. The question “which page does this concern” has to be asked
 * this way, not by reading `entity.id` blindly.
 */
export function pageOf(event: NotionEvent): string | undefined {
  if (event.entity.type === 'page') return event.entity.id;
  return event.data.page_id;
}
