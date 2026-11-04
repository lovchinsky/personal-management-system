-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "WebhookReceiptStatus" AS ENUM ('received', 'processed', 'rejected', 'failed');

-- CreateEnum
CREATE TYPE "ScheduledCheckStatus" AS ENUM ('pending', 'running', 'done', 'failed');

-- CreateEnum
CREATE TYPE "EvaluationWindowStatus" AS ENUM ('pending', 'running', 'done', 'failed');

-- CreateEnum
CREATE TYPE "ReviewOccurrenceStatus" AS ENUM ('pending', 'running', 'done', 'failed');

-- CreateEnum
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('pending', 'sent', 'failed');

-- CreateEnum
CREATE TYPE "PendingActionStatus" AS ENUM ('proposed', 'approved', 'executed', 'rejected', 'expired', 'conflict', 'failed');

-- CreateEnum
CREATE TYPE "PendingActionFailure" AS ENUM ('no_access', 'unavailable', 'other');

-- CreateEnum
CREATE TYPE "ReasonCode" AS ENUM ('await_external_event', 'user_snooze', 'safety_recheck', 'deadline_followup', 'resolution_reconciliation');

-- CreateEnum
CREATE TYPE "WorkflowMode" AS ENUM ('dialogue', 'event_evaluation', 'scheduled_recheck', 'closure_processing', 'daily_control', 'weekly_control_review', 'strategic_review', 'deep_review');

-- CreateEnum
CREATE TYPE "McpServerName" AS ENUM ('app', 'notion', 'gbrain');

-- CreateEnum
CREATE TYPE "EventSource" AS ENUM ('notion', 'telegram');

-- CreateEnum
CREATE TYPE "RunOrigin" AS ENUM ('evaluation_window', 'scheduled_check', 'review_schedule', 'managed_discussion_reply', 'channel_inbound', 'inbox_capture', 'operator');

-- CreateEnum
CREATE TYPE "RunBudgetClass" AS ENUM ('budgeted', 'exempt');

-- CreateEnum
CREATE TYPE "ExecutionSurface" AS ENUM ('claude_chat', 'app_triggered');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('running', 'completed', 'failed', 'abandoned', 'deferred');

-- CreateEnum
CREATE TYPE "Connector" AS ENUM ('notion_mcp', 'gbrain');

-- CreateEnum
CREATE TYPE "PolicyDecisionSource" AS ENUM ('perimeter', 'app');

-- CreateEnum
CREATE TYPE "AppliedEffectKind" AS ENUM ('page_created', 'comment', 'page_archived', 'continuation', 'proposal', 'delivery', 'memory_anchor', 'memory_entry');

-- CreateEnum
CREATE TYPE "SweepRule" AS ENUM ('check_date_reached', 'deadline_signal', 'project_path', 'paused_commitment', 'project_closure', 'dependency_contradiction');

-- CreateTable
CREATE TABLE "webhook_receipts" (
    "id" TEXT NOT NULL,
    "source" "EventSource" NOT NULL,
    "external_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "page_id" TEXT,
    "attempt_number" INTEGER,
    "diagnostics" JSONB NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "status" "WebhookReceiptStatus" NOT NULL DEFAULT 'received',
    "last_error" TEXT,

    CONSTRAINT "webhook_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_checks" (
    "id" TEXT NOT NULL,
    "discussion_id" TEXT,
    "notion_page_id" TEXT NOT NULL,
    "run_at" TIMESTAMP(3) NOT NULL,
    "reason_code" "ReasonCode" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "status" "ScheduledCheckStatus" NOT NULL DEFAULT 'pending',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "last_attempt_at" TIMESTAMP(3),
    "last_error" TEXT,
    "failure_noticed_at" TIMESTAMP(3),
    "notion_hold_until" TIMESTAMP(3),
    "notion_held_since" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluation_windows" (
    "id" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,
    "discussion_id" TEXT,
    "person_replied" BOOLEAN NOT NULL DEFAULT false,
    "inbox_item_created" BOOLEAN NOT NULL DEFAULT false,
    "channel_inbound" BOOLEAN NOT NULL DEFAULT false,
    "updated_properties" TEXT[],
    "event_types" TEXT[],
    "latest_event_id" TEXT NOT NULL,
    "latest_event_type" TEXT NOT NULL,
    "latest_event_at" TIMESTAMP(3) NOT NULL,
    "not_before" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "status" "EvaluationWindowStatus" NOT NULL DEFAULT 'pending',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "last_attempt_at" TIMESTAMP(3),
    "last_error" TEXT,
    "notion_hold_until" TIMESTAMP(3),
    "notion_held_since" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "evaluation_windows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_outbox" (
    "id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "discussion_id" TEXT,
    "channel" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "external_id" TEXT,
    "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'pending',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3),
    "locked_until" TIMESTAMP(3),
    "quiet_hours_exempt" BOOLEAN NOT NULL DEFAULT false,
    "sent_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_proposals" (
    "outbox_id" TEXT NOT NULL,
    "pending_action_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "fate" "PendingActionStatus",

    CONSTRAINT "notification_proposals_pkey" PRIMARY KEY ("outbox_id","pending_action_id")
);

-- CreateTable
CREATE TABLE "pending_actions" (
    "id" TEXT NOT NULL,
    "discussion_id" TEXT,
    "proposed_by_run_id" TEXT,
    "fingerprint" TEXT NOT NULL,
    "effects" JSONB NOT NULL,
    "preconditions" JSONB NOT NULL,
    "status" "PendingActionStatus" NOT NULL DEFAULT 'proposed',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "last_error" TEXT,
    "next_attempt_at" TIMESTAMP(3),
    "notion_page_id" TEXT NOT NULL,
    "published_status" "PendingActionStatus",
    "approved_at" TIMESTAMP(3),
    "access_failures" INTEGER NOT NULL DEFAULT 0,
    "failure" "PendingActionFailure",
    "recheck_requested_at" TIMESTAMP(3),

    CONSTRAINT "pending_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_discussions" (
    "discussion_id" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,
    "mode" "WorkflowMode" NOT NULL,
    "first_written_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_written_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "block_id" TEXT,
    "last_comment_id" TEXT,

    CONSTRAINT "system_discussions_pkey" PRIMARY KEY ("discussion_id")
);

-- CreateTable
CREATE TABLE "review_occurrences" (
    "id" TEXT NOT NULL,
    "mode" "WorkflowMode" NOT NULL,
    "occurrence_key" TEXT NOT NULL,
    "due_at" TIMESTAMP(3) NOT NULL,
    "closes_at" TIMESTAMP(3) NOT NULL,
    "since_at" TIMESTAMP(3) NOT NULL,
    "status" "ReviewOccurrenceStatus" NOT NULL DEFAULT 'pending',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "last_attempt_at" TIMESTAMP(3),
    "last_error" TEXT,
    "failure_noticed_at" TIMESTAMP(3),
    "notion_hold_until" TIMESTAMP(3),
    "notion_held_since" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_occurrences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sweep_marks" (
    "page_id" TEXT NOT NULL,
    "rule" "SweepRule" NOT NULL,
    "basis_hash" TEXT NOT NULL,
    "woke_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sweep_marks_pkey" PRIMARY KEY ("page_id","rule","basis_hash")
);

-- CreateTable
CREATE TABLE "discussion_reconciliations" (
    "discussion_id" TEXT NOT NULL,
    "seen_open_at" TIMESTAMP(3),
    "closure_requested_at" TIMESTAMP(3),
    "gone_at" TIMESTAMP(3),
    "checked_at" TIMESTAMP(3),

    CONSTRAINT "discussion_reconciliations_pkey" PRIMARY KEY ("discussion_id")
);

-- CreateTable
CREATE TABLE "connector_credentials" (
    "connector" "Connector" NOT NULL,
    "client_id" TEXT,
    "access_token" TEXT NOT NULL,
    "access_token_expires_at" TIMESTAMP(3) NOT NULL,
    "refresh_token" TEXT,
    "scope" TEXT,
    "obtained_at" TIMESTAMP(3) NOT NULL,
    "refreshed_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connector_credentials_pkey" PRIMARY KEY ("connector")
);

-- CreateTable
CREATE TABLE "oauth_clients" (
    "id" TEXT NOT NULL,
    "client_name" TEXT NOT NULL,
    "redirect_uris" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_codes" (
    "code_hash" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "redirect_uri" TEXT NOT NULL,
    "code_challenge" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "redeemed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_codes_pkey" PRIMARY KEY ("code_hash")
);

-- CreateTable
CREATE TABLE "oauth_tokens" (
    "id" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "access_hash" TEXT NOT NULL,
    "access_expires_at" TIMESTAMP(3) NOT NULL,
    "refresh_hash" TEXT NOT NULL,
    "refresh_expires_at" TIMESTAMP(3) NOT NULL,
    "rotated_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "run_traces" (
    "id" TEXT NOT NULL,
    "mode" "WorkflowMode" NOT NULL,
    "execution_surface" "ExecutionSurface" NOT NULL,
    "trigger" JSONB NOT NULL,
    "page_id" TEXT,
    "origin_kind" "RunOrigin" NOT NULL,
    "origin_id" TEXT,
    "status" "RunStatus" NOT NULL DEFAULT 'running',
    "slot" INTEGER NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "budget_class" "RunBudgetClass" NOT NULL,
    "latency_ms" INTEGER,
    "reason" TEXT,
    "deferred_until" TIMESTAMP(3),
    "notion_unavailable" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "run_traces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "run_snapshots" (
    "run_id" TEXT NOT NULL,
    "init" JSONB,
    "model" TEXT,
    "num_turns" INTEGER,
    "duration_ms" INTEGER,
    "terminal_reason" TEXT,
    "result" JSONB,

    CONSTRAINT "run_snapshots_pkey" PRIMARY KEY ("run_id")
);

-- CreateTable
CREATE TABLE "run_tool_calls" (
    "run_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "server" "McpServerName",
    "tool" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,

    CONSTRAINT "run_tool_calls_pkey" PRIMARY KEY ("run_id","position")
);

-- CreateTable
CREATE TABLE "run_policy_decisions" (
    "run_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "source" "PolicyDecisionSource" NOT NULL,
    "tool" TEXT NOT NULL,
    "reason" TEXT,

    CONSTRAINT "run_policy_decisions_pkey" PRIMARY KEY ("run_id","position")
);

-- CreateTable
CREATE TABLE "run_model_usage" (
    "run_id" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "canonical_model" TEXT,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "cache_read_input_tokens" INTEGER NOT NULL,
    "cache_creation_input_tokens" INTEGER NOT NULL,

    CONSTRAINT "run_model_usage_pkey" PRIMARY KEY ("run_id","model")
);

-- CreateTable
CREATE TABLE "run_applied_effects" (
    "run_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "AppliedEffectKind" NOT NULL,
    "record_id" TEXT NOT NULL,

    CONSTRAINT "run_applied_effects_pkey" PRIMARY KEY ("run_id","position")
);

-- CreateIndex
CREATE INDEX "webhook_receipts_received_at_idx" ON "webhook_receipts"("received_at");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_receipts_source_external_id_key" ON "webhook_receipts"("source", "external_id");

-- CreateIndex
CREATE INDEX "scheduled_checks_run_at_idx" ON "scheduled_checks"("run_at");

-- CreateIndex
CREATE INDEX "evaluation_windows_not_before_idx" ON "evaluation_windows"("not_before");

-- CreateIndex
CREATE UNIQUE INDEX "notification_outbox_idempotency_key_key" ON "notification_outbox"("idempotency_key");

-- CreateIndex
CREATE INDEX "notification_outbox_next_attempt_at_idx" ON "notification_outbox"("next_attempt_at");

-- CreateIndex
CREATE INDEX "notification_outbox_channel_external_id_idx" ON "notification_outbox"("channel", "external_id");

-- CreateIndex
CREATE INDEX "notification_proposals_pending_action_id_idx" ON "notification_proposals"("pending_action_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_proposals_outbox_id_position_key" ON "notification_proposals"("outbox_id", "position");

-- CreateIndex
CREATE INDEX "pending_actions_status_idx" ON "pending_actions"("status");

-- CreateIndex
CREATE INDEX "pending_actions_notion_page_id_idx" ON "pending_actions"("notion_page_id");

-- CreateIndex
CREATE INDEX "system_discussions_last_written_at_idx" ON "system_discussions"("last_written_at");

-- CreateIndex
CREATE INDEX "review_occurrences_due_at_idx" ON "review_occurrences"("due_at");

-- CreateIndex
CREATE UNIQUE INDEX "review_occurrences_mode_occurrence_key_key" ON "review_occurrences"("mode", "occurrence_key");

-- CreateIndex
CREATE INDEX "sweep_marks_woke_at_idx" ON "sweep_marks"("woke_at");

-- CreateIndex
CREATE INDEX "oauth_clients_created_at_idx" ON "oauth_clients"("created_at");

-- CreateIndex
CREATE INDEX "oauth_codes_expires_at_idx" ON "oauth_codes"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_tokens_access_hash_key" ON "oauth_tokens"("access_hash");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_tokens_refresh_hash_key" ON "oauth_tokens"("refresh_hash");

-- CreateIndex
CREATE INDEX "oauth_tokens_family_id_idx" ON "oauth_tokens"("family_id");

-- CreateIndex
CREATE INDEX "oauth_tokens_refresh_expires_at_idx" ON "oauth_tokens"("refresh_expires_at");

-- CreateIndex
CREATE INDEX "run_traces_created_at_idx" ON "run_traces"("created_at");

-- CreateIndex
CREATE INDEX "run_traces_status_idx" ON "run_traces"("status");

-- CreateIndex
CREATE INDEX "run_traces_page_id_created_at_idx" ON "run_traces"("page_id", "created_at");

-- AddForeignKey
ALTER TABLE "notification_proposals" ADD CONSTRAINT "notification_proposals_outbox_id_fkey" FOREIGN KEY ("outbox_id") REFERENCES "notification_outbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_proposals" ADD CONSTRAINT "notification_proposals_pending_action_id_fkey" FOREIGN KEY ("pending_action_id") REFERENCES "pending_actions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_codes" ADD CONSTRAINT "oauth_codes_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_snapshots" ADD CONSTRAINT "run_snapshots_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "run_traces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_tool_calls" ADD CONSTRAINT "run_tool_calls_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "run_snapshots"("run_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_policy_decisions" ADD CONSTRAINT "run_policy_decisions_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "run_snapshots"("run_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_model_usage" ADD CONSTRAINT "run_model_usage_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "run_snapshots"("run_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_applied_effects" ADD CONSTRAINT "run_applied_effects_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "run_traces"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ===========================================================================
-- Далі — рукописне: те, чого Prisma не описує.
--
-- Частковий індекс, `CHECK`, функція й тригер у `schema.prisma` не
-- виражаються, а `prisma migrate dev` прийняв би їх за дрейф і прибрав. Тому
-- схема змінюється через `prisma migrate diff` і правку файлу міграції, а
-- міграції застосовує `migrate deploy` у команді запуску образу App.
--
-- Що жоден об'єкт нижче не загублено, перевіряють інтеграційні тести проти
-- бази: індекси — `test/integration/schema-shape.spec.ts`, `CHECK`-и й
-- тригер-обмеження трейсу — `test/integration/run-trace-fields.spec.ts`.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- Часткові унікальні індекси.
-- ---------------------------------------------------------------------------

-- one active wake-up per attention thread
-- Закриття — обов'язок, виведений зі стану, а не момент: у спільному місці воно
-- змагалося б із усіма, хто посуває рядок, тож місце в нього своє. Правило класу
-- живе й у `src/continuations/reason-class.ts`;
-- `test/integration/closure-request.spec.ts` тримає обидві копії разом.
CREATE UNIQUE INDEX "scheduled_checks_one_active_wake_per_discussion"
  ON "scheduled_checks" ("discussion_id")
  WHERE "discussion_id" IS NOT NULL
    AND "status" IN ('pending', 'running')
    AND "reason_code" <> 'resolution_reconciliation';

-- ... and one active closure per attention thread
CREATE UNIQUE INDEX "scheduled_checks_one_active_closure_per_discussion"
  ON "scheduled_checks" ("discussion_id")
  WHERE "discussion_id" IS NOT NULL
    AND "status" IN ('pending', 'running')
    AND "reason_code" = 'resolution_reconciliation';

-- ... and per (page, reason) where no thread exists yet.
-- Індекси за ниткою тут не допоможуть: у PostgreSQL NULL-и різні, тож рядків без
-- `discussion_id` вони не обмежують взагалі. Їхній предикат `IS NOT NULL` записаний,
-- щоб це було видно, а не виводилось.
CREATE UNIQUE INDEX "scheduled_checks_one_active_per_page_reason"
  ON "scheduled_checks" ("notion_page_id", "reason_code")
  WHERE "discussion_id" IS NULL AND "status" IN ('pending', 'running');

-- one open debounce window per page.
-- Ниткою уваги вікно не є: `INV-204` забороняє унікальність по сторінці саме
-- для ниток, і вони живуть у `scheduled_checks` вище.
CREATE UNIQUE INDEX "evaluation_windows_one_open_per_page"
  ON "evaluation_windows" ("page_id")
  WHERE "status" IN ('pending', 'running');

-- one open proposal per fingerprint of its effects.
-- Нетермінальні статуси `pending_action` — рівно `proposed` і `approved`;
-- термінальна пропозиція нову не блокує.
CREATE UNIQUE INDEX "pending_actions_one_open_per_fingerprint"
  ON "pending_actions" ("fingerprint")
  WHERE "status" IN ('proposed', 'approved');

-- one running run per slot.
-- Атомарність допуску тримає саме цей індекс: два одночасні прогони на той
-- самий слот дають одному з них конфлікт замість двох прогонів під межею в
-- один. Статус не є замком — замком є слот квитка.
CREATE UNIQUE INDEX "run_traces_one_running_per_slot"
  ON "run_traces" ("slot")
  WHERE "status" = 'running';


-- ---------------------------------------------------------------------------
-- Часткові індекси вибірок черг.
--
-- Кожна черга бере найстаріші **відкриті** рядки, а закриті накопичуються:
-- строк зберігання історії — рішення власника, тож тихо вибрати його за нього
-- не можна. Частковий індекс розриває зв'язок між вартістю вибірки і розміром
-- історії: він розміром із чергу, а не з усе, що колись у неї потрапило.
-- ---------------------------------------------------------------------------

-- Виконавець бере найстаріші **доступні** схвалені дії: індекс покриває обидва
-- стовпці предиката.
CREATE INDEX "pending_actions_ready" ON "pending_actions" ("next_attempt_at", "created_at")
  WHERE "status" = 'approved';

-- Черга доставки бере найстаріші очікувані за `created_at`; `sent` і `failed`
-- з індексу виходять. Він же обмежує скан списання вичерпаних.
CREATE INDEX "notification_outbox_pending" ON "notification_outbox" ("created_at")
  WHERE "status" = 'pending';

-- Вибірка вікон бере найстаріші відкриті за `not_before`.
CREATE INDEX "evaluation_windows_open" ON "evaluation_windows" ("not_before")
  WHERE "status" IN ('pending', 'running');


-- ---------------------------------------------------------------------------
-- Обов'язковість у межах рядка трейсу.
--
-- Склад полів трейсу і з якого моменту кожне обов'язкове — `contracts/
-- canonical.yaml`, ключ `run_trace_fields`, поле `required_when`.
--
-- `CHECK`-и, а не перевірка в коді: рядок пише диспетчер, але правило про
-- рядок має тримати таблиця — інакше неповний трейс з'являвся б від першого ж
-- писача, що про правило не знає.
-- ---------------------------------------------------------------------------

-- Рядок, що дійшов висновку, каже, коли; незавершений — не каже.
ALTER TABLE "run_traces" ADD CONSTRAINT "run_traces_finished"
  CHECK (("status" = 'running') = ("finished_at" IS NULL));

-- Висновок пише диспетчер, і годинник App довкола виклику він знає завжди.
-- Покинутий прогін висновку не писав.
ALTER TABLE "run_traces" ADD CONSTRAINT "run_traces_latency"
  CHECK ("status" IN ('running', 'abandoned') OR "latency_ms" IS NOT NULL);

-- `required_when: failed`: причину несе рівно той прогін, що провалився,
-- відкладений чи покинутий. Завершений і незавершений причини не мають.
ALTER TABLE "run_traces" ADD CONSTRAINT "run_traces_reason"
  CHECK (("status" IN ('running', 'completed')) = ("reason" IS NULL));

-- Прогін, відкладений воротами, каже, до якого моменту; жоден інший цього не каже.
-- Момент є лише в ліміту плану: відкладений через Notion чекає рядком.
ALTER TABLE "run_traces" ADD CONSTRAINT "run_traces_deferred"
  CHECK (("status" = 'deferred' AND NOT "notion_unavailable") = ("deferred_until" IS NOT NULL));

-- Прогін, що скінчився через недоступність Notion: відкладений чи, для snooze людини,
-- провалений. Breaker таких не рахує: недоступний Notion — зовнішній стан, а не поломка
-- шляху прогону.
ALTER TABLE "run_traces" ADD CONSTRAINT "run_traces_notion_unavailable"
  CHECK (NOT "notion_unavailable" OR "status" IN ('deferred', 'failed'));

-- `required_when: result`: звіт result-повідомлення цілий або жодного.
-- `terminal_reason` CLI звітує не в кожному result, тож він лише не буває без
-- решти звіту. Токени звіту — рядки `run_model_usage`, і їх без моделі не буває
-- (`run_snapshots_usage` нижче).
ALTER TABLE "run_snapshots" ADD CONSTRAINT "run_snapshots_report"
  CHECK (
    num_nonnulls("model", "num_turns", "duration_ms") IN (0, 3)
    AND ("terminal_reason" IS NULL OR "model" IS NOT NULL)
  );

-- Знімок пишеться, коли прогону є що записати: знімок без жодної частини
-- казав би «прогін звітував», не сказавши нічого.
ALTER TABLE "run_snapshots" ADD CONSTRAINT "run_snapshots_recorded"
  CHECK (num_nonnulls("init", "model", "result") > 0);

-- Лічильник токенів від'ємним не буває.
ALTER TABLE "run_model_usage" ADD CONSTRAINT "run_model_usage_tokens"
  CHECK (
    LEAST(
      "input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"
    ) >= 0
  );


-- ---------------------------------------------------------------------------
-- Обмеження рядків черг і пропозицій.
-- ---------------------------------------------------------------------------

-- Рядок настання несе лише огляд: інші mode за розкладом не настають.
ALTER TABLE "review_occurrences" ADD CONSTRAINT "review_occurrences_review_mode"
  CHECK ("mode" IN ('daily_control', 'weekly_control_review', 'strategic_review', 'deep_review'));

-- Доля — те, чим пропозиція стала; «чекає» — це відсутність долі.
ALTER TABLE "notification_proposals" ADD CONSTRAINT "notification_proposals_fate_decided"
  CHECK ("fate" IS NULL OR "fate" <> 'proposed');

-- «Чекає рішення» не публікується, а вид невиконання є лише в невиконаної.
ALTER TABLE "pending_actions" ADD CONSTRAINT "pending_actions_published_decided"
  CHECK ("published_status" IS NULL OR "published_status" <> 'proposed');
ALTER TABLE "pending_actions" ADD CONSTRAINT "pending_actions_failure_failed"
  CHECK ("failure" IS NULL OR "status" = 'failed');

-- Позначка без моменту першого відкладення не має з чого рахувати паузу.
ALTER TABLE "scheduled_checks" ADD CONSTRAINT "scheduled_checks_notion_hold"
  CHECK ("notion_hold_until" IS NULL OR "notion_held_since" IS NOT NULL);
ALTER TABLE "evaluation_windows" ADD CONSTRAINT "evaluation_windows_notion_hold"
  CHECK ("notion_hold_until" IS NULL OR "notion_held_since" IS NOT NULL);
ALTER TABLE "review_occurrences" ADD CONSTRAINT "review_occurrences_notion_hold"
  CHECK ("notion_hold_until" IS NULL OR "notion_held_since" IS NOT NULL);


-- ---------------------------------------------------------------------------
-- Правила між таблицями трейсу.
--
-- `CHECK` бачить лише свій рядок, а ці правила зв'язують рядок ледера, знімок і
-- переліки. Тримає їх тригер-обмеження, відкладений до кінця транзакції:
-- висновок пишеться кількома інструкціями, і перевіряти треба трейс, яким він
-- став після останньої, а не проміжний стан між ними. Функція правил одна, і
-- кожен тригер питає її про свій прогін: будь-яка зміна будь-якої частини
-- трейсу перевіряє трейс цілим.
--
-- Порушення звітується так само, як порушений `CHECK`, — `check_violation` з
-- іменем правила, — тож для писача різниці немає. Видалення з переліків правил
-- не порушує, тож тригери переліків на нього не чекають.
-- ---------------------------------------------------------------------------

CREATE FUNCTION "run_trace_consistent"("target" TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  run_status "RunStatus";
  snap "run_snapshots"%ROWTYPE;
  violated TEXT;
BEGIN
  SELECT t."status" INTO run_status FROM "run_traces" AS t WHERE t."id" = "target";

  -- Рядка ледера вже немає: його видалення забрало трейс каскадом.
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Знімка немає — усі поля `snap` порожні, і `snap."run_id"` теж.
  SELECT * INTO snap FROM "run_snapshots" AS s WHERE s."run_id" = "target";

  IF run_status = 'completed'
     AND (snap."init" IS NULL OR snap."model" IS NULL OR snap."result" IS NULL) THEN
    -- `required_when: completed`: завершений прогін має init, звіт і результат.
    violated := 'run_traces_completed';
  ELSIF run_status IN ('running', 'abandoned')
     AND (
       snap."run_id" IS NOT NULL
       OR EXISTS (SELECT 1 FROM "run_applied_effects" AS a WHERE a."run_id" = "target")
     ) THEN
    -- Знімок і ефекти пишуться разом із висновком; прогін, що висновку не
    -- дійшов, не відзвітував нічого.
    violated := 'run_traces_reported';
  ELSIF snap."init" IS NULL
     AND (
       EXISTS (SELECT 1 FROM "run_tool_calls" AS c WHERE c."run_id" = "target")
       OR EXISTS (SELECT 1 FROM "run_policy_decisions" AS d WHERE d."run_id" = "target")
     ) THEN
    -- `required_when: init`: викликів і відмов до init не буває.
    violated := 'run_snapshots_init';
  ELSIF snap."model" IS NULL
     AND EXISTS (SELECT 1 FROM "run_model_usage" AS u WHERE u."run_id" = "target") THEN
    -- `required_when: result`: токени — частина звіту result-повідомлення.
    violated := 'run_snapshots_usage';
  END IF;

  IF violated IS NOT NULL THEN
    RAISE EXCEPTION 'run % violates check constraint "%"', "target", violated
      USING ERRCODE = 'check_violation', CONSTRAINT = violated;
  END IF;
END;
$$;

CREATE FUNCTION "run_traces_consistent"() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM "run_trace_consistent"(NEW."id");

  RETURN NULL;
END;
$$;

-- Частина трейсу, що переїхала до іншого прогону, змінює обидва.
CREATE FUNCTION "run_trace_part_consistent"() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'DELETE' THEN
    PERFORM "run_trace_consistent"(NEW."run_id");
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM "run_trace_consistent"(OLD."run_id");
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD."run_id" <> NEW."run_id" THEN
      PERFORM "run_trace_consistent"(OLD."run_id");
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "run_traces_consistent"
  AFTER INSERT OR UPDATE ON "run_traces"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "run_traces_consistent"();

CREATE CONSTRAINT TRIGGER "run_snapshots_consistent"
  AFTER INSERT OR UPDATE OR DELETE ON "run_snapshots"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "run_trace_part_consistent"();

CREATE CONSTRAINT TRIGGER "run_tool_calls_consistent"
  AFTER INSERT OR UPDATE ON "run_tool_calls"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "run_trace_part_consistent"();

CREATE CONSTRAINT TRIGGER "run_policy_decisions_consistent"
  AFTER INSERT OR UPDATE ON "run_policy_decisions"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "run_trace_part_consistent"();

CREATE CONSTRAINT TRIGGER "run_model_usage_consistent"
  AFTER INSERT OR UPDATE ON "run_model_usage"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "run_trace_part_consistent"();

CREATE CONSTRAINT TRIGGER "run_applied_effects_consistent"
  AFTER INSERT OR UPDATE ON "run_applied_effects"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "run_trace_part_consistent"();
