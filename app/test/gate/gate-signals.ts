/**
 * The gate's signals to the `infra/bin/gate` wrapper when a scenario waits for a person (ADR 0041).
 *
 * The gate works in a container and talks to the operator only through stderr. The wrapper on the
 * host reads stderr line by line and tells two signals apart by the start of the line: “the person
 * needs to be called” and “the person no longer needs to be called”. The marker is at the start of
 * the line and is followed by human-readable text, which the operator sees in the terminal
 * unchanged. The wrapper does not import the markers (it is bash), so the literals are repeated in
 * `infra/bin/gate`, and `test/contract/gate-signals.spec.ts` enforces that they match.
 */
export const NEEDS_PERSON = 'GATE_NEEDS_PERSON';
export const PERSON_DONE = 'GATE_PERSON_DONE';

/** Builds the stderr line the gate uses to ask the person to take a step it cannot take itself. */
export function needsPersonLine(text: string): string {
  return `${NEEDS_PERSON} ${text}\n`;
}

/**
 * Builds the stderr line the gate uses to say the person no longer needs to be called: the step is
 * done or the waiting time has run out. To the wrapper the two cases are the same, so there is one
 * marker.
 */
export function personDoneLine(text: string): string {
  return `${PERSON_DONE} ${text}\n`;
}
