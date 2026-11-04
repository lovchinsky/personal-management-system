-- Roles, databases, extensions and the RLS trigger for the App and GBrain.
--
-- The Postgres image runs this file by itself on first startup on an empty volume
-- (`/docker-entrypoint-initdb.d`). Running it again is safe: it creates only what is missing and
-- sets the roles' passwords from the environment. Run it by hand after restoring the database
-- from a backup and after changing the passwords:
--
--   docker compose exec postgres psql -U postgres -v ON_ERROR_STOP=1 -f /docker-entrypoint-initdb.d/init.sql
--
-- The passwords come from the container's environment (`APP_DB_PASSWORD`, `GBRAIN_DB_PASSWORD`),
-- not from the command line, so they do not show in the process list.

\set app_password ''
\set gbrain_password ''
\getenv app_password APP_DB_PASSWORD
\getenv gbrain_password GBRAIN_DB_PASSWORD

-- The passwords appear in the database URLs (`DATABASE_URL`, `GBRAIN_DATABASE_URL`), so they
-- must be hexadecimal: hexadecimal text needs no escaping in a URL.
SELECT :'app_password' ~ '^[0-9A-Fa-f]{64}$'
   AND :'gbrain_password' ~ '^[0-9A-Fa-f]{64}$' AS passwords_valid \gset

\if :passwords_valid
\else
  DO $$ BEGIN
    RAISE EXCEPTION 'APP_DB_PASSWORD and GBRAIN_DB_PASSWORD must each be 64 hexadecimal characters';
  END $$;
\endif

SELECT format(
  'CREATE ROLE app_user LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD %L',
  :'app_password'
)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = 'app_user'
) \gexec

SELECT format('ALTER ROLE app_user PASSWORD %L', :'app_password') \gexec

SELECT format(
  'CREATE ROLE gbrain_user LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS PASSWORD %L',
  :'gbrain_password'
)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = 'gbrain_user'
) \gexec

SELECT format('ALTER ROLE gbrain_user BYPASSRLS PASSWORD %L', :'gbrain_password') \gexec

SELECT 'CREATE DATABASE app_db OWNER app_user'
WHERE NOT EXISTS (
  SELECT 1 FROM pg_database WHERE datname = 'app_db'
) \gexec

SELECT 'CREATE DATABASE gbrain_db OWNER gbrain_user'
WHERE NOT EXISTS (
  SELECT 1 FROM pg_database WHERE datname = 'gbrain_db'
) \gexec

ALTER DATABASE app_db OWNER TO app_user;
ALTER DATABASE gbrain_db OWNER TO gbrain_user;

REVOKE CONNECT ON DATABASE app_db FROM PUBLIC;
REVOKE CONNECT ON DATABASE gbrain_db FROM PUBLIC;
REVOKE CONNECT ON DATABASE postgres FROM PUBLIC;

GRANT CONNECT ON DATABASE app_db TO app_user;
GRANT CONNECT ON DATABASE gbrain_db TO gbrain_user;

\connect gbrain_db

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- RLS on new `public` tables is enabled by the event trigger `auto_rls_on_create_table`. CREATE
-- EVENT TRIGGER is available only to a superuser, so postgres creates both objects. The function
-- is owned by gbrain_user, because GBrain's migrations run ALTER FUNCTION on it; the trigger is
-- owned by postgres, as PostgreSQL requires for a superuser object.
DO $v35pre$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'auto_enable_rls' AND n.nspname = 'public'
  ) THEN
    EXECUTE $fn$
      CREATE FUNCTION auto_enable_rls()
      RETURNS event_trigger AS $body$
      DECLARE
        obj record;
      BEGIN
        FOR obj IN SELECT * FROM pg_event_trigger_ddl_commands()
          WHERE object_type = 'table'
          AND schema_name = 'public'
        LOOP
          EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', obj.object_identity);
        END LOOP;
      END;
      $body$ LANGUAGE plpgsql
    $fn$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_event_trigger WHERE evtname = 'auto_rls_on_create_table'
  ) THEN
    EXECUTE $trg$
      CREATE EVENT TRIGGER auto_rls_on_create_table
        ON ddl_command_end
        WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
        EXECUTE FUNCTION auto_enable_rls()
    $trg$;
  END IF;
END $v35pre$;

ALTER FUNCTION public.auto_enable_rls() OWNER TO gbrain_user;
