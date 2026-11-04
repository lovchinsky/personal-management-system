import { NEEDS_PERSON, needsPersonLine, PERSON_DONE, personDoneLine } from './gate-signals';

describe("the gate's signals to the wrapper", () => {
  it('the markers differ, and neither contains the other', () => {
    expect(NEEDS_PERSON).not.toBe(PERSON_DONE);
    expect(NEEDS_PERSON).not.toContain(PERSON_DONE);
    expect(PERSON_DONE).not.toContain(NEEDS_PERSON);
  });

  it('a request starts with the marker, and the human-readable text stays as it is', () => {
    expect(needsPersonLine('m5 gate: resolve the thread on https://x now')).toBe(
      `${NEEDS_PERSON} m5 gate: resolve the thread on https://x now\n`,
    );
  });

  it('a person-done line starts with the marker, and the human-readable text stays as it is', () => {
    expect(personDoneLine('m5 gate: the thread is resolved')).toBe(
      `${PERSON_DONE} m5 gate: the thread is resolved\n`,
    );
  });

  /** The wrapper parses stderr by lines: a signal must be exactly one line. */
  it.each([needsPersonLine('a'), personDoneLine('a')])('%j is one line', (line) => {
    expect(line.endsWith('\n')).toBe(true);
    expect(line.slice(0, -1)).not.toContain('\n');
  });
});
