CREATE TABLE "backup_settings" (
  "id" TEXT NOT NULL DEFAULT 'global',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "cron_expr" VARCHAR(50) NOT NULL DEFAULT '0 2 * * *',
  "retention_count" INTEGER NOT NULL DEFAULT 30,
  "scope_db" BOOLEAN NOT NULL DEFAULT true,
  "scope_uploads" BOOLEAN NOT NULL DEFAULT true,
  "rclone_remote" VARCHAR(50) NOT NULL DEFAULT 'gdrive',
  "remote_folder" VARCHAR(200) NOT NULL DEFAULT 'app-backups',
  "gdrive_client_id" VARCHAR(200) NOT NULL DEFAULT '',
  "gdrive_client_secret" VARCHAR(200) NOT NULL DEFAULT '',
  "gdrive_account_email" VARCHAR(200) NOT NULL DEFAULT '',
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "backup_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "backup_settings_id_check" CHECK ("id" = 'global')
);
INSERT INTO "backup_settings" ("id") VALUES ('global') ON CONFLICT DO NOTHING;

CREATE TABLE "backup_runs" (
  "id" TEXT NOT NULL,
  "kind" VARCHAR(20) NOT NULL,
  "status" VARCHAR(20) NOT NULL,
  "scope_db" BOOLEAN NOT NULL DEFAULT false,
  "scope_uploads" BOOLEAN NOT NULL DEFAULT false,
  "started_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "finished_at" TIMESTAMPTZ,
  "size_bytes" BIGINT NOT NULL DEFAULT 0,
  "remote_path" VARCHAR(500) NOT NULL DEFAULT '',
  "error" TEXT NOT NULL DEFAULT '',
  "log_tail" TEXT NOT NULL DEFAULT '',
  "triggered_by" TEXT,
  CONSTRAINT "backup_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "idx_backup_runs_started_at" ON "backup_runs"("started_at" DESC);
