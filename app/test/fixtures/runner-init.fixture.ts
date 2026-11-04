import { driftOf, initProblems, notionUnavailableAtInit } from '../../src/claude/runner/init-check';
import { initMessageSchema } from '../../src/claude/runner/stream';
import { WorkflowMode } from '../../src/generated/prisma/enums';
import { initMessage, StreamMessage } from './claude-stream.fixture';
import { invocationFor } from './runner-options.fixture';

/**
 * Returns what the init check says about the init of a `mode` run with `overrides` applied. The
 * expectations are the ones derived from the invocation options of that mode.
 */
export function problemsOf(
  overrides: StreamMessage = {},
  mode: WorkflowMode = 'event_evaluation',
): string[] {
  return initProblems(
    initMessageSchema.parse(initMessage('run-1', mode, overrides)),
    invocationFor(mode).expects,
  );
}

/**
 * Returns what the runner may forbid and retry on an init with `overrides` applied. The
 * expectations are the same as in `problemsOf`.
 */
export function driftFor(
  overrides: StreamMessage = {},
  mode: WorkflowMode = 'event_evaluation',
): string[] {
  return driftOf(
    initMessageSchema.parse(initMessage('run-1', mode, overrides)),
    invocationFor(mode).expects,
  );
}

/**
 * Checks whether init stopped the run only because Notion was unavailable. The expectations are
 * the same as in `problemsOf`.
 */
export function notionUnavailableFor(
  overrides: StreamMessage = {},
  mode: WorkflowMode = 'event_evaluation',
): boolean {
  return notionUnavailableAtInit(
    initMessageSchema.parse(initMessage('run-1', mode, overrides)),
    invocationFor(mode).expects,
  );
}
