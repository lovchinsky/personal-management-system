import { subSeconds } from 'date-fns';
import { ClaimedRun } from '../../src/runs/run-source';

/** Returns a time that has already come, so a row with that time is due. */
export function due(): Date {
  return subSeconds(new Date(), 1);
}

/** Claims a row the way the scheduler takes it: by id, before the run. */
export async function claimed(
  source: { claim(id: string): Promise<ClaimedRun | null> },
  id: string,
): Promise<ClaimedRun> {
  const run = await source.claim(id);
  if (!run) {
    throw new Error(`row ${id} could not be claimed`);
  }

  return run;
}
