/**
 * The database of the test lanes is the ephemeral container `infra/ops/test-db.sh`, not `app_db`:
 * the lanes clean tables and write rows, so they must not have access to the production state.
 * The password is not a secret here because the container lives on loopback and holds no data.
 */
export const TEST_DATABASE_URL = 'postgresql://app:app@127.0.0.1:55432/app_test';

/** The name of the database the lane may clean. It is also read before every `TRUNCATE`. */
export const TEST_DATABASE_NAME = 'app_test';

/**
 * Points the lane at the test database, or refuses to run.
 *
 * The address is an assertion, not a default: `??=` would leave a `DATABASE_URL` already present
 * in the environment (in the App container, for example), and the lane would apply migrations
 * and clean the **live** database. The code rules this out, not just the network.
 */
export function useTestDatabase(): void {
  const declared = process.env.DATABASE_URL;
  if (declared !== undefined && declared !== TEST_DATABASE_URL) {
    throw new Error(
      `The test lanes write and truncate tables, so they refuse any database but their own.\n` +
        `  expected: ${TEST_DATABASE_URL}\n` +
        `  declared: ${declared}\n` +
        `Start the ephemeral database with infra/ops/test-db.sh up and unset DATABASE_URL.`,
    );
  }

  process.env.DATABASE_URL = TEST_DATABASE_URL;
}
