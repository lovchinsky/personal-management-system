import { WorkflowMode } from '../generated/prisma/enums';
import { personSpeaksIn, requestedByPerson, RunProvenance } from './provenance';

/**
 * Who acts, that is, on whose behalf a capability takes a step.
 *
 * Continuations, delivery and approval ask “whose step is this”, not “who called the code”:
 * the answer decides whether a delivery breaks through quiet hours, whether a proposal can become
 * a row and whether something can be decided for the person. There are three kinds of actor.
 *
 * A run launched by the App has a ledger row (`runId`, which is also the run's `sessionId`), an
 * origin and a start time. A person in the chat, a person who pressed a button in a channel and a
 * person who wrote to a channel have none of these: no App run stands behind them, and the person
 * speaks for themselves. The chat bypasses the App. A button reaches the decision directly, not
 * through the model. The App itself writes a channel message to Notion before the model sees
 * anything.
 */
export type Actor =
  | {
      readonly kind: 'run';
      readonly runId: string;
      /**
       * The run's frame. The attention capability remembers it in a thread the system manages, so
       * the person's reply continues in the same frame.
       */
      readonly mode: WorkflowMode;
      readonly provenance: RunProvenance;
      /**
       * When the run started. The limits the capabilities set on a run are measured from it, not
       * from the time of the request, so the same request gets the same answer during the run and
       * when its writes are applied (`contracts/canonical.yaml`, key `scheduled_check`).
       */
      readonly startedAt: Date;
    }
  | { readonly kind: 'chat' }
  | { readonly kind: 'channel_button' };

/** A run launched by the App: with a ledger row, an origin and a start time. */
export type RunActor = Extract<Actor, { readonly kind: 'run' }>;

/** The person in the chat. */
export const CHAT: Actor = { kind: 'chat' };

/** The person who pressed a button in a channel. */
export const CHANNEL_BUTTON: Actor = { kind: 'channel_button' };

/**
 * Checks whether the person asked for this step. The run budget asks the same question, and the
 * same classifier answers it.
 *
 * The chat and a button answer “yes” by construction, for the same reason a reply in a thread and
 * a message in a channel are exempt. The person addresses the system directly, and neither the
 * budget nor quiet hours may stand between the person and their own instruction.
 */
export function onPersonsRequest(actor: Actor): boolean {
  switch (actor.kind) {
    case 'run':
      return requestedByPerson(actor.provenance);

    case 'chat':
    case 'channel_button':
      return true;
  }
}

/**
 * Checks whether the person speaks for themselves in this step. This is narrower than “asked”: a
 * run on the person's schedule or at a time the person named earlier is exempt but does not carry
 * the person's words.
 *
 * It is needed where a step speaks for the person: naming the time of a snooze. An autonomous run
 * does not do this, even when its capability class technically allows it. No run decides on a
 * proposal, not even a run in which the person speaks. The button and the chat decide
 * (`ApprovalsService`).
 */
export function personSpeaks(actor: Actor): boolean {
  switch (actor.kind) {
    case 'run':
      return personSpeaksIn(actor.provenance);

    case 'chat':
    case 'channel_button':
      return true;
  }
}
