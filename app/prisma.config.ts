import 'dotenv/config';

import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL,
    // `migrate diff --from-migrations` is the command that writes every new migration
    // (`app/README.md` § “Migrations”). It needs a temporary database in which to replay the
    // existing migrations and get “the state after them”. The main database is not suitable,
    // because Prisma resets it. The value deliberately has no fallback: silently substituting the
    // main database would erase its contents, while an empty variable produces a clear refusal.
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
