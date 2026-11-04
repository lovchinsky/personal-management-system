import { execFileSync } from 'node:child_process';
import { TEST_DATABASE_URL, useTestDatabase } from './test-database';

/**
 * Migrations are applied once per lane run — to the test database and only to it. The e2e lane
 * needs them as much as the integration lane does: `AppModule` checks the schema against the
 * image and does not start without the migrations applied.
 *
 * `migrate deploy`, not `migrate dev`: the partial unique indexes are added to the migrations by
 * hand, and `dev` would remove them as drift, so the tests would check a schema that exists in no
 * environment.
 */
export default function globalSetup(): void {
  useTestDatabase();

  execFileSync('npx', ['--no-install', 'prisma', 'migrate', 'deploy'], {
    cwd: `${__dirname}/..`,
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'inherit',
  });
}
