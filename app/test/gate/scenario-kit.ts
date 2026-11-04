import { createHash } from 'node:crypto';
import type { AnchorType } from '../../src/knowledge/anchor-types';
import type { World, WorldPage } from './m5-scenarios';
import { variantOf, type Phrase } from './m6-phrasing';

/**
 * The scenario vocabulary shared by the gate suites: the attempt tag, the event that wakes a run,
 * the memory pages and the shape of a single-run scenario. The scenarios themselves are defined in
 * the suites (`m6-scenarios.ts`, `m7-scenarios.ts`) and only describe themselves through this
 * vocabulary.
 */

/**
 * The attempt tag: unique names are derived from it. Lowercase, because a GBrain slug is lowercase.
 * It does not name the scenario, because the model sees the page names, and “u1” in a name would
 * tell it which test this is. The verdict says which test it is (the attempt's `tag`).
 */
export type Tag = string;

export const digestOf = (text: string): string =>
  createHash('sha1').update(text).digest('hex').slice(0, 6);

/**
 * Returns the name of another project on the same topic, with its own client: its lesson does not
 * apply to this project. Its tag is not similar to the tag of this project, because a shared
 * suffix would tell the model these are sibling pages, and real projects have no such mark.
 */
export const otherOf = (tag: Tag): string => `Меридіан-${digestOf(`other:${tag}`)}`;

/** Returns the stem every world page name starts with: the attempt tag makes it unique. */
export const brand = (tag: Tag): string => `Орбіта-${tag}`;

/** The event that wakes a run. */
export type Trigger =
  /** The person changed the page's properties: the slots name which ones. */
  | { readonly kind: 'edit'; readonly page: string; readonly slots: readonly string[] }
  /** The person replied in the channel to a system message in the system's thread on the page. */
  | {
      readonly kind: 'reply';
      readonly page: string;
      readonly opening: string;
      /** The person's words: a pool variant is selected using the attempt's variant number. */
      readonly words: (tag: Tag, variant: number) => string;
    };

export type EditTrigger = Extract<Trigger, { readonly kind: 'edit' }>;
export type ReplyTrigger = Extract<Trigger, { readonly kind: 'reply' }>;

/** A timeline event the scenario puts on the page before the run. */
interface PlantedEntry {
  /** The day in the form `YYYY-MM-DD`. */
  readonly date: string;
  readonly summary: string;
  readonly source: string;
}

/** What the scenario's GBrain pages have in common. */
interface MemoryBase {
  /** The page's key in the run's evidence: claims look up its state by this key. */
  readonly key: string;
  readonly title: string;
  readonly paragraphs: readonly string[];
  /**
   * What a topic search must find the page by: otherwise the trap is unreachable and the scenario
   * is empty.
   */
  readonly discoverableBy?: string;
}

/**
 * An object's anchor by convention: the slug derives from the id, and the id is in the frontmatter
 * and in the body. `of` is the key of the world page whose anchor this is; `null` means the anchor
 * of another object that is not in the world.
 */
export interface AnchorMemory extends MemoryBase {
  readonly kind: 'anchor';
  readonly of: string | null;
  readonly type: AnchorType;
  readonly aliases?: readonly string[];
  /**
   * The slug when someone put the page “by hand” under another address (a duplicate); otherwise
   * by convention.
   */
  readonly slug?: string;
  /** The events and facts the anchor already has before the run. */
  readonly timeline?: readonly PlantedEntry[];
  readonly facts?: readonly string[];
}

/**
 * A page that is not an anchor: a note or a lesson that may mention an object and be linked to an
 * anchor.
 */
export interface PlainMemory extends MemoryBase {
  readonly kind: 'page';
  readonly slug: string;
  readonly type: string;
  /** The key of the world page whose id is mentioned in the text: a mention, not an anchor. */
  readonly mentions?: string;
  /**
   * The anchor (key) that the link from this page points to, and the link type (`null` means no
   * type). The direction is the one a conversation sets for the link: a lesson is `derived_from`
   * the anchor it came out of.
   */
  readonly linksTo?: { readonly key: string; readonly type: string | null };
}

/**
 * An anchor that does not exist before the run: the App creates it along with the first entry
 * about the object `of`. The gate puts no page. It watches the object's conventional address
 * before the run and after it, and removes whatever appeared there.
 */
export interface ExpectedAnchor {
  readonly kind: 'expected';
  readonly key: string;
  readonly of: string;
  readonly type: AnchorType;
}

/** A page the scenario puts before the run. */
export type PlantedMemory = AnchorMemory | PlainMemory;

/** A scenario's GBrain page: put before the run or expected at an address. */
export type MemoryPage = PlantedMemory | ExpectedAnchor;

/**
 * Checks whether the scenario puts this page itself: an expected one does not exist before the
 * run and has no text.
 */
export const isPlanted = (page: MemoryPage): page is PlantedMemory => page.kind !== 'expected';

/** A scenario completed by one run over a world: the world, the event and the memory. */
export interface SingleRun {
  readonly world: (tag: Tag) => World;
  readonly trigger: Trigger;
  readonly memory?: (tag: Tag, variant: number) => readonly MemoryPage[];
  /**
   * The page the Notion search must return before the run: the equivalent the model would look
   * for. While the search does not see it yet, the run would be judged by the index, not by the
   * Skill.
   */
  readonly findable?: { readonly key: string; readonly query: (tag: Tag) => string };
}

/**
 * A scenario completed in several steps: model runs, App ticks, the person's actions. The catalog
 * knows its world and what the steps depend on; the steps themselves are conducted by the scenario
 * conductor.
 */
export interface Procedure {
  readonly world: (tag: Tag) => World;
  /**
   * The property slots the steps change on the person's behalf: each must have a carrier in the
   * binding.
   */
  readonly slots: readonly string[];
  readonly memory?: (tag: Tag, variant: number) => readonly MemoryPage[];
  /** The steps conduct the person's reply in the channel. */
  readonly replies: boolean;
}

/** Builds a world Task: the other fields are as in `TaskPage`. */
export const task = (page: Omit<Extract<WorldPage, { type: 'task' }>, 'type'>): WorldPage => ({
  type: 'task',
  ...page,
});

/**
 * Builds a world with a Task awaiting an external reply in a Project with no other path: the check
 * date has come due, the deadline is in two days.
 */
export function waitingWorld(tag: Tag): World {
  return [
    { key: 'project', type: 'project', name: `Запуск сайту «${brand(tag)}»`, status: 'Active' },
    task({
      key: 'waiting',
      name: `Отримати підписаний договір від юристів «${brand(tag)}»`,
      status: 'Waiting For',
      project: 'project',
      dateInDays: -1,
      deadlineInDays: 2,
    }),
  ];
}

/**
 * Builds the anchor of another project on the same topic (with a different client) with its text.
 * A topic search finds it, and it does not apply to the world's project.
 */
export const similarProject = (tag: Tag, paragraphs: readonly string[]): AnchorMemory => ({
  kind: 'anchor',
  key: 'similar',
  of: null,
  type: 'project',
  title: `Запуск сайту «${otherOf(tag)}»`,
  paragraphs,
  discoverableBy: 'договір юристи підписання макети',
});

/** The system opens the thread neutrally: a question that makes no claim about time. */
const OPENING = 'Чи це завдання ще актуальне?';

/**
 * Builds the trigger of the person's reply in the thread on the page: the words are a pool variant
 * chosen by the attempt's variant number, and `subject` returns the name that appears in the words
 * and by which the run finds pages.
 */
export const replyOn = (
  page: string,
  pool: readonly Phrase[],
  subject: (tag: Tag) => string,
): Trigger => ({
  kind: 'reply',
  page,
  opening: OPENING,
  words: (tag, variant) => variantOf(pool, variant)(subject(tag)),
});
