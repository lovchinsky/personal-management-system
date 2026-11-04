import type { ProposalFate } from '../approvals/proposal-notice';
import type { ActionKind } from '../delivery/port/channel.port';
import type { ReasonRequestedByPerson } from '../runs/provenance';
import type { ReviewMode } from '../runs/trigger-envelope';
import { en } from './en';
import type { Gender } from './gender';
import type { Language } from './language';
import { uk } from './uk';

/**
 * The texts the App itself speaks to the person with, without the model (ADR 0042): system
 * messages, proposal fates, channel buttons and replies, consent pages. The model writes in the
 * person's language following the rules of the Skill; the App writes in the installation's
 * language (`APP_LANGUAGE`).
 *
 * The catalog holds whole sentences: gender, case and word order are the grammar of the language,
 * not of the code. The voice is the informal second person, “ти” (ADR 0046); sentences that address
 * the owner in the past tense take the owner's gender as a parameter. The keys, the links and the
 * truncation of reasons stay in the code; the language's format puts the dates into words for the
 * person (`spoken-dates.ts`). The compiler checks the completeness of each catalog, and `INV-106`
 * checks the channel limits.
 */
export interface Texts {
  readonly language: Language;
  readonly notices: {
    /** Autonomous runs stopped after consecutive failures (`BreakerOpening`). */
    readonly breaker: {
      noticed(failures: number): string;
      readonly whyItMatters: string;
      /** The label of the technical reason: the reason itself is evidence, shown as it is. */
      reason(text: string): string;
      readonly ask: string;
    };
    /** A client has connected to the App MCP. */
    readonly connection: {
      noticed(client: string, host: string): string;
      readonly whyItMatters: string;
      readonly ask: string;
    };
    /**
     * A review occurrence did not take place (`INV-105`); `period` is already in words. `Intl`
     * writes the month with its year in the installation's language; the catalog writes the
     * quarter, because `Intl` does not know quarters.
     */
    readonly reviewFailure: {
      noticed(mode: ReviewMode, period: string): string;
      whyItMatters(mode: ReviewMode): string;
      reason(text: string): string;
      ask(mode: ReviewMode): string;
      quarter(quarter: number, year: number): string;
    };
    /**
     * The person replied in the channel while Notion is unavailable (ADR 0045): the evaluation
     * window of the reply waits for Notion or, after waiting a day, stops waiting.
     */
    readonly notionWait: {
      readonly waiting: {
        readonly noticed: string;
        readonly whyItMatters: string;
        readonly ask: string;
      };
      readonly gaveUp: {
        readonly noticed: string;
        readonly whyItMatters: string;
        readonly ask: string;
      };
    };
    /**
     * A wake whose time the person named did not take place (`INV-108`); `moment` is the local
     * time already in words. The message includes the page as a link, so the texts do not name it.
     */
    readonly wakeFailure: {
      noticed(reason: ReasonRequestedByPerson, moment: string, gender: Gender): string;
      whyItMatters(reason: ReasonRequestedByPerson, gender: Gender): string;
      readonly ask: string;
    };
  };
  /** A proposal's fate next to its line in the message. */
  readonly outcomes: Readonly<Record<ProposalFate, string>>;
  /**
   * The system's writes in a Notion thread (ADR 0043): the label under which Notion shows the
   * comment, and the proposal trail (the person's decision and the non-execution of what was
   * approved).
   */
  readonly comments: {
    /** The kind label of a comment: what kind of write this is. Never a person's name. */
    readonly labels: {
      channelReply(channel: string): string;
      readonly proposalDecision: string;
      readonly proposalResult: string;
    };
    /**
     * The field of a change, named with a plain word of the language (ADR 0046): “status”, not the
     * name of the workspace property. A field that is not listed here keeps its workspace name.
     */
    readonly fields: Readonly<Record<SpokenField, string>>;
    readonly proposal: {
      /**
       * `change` is already in words: the field and the value as the trail will say them to the
       * person; `gender` is the gender in which the owner is addressed.
       */
      approved(change: string, gender: Gender): string;
      rejected(change: string, gender: Gender): string;
      notWritten(change: string, reason: string): string;
      readonly reasons: Readonly<Record<NotWrittenReason, string>>;
      /** A value that has no name to say it by: a cleared field, relations. */
      readonly cleared: string;
      links(count: number): string;
    };
  };
  readonly telegram: {
    readonly openInNotion: string;
    /** The line about the remaining proposals that await a decision outside the packet. */
    moreWaiting(count: number): string;
    /**
     * The caption of the button of a packet's only proposal; the buttons of several proposals have
     * a number and a sign.
     */
    readonly buttons: Readonly<Record<ActionKind, string>>;
    /** The reply to a press: what the person sees when the button stops spinning. */
    readonly answers: {
      readonly approved: string;
      readonly rejected: string;
      readonly notAwaiting: string;
      readonly expired: string;
      readonly dismissed: string;
      readonly needsTime: string;
      readonly replied: string;
      readonly unconsumed: string;
      /** The person's reply is not recorded: Notion is unavailable, so the text is kept nowhere. */
      readonly notRecorded: string;
      readonly unreadable: string;
    };
    /** The reply to a text that has nowhere to land. */
    readonly nowhere: string;
  };
  /** The consent pages and the errors of an authorization request. */
  readonly consent: {
    readonly title: string;
    readonly heading: string;
    readonly client: string;
    readonly returnsTo: string;
    readonly resource: string;
    readonly explanation: string;
    readonly passphrase: string;
    readonly allow: string;
    readonly deny: string;
    readonly refused: string;
    locked(seconds: number): string;
    readonly errorTitle: string;
    readonly errorHeading: string;
  };
}

/** Why an approved change was not written, as the proposal trail will tell the person. */
export type NotWrittenReason = 'conflict' | 'noAccess' | 'unavailable' | 'other';

/**
 * The canonical fields that the proposal trail names with a word of the language, not with the
 * workspace name.
 */
const SPOKEN_FIELDS = ['status', 'date', 'deadline'] as const;

type SpokenField = (typeof SPOKEN_FIELDS)[number];

export function isSpokenField(field: string): field is SpokenField {
  return (SPOKEN_FIELDS as readonly string[]).includes(field);
}

export type NoticeTexts = Texts['notices'];
export type CommentTexts = Texts['comments'];
export type TelegramTexts = Texts['telegram'];
export type AnswerTexts = TelegramTexts['answers'];
export type ConsentTexts = Texts['consent'];

/**
 * The catalog of each language; the type guarantees that a catalog of language `L` declares `L`.
 */
const CATALOGS: { readonly [L in Language]: Texts & { readonly language: L } } = { uk, en };

export function textsOf(language: Language): Texts {
  return CATALOGS[language];
}
