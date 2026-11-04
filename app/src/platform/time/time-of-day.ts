/** `HH:MM` is the only form in which a time of day is read from the environment unambiguously. */
export const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Parses a time of day into minutes since midnight. */
export function parseTimeOfDay(value: string): number {
  const match = TIME_OF_DAY.exec(value);
  if (!match) {
    throw new Error(`time of day must be HH:MM, got ${value}`);
  }

  return Number(match[1]) * 60 + Number(match[2]);
}
