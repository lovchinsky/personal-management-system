import { useTestDatabase } from './test-database';

/** The environment of the integration lane: the test database and nothing more. */
useTestDatabase();

process.env.NODE_ENV ??= 'test';

// The lane's expectations about what the App says to the person are the Ukrainian catalog's
// (`inv-105`, `proposal-restart`), so the lane runs in that language rather than the App default.
process.env.APP_LANGUAGE ??= 'uk';

// The worker loops are off everywhere in this lane. Otherwise `init()` would start what the
// application starts: a self-rescheduling tick with a zero initial delay. That tick is a second
// driver of the queue next to `runOnce()`. Both take the same rows, so the lane would begin to
// depend on who got there first. The worker stays the same object and the test ticks it by hand.
process.env.WORKERS_ENABLED ??= 'false';
