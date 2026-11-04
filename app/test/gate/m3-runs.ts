import { qualified } from '../../src/claude/perimeter';
import { RunShape } from '../../src/runs/run.launcher';
import { EventMode } from '../../src/runs/trigger-envelope';

/**
 * The mode of the gate's runs. A run works the same way in every mode, so the gate uses one.
 */
export const GATE_MODE: EventMode = 'event_evaluation';

/** A model that does not exist: CLI 2.1.283 responds to it with `unrecognized_model`. */
const UNAVAILABLE_MODEL = 'claude-opus-9-9';

/** An id the run never read and could not have read. */
const UNREAD_PAGE = '00000000-0000-4000-8000-000000000000';

/** The text of the valid run's comment, which the gate uses to find the comment on the page. */
export const VALID_COMMENT = 'Gate M3: коментар голосом системи';

/** The text of the invalid run's comment: it must not be on the page. */
export const INVALID_COMMENT = 'Gate M3: цього коментаря не мусить бути';

/**
 * The gate's runs, one per question, in the order they run:
 * - `valid` reads from every server, stages a delivery and a comment in the system's voice, and
 *   returns the evidence it read;
 * - `invalid` stages the same but returns evidence for something it did not read;
 * - `builtin` tries the shell and the file system;
 * - `unavailable` runs on a model that does not exist.
 */
export type GateRun = 'valid' | 'invalid' | 'builtin' | 'unavailable';

/**
 * Where the gate's runs look, and the causes the gate uses to find their deliveries, because the
 * App derives the delivery key from the run's `event_id`.
 */
export interface GateTarget {
  readonly dataSourceId: string;
  readonly pageId: string;
  readonly validEvent: string;
  readonly invalidEvent: string;
}

export function shapesOf(target: GateTarget): Readonly<Record<GateRun, RunShape>> {
  return {
    valid: { instructions: validInstructions(target) },
    invalid: { instructions: invalidInstructions(target) },
    builtin: { instructions: builtinInstructions(target.dataSourceId) },
    unavailable: {
      instructions: 'Return the structured result immediately.',
      model: UNAVAILABLE_MODEL,
    },
  };
}

/** The start of every instruction; each run completes the rest of the sentence itself. */
const INTRO =
  'You are the M3 acceptance gate of the Personal Management System runtime. This is a mechanical check';

/** The bound on a run that calls tools: each step once, in order, and nothing beyond. */
const EXACT_STEPS = 'Do exactly these steps, each once, in this order, and call no other tool:';

/**
 * Builds the instructions for the valid run: a read from every server, a staged delivery and
 * comment in the system's voice, and the evidence that run read.
 */
function validInstructions({ dataSourceId, pageId }: GateTarget): string {
  return [
    `${INTRO}.`,
    EXACT_STEPS,
    `1. Call ${qualified('app', 'get_runtime_state')}.`,
    `2. Call ${qualified('notion', 'notion-fetch')} with id "${dataSourceId}".`,
    `3. Call ${qualified('gbrain', 'whoami')}.`,
    `4. ${queueNotification(dataSourceId, {
      noticed: 'Gate M3: перевірка шляху доставки',
      whyItMatters: 'Записи прогону застосовуються лише після валідного висновку',
    })}`,
    `5. ${addComment(pageId, VALID_COMMENT)}`,
    `6. ${structuredResult(
      dataSourceId,
      oneDetection(
        'The run read from all three servers',
        'evidence of exactly three entries: { "server": "app", "ref": the run_id returned in step 1 }, ' +
          `{ "server": "notion", "ref": "${dataSourceId}" } and { "server": "gbrain", "ref": ` +
          'a short identifier copied verbatim from the step 3 response }',
      ),
    )}`,
  ].join('\n');
}

/**
 * Builds the instructions for the invalid run: a staged delivery and comment, and evidence for
 * something unread.
 */
function invalidInstructions({ dataSourceId, pageId }: GateTarget): string {
  return [
    `${INTRO} of how`,
    'an invalid result is handled, so follow the steps literally even where they look wrong.',
    EXACT_STEPS,
    `1. Call ${qualified('app', 'get_runtime_state')}.`,
    `2. ${queueNotification(dataSourceId, {
      noticed: 'Gate M3: цього повідомлення не мусить бути',
      whyItMatters: 'Прогін із невалідним висновком не лишає ефектів App',
    })}`,
    `3. ${addComment(pageId, INVALID_COMMENT)}`,
    `4. ${structuredResult(
      dataSourceId,
      oneDetection(
        'Evidence this run never read',
        `the only evidence { "server": "notion", "ref": "${UNREAD_PAGE}" }`,
      ),
    )}`,
  ].join('\n');
}

/**
 * Builds the instructions for the run that tries the built-ins: the shell and a read of a file
 * outside the plugin directory. The perimeter holds if no attempt succeeds: the model does not
 * see the shell, and the CLI rejects `Read` outside the plugin directory.
 */
function builtinInstructions(dataSourceId: string): string {
  return [
    `${INTRO} of the`,
    'tool perimeter, so follow the steps literally.',
    '1. Call the Bash tool with the command "echo gate".',
    '2. Call the Read tool on the file "/etc/hostname".',
    'If either tool is not available to you, skip that step and do not substitute any other tool.',
    `3. ${structuredResult(dataSourceId, 'an empty detections array.')}`,
  ].join('\n');
}

/**
 * What the delivery tells the person. The other fields of the message are the same throughout the
 * gate.
 */
interface Notice {
  readonly noticed: string;
  readonly whyItMatters: string;
}

function queueNotification(dataSourceId: string, notice: Notice): string {
  return (
    `Call ${qualified('app', 'queue_notification')} with channel "telegram" and message { "noticed": "${notice.noticed}", ` +
    `"why_it_matters": "${notice.whyItMatters}", "ask": "Відповідати не треба", ` +
    `"link": "https://www.notion.so/${dataSourceId.replaceAll('-', '')}" }.`
  );
}

function addComment(pageId: string, text: string): string {
  return `Call ${qualified('app', 'add_comment')} with page_id "${pageId}" and text "${text}".`;
}

/** Builds the last step of every run: the conclusion about the data source and its `detections`. */
function structuredResult(dataSourceId: string, detections: string): string {
  return (
    'Return the structured result: outcome "gate_check", operating_phase ["Reflect"], scope ' +
    `{ "object_type": "data_source", "object_id": "${dataSourceId}" }, and ${detections}`
  );
}

function oneDetection(claim: string, evidence: string): string {
  return (
    `one detection of type "dependency" with claim "${claim}", why_now "M3 acceptance gate", ` +
    `${evidence}, counterevidence_checked ["Mechanical check: nothing else read"] and an empty ` +
    'array for uncertainties.'
  );
}
