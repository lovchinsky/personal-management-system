-- Roles, databases, extensions and the RLS trigger for the App and GBrain, and GBrain's search
-- configuration.
--
-- The Postgres image runs this file by itself on first startup on an empty volume
-- (`/docker-entrypoint-initdb.d`). Running it again is safe: it creates only what is missing,
-- sets the roles' passwords from the environment and brings the search configuration in line with
-- the installed dictionary. Run it by hand after restoring the database from a backup, after
-- changing the passwords and after changing the search language or its dictionary:
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

-- The language of GBrain's full-text search, `GBRAIN_FTS_LANGUAGE` (ADR 0050): a built-in
-- configuration of Postgres, or the name of a dictionary that `install-dictionaries.sh` installed,
-- for which the configuration is created in `gbrain_db` below. The value is read the way GBrain
-- reads it: trimmed, and `english` when empty. GBrain silently searches in English when the name
-- is not one it accepts, so this file stops on such a name, and on a missing dictionary, before it
-- creates anything.
\set fts_language ''
\getenv fts_language GBRAIN_FTS_LANGUAGE
SELECT coalesce(nullif(btrim(:'fts_language'), ''), 'english') AS fts_language \gset
-- A `DO` block does not see psql variables, so the value reaches it as a session setting.
SET init.fts_language = :'fts_language';

DO $fts_check$
DECLARE
  language text := current_setting('init.fts_language');
  dictionary text := (SELECT setting FROM pg_config WHERE name = 'SHAREDIR')
    || '/tsearch_data/' || language;
  installed boolean;
BEGIN
  IF language !~ '^[a-z][a-z0-9_]*$' THEN
    RAISE EXCEPTION 'GBRAIN_FTS_LANGUAGE "%" is not a configuration name: lowercase letters, digits and underscores, starting with a letter', language;
  END IF;

  -- `pg_stat_file` returns a row with a null field even for an existing file, so the check reads
  -- one field.
  installed := (pg_stat_file(dictionary || '.dict', true)).size IS NOT NULL
    AND (pg_stat_file(dictionary || '.affix', true)).size IS NOT NULL;

  IF EXISTS (
    SELECT 1 FROM pg_ts_config
    WHERE cfgname = language AND cfgnamespace = 'pg_catalog'::regnamespace
  ) THEN
    IF installed THEN
      RAISE EXCEPTION 'GBRAIN_FTS_LANGUAGE "%" is a built-in configuration, and a dictionary with the same name is installed; Postgres would use the built-in one: give the dictionary files another name', language;
    END IF;
  ELSIF NOT installed THEN
    RAISE EXCEPTION 'GBRAIN_FTS_LANGUAGE "%" is neither a built-in configuration nor an installed dictionary: put the hunspell files %.dic and %.aff, in any letter case, into infra/postgres/dictionaries/ and recreate the postgres container', language, language, language;
  END IF;
END
$fts_check$;

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

-- The search configuration of a dictionary language (ADR 0050); a built-in language needs nothing
-- here. Every kind of word, in any script, goes through the chain: the optional stop-word list
-- drops a listed word as written, as the built-in languages do; the hunspell dictionary reduces a
-- word it knows to its base form; a word it does not know is kept as it is (`simple`). Numbers,
-- addresses and the like go to `simple`, as in the configuration this one copies. GBrain names the
-- configuration without a schema and finds it in `public`. Every run brings the chain in line with
-- the installed files, so a stop-word list added or removed takes effect on the next run.
SET init.fts_language = :'fts_language';

DO $fts$
DECLARE
  language text := current_setting('init.fts_language');
  stop_list text := language || '_stopwords';
  has_stop_list boolean := (pg_stat_file(
    (SELECT setting FROM pg_config WHERE name = 'SHAREDIR') || '/tsearch_data/' || language || '.stop',
    true
  )).size IS NOT NULL;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_ts_config
    WHERE cfgname = language AND cfgnamespace = 'pg_catalog'::regnamespace
  ) THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_ts_dict
    WHERE dictname = language AND dictnamespace = 'public'::regnamespace
  ) THEN
    EXECUTE format(
      'CREATE TEXT SEARCH DICTIONARY public.%I (TEMPLATE = pg_catalog.ispell, DictFile = %L, AffFile = %L)',
      language, language, language
    );
  END IF;

  -- `Accept = false` passes every word that is not in the list on to the next dictionary.
  IF has_stop_list AND NOT EXISTS (
    SELECT 1 FROM pg_ts_dict
    WHERE dictname = stop_list AND dictnamespace = 'public'::regnamespace
  ) THEN
    EXECUTE format(
      'CREATE TEXT SEARCH DICTIONARY public.%I (TEMPLATE = pg_catalog.simple, StopWords = %L, Accept = false)',
      stop_list, language
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_ts_config
    WHERE cfgname = language AND cfgnamespace = 'public'::regnamespace
  ) THEN
    EXECUTE format('CREATE TEXT SEARCH CONFIGURATION public.%I (COPY = pg_catalog.simple)', language);
  END IF;

  EXECUTE format(
    'ALTER TEXT SEARCH CONFIGURATION public.%I ALTER MAPPING FOR asciiword, asciihword, hword_asciipart, word, hword, hword_part WITH %s public.%I, pg_catalog.simple',
    language,
    CASE WHEN has_stop_list THEN format('public.%I,', stop_list) ELSE '' END,
    language
  );

  IF NOT has_stop_list AND EXISTS (
    SELECT 1 FROM pg_ts_dict
    WHERE dictname = stop_list AND dictnamespace = 'public'::regnamespace
  ) THEN
    EXECUTE format('DROP TEXT SEARCH DICTIONARY public.%I', stop_list);
  END IF;
END
$fts$;
