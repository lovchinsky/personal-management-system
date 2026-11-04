import { Client } from '@notionhq/client';
import { z } from 'zod';
import { MIN_OWNER_PASSPHRASE_CHARS } from '../mcp/oauth/oauth.config';
import { isKnownTimeZone } from '../platform/time/local-day';
import { scheduleProblem } from '../platform/time/schedule';
import { TIME_OF_DAY } from '../platform/time/time-of-day';
import { GENDERS } from '../texts/gender';
import { LANGUAGES } from '../texts/language';

/** Any string; a required variable that is missing yields “is not set”. */
const text = z.string({ error: 'is not set' });

/**
 * An http(s) URL. The scheme is required, because without it `fetch` throws an error with the full
 * URL.
 */
const httpUrl = z.url({ protocol: /^https?$/, error: 'must be an http(s) URL' });

/**
 * An absolute path, because a relative one would silently land in the container's working
 * directory.
 */
const absolutePath = z.string().startsWith('/', 'must be an absolute path');

/**
 * A switch with exactly two values. The config namespace compares the value with one of them, so a
 * typo would silently leave the switch in its default position.
 */
const flag = z.enum(['true', 'false']);

/** A quiet-hours boundary, in the form the quiet-hours config namespace reads. */
const timeOfDay = z.string().regex(TIME_OF_DAY, 'must be HH:MM');

/**
 * A review schedule, in the grammar the reviews config namespace parses; an empty one means the
 * default.
 */
const schedule = z.string().superRefine((value, context) => {
  const problem = value.trim() === '' ? null : scheduleProblem(value);

  if (problem !== null) context.addIssue({ code: 'custom', message: problem });
});

/**
 * Variables without which an enabled runner does not start. A disabled runner does not read them,
 * and the App must come up without them, so in that case the variables that are set are merely
 * checked.
 */
const RUNNER_NEEDS = [
  'NOTION_MCP_URL',
  'GBRAIN_OAUTH_TOKEN_URL',
  'GBRAIN_OAUTH_SCOPE',
  'GBRAIN_CLIENT_ID',
  'GBRAIN_CLIENT_SECRET',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'RUNNER_PLUGIN_DIR',
  'RUNNER_GBRAIN_MCP_URL',
] as const;

/**
 * The shape of every environment variable the App reads. Defaults come from the config namespace
 * factories; the schema lets the rest of the process environment through as is.
 */
export const environmentSchema = z
  .looseObject({
    NODE_ENV: z.enum(['production', 'development', 'test']).default('development'),

    /** `appConfig` supplies the default. */
    PORT: z.coerce.number().int().min(1).max(65535).optional(),

    DATABASE_URL: text,

    /** The path to the binding of the canonical model to the physical Notion workspace. */
    NOTION_MAPPING_FILE: text,

    /** Deterministic Notion REST credential. Separate from the Notion MCP OAuth state. */
    NOTION_API_TOKEN: text,

    /**
     * The REST API version is tied to the SDK version because the SDK's types describe that
     * version. A mismatch stops startup: when the SDK is upgraded, the declared version becomes
     * false.
     */
    NOTION_API_VERSION: z.literal(Client.defaultNotionVersion),

    /**
     * A personal Notion token, only for the `notion build` command, which creates databases at the
     * top level of the workspace. It comes from the shell for the duration of the call; the App
     * does not receive it.
     */
    NOTION_PERSONAL_TOKEN: text.optional(),

    /**
     * The Notion webhook signing key: the same one-time `verification_token` the provider sends to
     * the endpoint during subscription.
     *
     * Required: without it the App accepts webhooks without knowing who sent them, and the problem
     * would come to light only through its consequences.
     */
    NOTION_WEBHOOK_SECRET: text,

    /**
     * The provisioning window of the webhook subscription.
     *
     * When on, the endpoint accepts the one-time `verification_token` without a signature. When off
     * (the default), the installation state, not the shape of the body, decides the question “is a
     * signature needed”, and no unsigned request passes. It is turned on for the duration of one
     * subscription and turned off again.
     */
    NOTION_WEBHOOK_AWAITING_VERIFICATION: flag.optional(),

    /**
     * Where the `verification_token` lands during provisioning.
     *
     * An absolute path, because this is a mount, not a project file: the typical value is a tmpfs,
     * which a restart wipes. A relative path would silently put the secret into the container's
     * working directory, that is, into a place that survives longer than it should.
     */
    NOTION_VERIFICATION_TOKEN_PATH: absolutePath.optional(),

    /** The encryption key for `connector_credentials` (`SecretBox`): 64 hex characters. */
    APP_ENCRYPTION_KEY: text.regex(/^[0-9a-fA-F]{64}$/, 'must be 64 hex characters'),

    /**
     * The delivery channel. Not required for the App to start: webhook intake, the scheduler and
     * approvals work without it, and delivery queue rows then go to `failed` with the reason
     * “channel telegram is not configured”. An installation needs the channel (RUNBOOK §2.3).
     */
    TELEGRAM_BOT_TOKEN: text.optional(),

    TELEGRAM_ALLOWED_CHAT_ID: text.optional(),

    TELEGRAM_WEBHOOK_SECRET: text.optional(),

    /** The Bot API base: an error with the full URL would also expose the token inside it. */
    TELEGRAM_API_BASE: httpUrl.optional(),

    /**
     * Review schedules in the wall-clock time of `APP_TIMEZONE` (ADR 0036): `daily HH:MM`,
     * `weekly <mon…sun> HH:MM`, `monthly <1–28> HH:MM`, `quarterly <1–28> HH:MM` or `off`.
     * The `reviews` config namespace supplies the defaults.
     */
    REVIEW_DAILY_CONTROL: schedule.optional(),

    REVIEW_WEEKLY_CONTROL: schedule.optional(),

    REVIEW_STRATEGIC: schedule.optional(),

    REVIEW_DEEP: schedule.optional(),

    /** Quiet hours. The start and the end are in the form `HH:MM`; the zone is `APP_TIMEZONE`. */
    QUIET_HOURS_START: timeOfDay.optional(),

    QUIET_HOURS_END: timeOfDay.optional(),

    /** Exactly two values, for the same reason as for `WORKERS_ENABLED`. */
    QUIET_HOURS_ENABLED: flag.optional(),

    /**
     * The installation's zone, in which the day of the daily run limit starts and quiet hours run.
     * Optional: `appConfig` supplies the default. The only check is that the name is a real IANA
     * zone: silently substituting UTC would shift both boundaries.
     */
    APP_TIMEZONE: z
      .string()
      .refine(isKnownTimeZone, 'must be an IANA time zone name, for example Europe/Kyiv')
      .optional(),

    /**
     * The language the App itself writes to the person in: system messages, buttons and channel
     * replies, consent pages (ADR 0042). The model writes in the person's language and does not
     * read this variable.
     *
     * Optional, like the zone: `appConfig` supplies the default. The check is that the language has
     * a catalog; otherwise the person would get half of the texts in an unfamiliar language.
     */
    APP_LANGUAGE: z.enum(LANGUAGES, { error: `must be one of ${LANGUAGES.join(', ')}` }).optional(),

    /**
     * The grammatical gender the App and the model use to address the owner (ADR 0046). Optional:
     * without it sentences are built without gender forms, not by guesswork.
     */
    APP_OWNER_GENDER: z.enum(GENDERS, { error: `must be one of ${GENDERS.join(', ')}` }).optional(),

    /**
     * The assistant name the owner calls the bot and the Notion integration by (ADR 0049). The
     * model gets it from `runtime_read` to understand how it is addressed. Optional: without it
     * the assistant has no name. A Telegram bot name cannot be longer than 64 characters.
     */
    APP_ASSISTANT_NAME: z
      .string()
      .trim()
      .min(1, 'must not be blank')
      .max(64, 'must be at most 64 characters')
      .optional(),

    /**
     * The gender the assistant uses for itself (ADR 0046); without it, sentences have no gender
     * forms.
     */
    APP_ASSISTANT_GENDER: z
      .enum(GENDERS, { error: `must be one of ${GENDERS.join(', ')}` })
      .optional(),

    /**
     * The switch for background workers; the gate turns them off in its own instance because it
     * conducts the runs and ticks itself (ADR 0013, ADR 0041).
     *
     * Exactly two values. A worker reads anything but `false` as “enabled”, so without this check
     * `flase` would silently leave the loops on. In the second App instance they would turn queue
     * rows into real runs.
     */
    WORKERS_ENABLED: flag.optional(),

    /**
     * The public address of the App MCP. It is also the `resource` and the issuer of the
     * authorization server for the chat (`docs/2-system.md` § “Authentication boundary”), and the
     * gate checks it: it is the endpoint the world reaches.
     */
    APP_MCP_URL: httpUrl.optional(),

    /**
     * The owner passphrase on the OAuth consent page. Without it the authorization server does not
     * respond at all: a consent page without a passphrase would have nothing to confirm that the
     * owner is in front of it. Generated, not made up.
     */
    APP_OAUTH_OWNER_PASSPHRASE: z
      .string()
      .min(MIN_OWNER_PASSPHRASE_CHARS, `must be at least ${MIN_OWNER_PASSPHRASE_CHARS} characters`)
      .optional(),

    /**
     * The hosted Notion MCP, and the callback for the one-time authorization of the App-triggered
     * runs' grant. Deliberately separate from `NOTION_API_TOKEN` (`INV-060`): it is a different
     * credential, and the two share no variable.
     *
     * Both the run and the grant keepalive read the server address, so it is required when the
     * runner is enabled and, without the runner, checked when set.
     */
    NOTION_MCP_URL: httpUrl.optional(),

    NOTION_MCP_REDIRECT_URI: httpUrl.optional(),

    /** The installation's Notion MCP client name; without it, “Personal Management System”. */
    NOTION_MCP_CLIENT_NAME: z.string().trim().min(1).max(100).optional(),

    /** The token endpoint of the App-owned GBrain client: over the Compose network, not public. */
    GBRAIN_OAUTH_TOKEN_URL: httpUrl.optional(),

    /**
     * The scopes the App requests from GBrain: only `read` and `write` (`INV-062`). A scope with
     * `admin` stops startup instead of reaching a run, even with the runner off.
     */
    GBRAIN_OAUTH_SCOPE: z
      .string()
      .regex(/^(read|write)( (read|write))*$/, 'may name only read and write')
      .optional(),

    /**
     * The credential of the App-owned GBrain client. Without it an enabled runner would not fail
     * but would silently drive every run without GBrain, so it is required too as soon as the
     * runner is enabled.
     */
    GBRAIN_CLIENT_ID: text.optional(),

    GBRAIN_CLIENT_SECRET: text.optional(),

    /**
     * The switch for the runner of App-triggered runs (ADR 0013): off by default, because runs
     * share the plan quota with the owner's work. Exactly two values, for the same reason as for
     * `WORKERS_ENABLED`.
     */
    RUNNER_ENABLED: flag.optional(),

    CLAUDE_CODE_OAUTH_TOKEN: text.optional(),

    /** The runner plugin directory that the image build assembles (`INV-048`). */
    RUNNER_PLUGIN_DIR: absolutePath.optional(),

    /** GBrain for the run: over the Compose network, not the chat's public address. */
    RUNNER_GBRAIN_MCP_URL: httpUrl.optional(),
  })
  .superRefine(
    (env, ctx) => {
      const missing =
        env.RUNNER_ENABLED === 'true' ? RUNNER_NEEDS.filter((name) => env[name] === undefined) : [];

      for (const name of missing) {
        ctx.addIssue({
          code: 'custom',
          path: [name],
          message: 'is required when RUNNER_ENABLED is true',
        });
      }

      if (env.APP_OAUTH_OWNER_PASSPHRASE !== undefined && env.APP_MCP_URL === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['APP_MCP_URL'],
          message: 'is required when APP_OAUTH_OWNER_PASSPHRASE is set: it is the issuer',
        });
      }

      if (env.APP_OAUTH_OWNER_PASSPHRASE !== undefined && env.APP_MCP_URL !== undefined) {
        const url = new URL(env.APP_MCP_URL);

        // Authorization over http is allowed only for loopback: a token and a password sent out in
        // the clear are a leak, not an authorization server.
        if (url.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
          ctx.addIssue({
            code: 'custom',
            path: ['APP_MCP_URL'],
            message: 'must be https unless it is loopback while OAuth is enabled',
          });
        }
      }
    },
    // All problems in one list: the runner rule reports even when another variable has already
    // failed.
    { when: () => true },
  );

/**
 * Checks the environment at startup and reports all problems in one list, each with the variable
 * name. An empty value is the same as a missing one, because Compose passes an unset variable as
 * an empty string.
 */
export function validate(config: Record<string, unknown>): Record<string, unknown> {
  const declared = Object.fromEntries(Object.entries(config).filter(([, value]) => value !== ''));
  const parsed = environmentSchema.safeParse(declared);

  if (!parsed.success) {
    throw new Error(`environment is invalid:\n${z.prettifyError(parsed.error)}`);
  }

  return parsed.data;
}
