CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"event_type" text,
	"entity_type" text,
	"entity_id" uuid,
	"old_state" jsonb,
	"new_state" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"amount_kopeks" bigint,
	"currency" text,
	"status" "payment_status_enum",
	"provider" text,
	"provider_tx_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "canonical_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"source_type" "import_source_enum",
	"row_number" integer,
	"transaction_date" timestamp with time zone,
	"amount_kopeks" bigint,
	"currency" text,
	"direction" "transaction_direction_enum",
	"reference" text,
	"description" text,
	"counterparty" text,
	"row_hash" text,
	"raw_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "canonical_transactions_amount_check" CHECK (amount_kopeks != 0)
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"consent_version" text,
	"accepted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_type" "import_source_enum",
	"storage_path" text,
	"original_filename" text,
	"file_hash" text,
	"file_size_bytes" bigint,
	"period_start" date,
	"period_end" date,
	"status" "import_status_enum",
	"quality_status" "quality_status_enum",
	"profile_id" uuid,
	"profile_status" text,
	"parser_version" text,
	"profile_confidence" numeric(5, 4),
	"parse_success_rate" numeric(5, 2),
	"error_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "imports_parse_success_rate_check" CHECK (parse_success_rate IS NULL OR (parse_success_rate >= 0 AND parse_success_rate <= 100)),
	CONSTRAINT "imports_profile_confidence_check" CHECK (profile_confidence IS NULL OR (profile_confidence >= 0 AND profile_confidence <= 1))
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_type" text,
	"entity_id" uuid,
	"correlation_id" uuid,
	"status" "job_status_enum",
	"retries" integer,
	"last_error" text,
	"payload" jsonb,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parsing_errors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"row_number" integer,
	"error_code" text,
	"error_message" text,
	"raw_fragment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconciliation_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"wb_tx_id" uuid NOT NULL,
	"bank_tx_id" uuid NOT NULL,
	"score" numeric(5, 4),
	"reason_codes" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconciliation_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"amount_score" numeric(5, 4),
	"date_score" numeric(5, 4),
	"reference_score" numeric(5, 4),
	"description_score" numeric(5, 4),
	"counterparty_score" numeric(5, 4),
	"penalties" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconciliation_match_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"side" "import_source_enum",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconciliation_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"match_type" "match_type_enum",
	"final_score" numeric(5, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconciliation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"wb_import_id" uuid NOT NULL,
	"bank_import_id" uuid NOT NULL,
	"status" "reconciliation_status_enum",
	"failure_reason" text,
	"total_wb_rows" integer,
	"total_bank_rows" integer,
	"matched_count" integer,
	"unmatched_count" integer,
	"ambiguous_count" integer,
	"split_count" integer,
	"combined_count" integer,
	"match_rate" numeric(5, 2),
	"unmatched_amount" bigint,
	"ambiguous_amount" bigint,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reconciliation_runs_match_rate_check" CHECK (match_rate IS NULL OR (match_rate >= 0 AND match_rate <= 100)),
	CONSTRAINT "reconciliation_runs_completed_at_check" CHECK (completed_at IS NULL OR completed_at >= started_at)
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"storage_path" text,
	"export_type" "report_type_enum",
	"report_version" integer,
	"is_primary" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"value_json" jsonb,
	"description" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "statement_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_key" text NOT NULL,
	"display_name" text,
	"bank_name_pattern" text,
	"file_type" "file_type_enum",
	"status" "profile_status_enum",
	"version" integer,
	"signature" text,
	"header_row_index" integer,
	"column_mapping" jsonb,
	"date_format" text,
	"amount_format" text,
	"usage_count" integer DEFAULT 0,
	"success_rate" numeric(5, 2),
	"config_json" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "statement_profiles_profile_key_unique" UNIQUE("profile_key"),
	CONSTRAINT "statement_profiles_success_rate_check" CHECK (success_rate IS NULL OR (success_rate >= 0 AND success_rate <= 100))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_id" bigint,
	"username" text,
	"consent_given_at" timestamp with time zone,
	"trial_expires_at" timestamp with time zone,
	"subscription_status" "subscription_status_enum",
	"subscription_end_date" timestamp with time zone,
	"last_update_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_end_date_check" CHECK (subscription_end_date IS NULL OR subscription_end_date >= created_at),
	CONSTRAINT "users_subscription_check" CHECK ((subscription_status = 'TRIAL' AND trial_expires_at IS NOT NULL) OR (subscription_status = 'ACTIVE' AND subscription_end_date IS NOT NULL) OR (subscription_status = 'EXPIRED' AND (trial_expires_at IS NOT NULL OR subscription_end_date IS NOT NULL)))
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_transactions" ADD CONSTRAINT "billing_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canonical_transactions" ADD CONSTRAINT "canonical_transactions_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_profile_id_statement_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."statement_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parsing_errors" ADD CONSTRAINT "parsing_errors_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_candidates" ADD CONSTRAINT "reconciliation_candidates_run_id_reconciliation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."reconciliation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_candidates" ADD CONSTRAINT "reconciliation_candidates_wb_tx_id_canonical_transactions_id_fk" FOREIGN KEY ("wb_tx_id") REFERENCES "public"."canonical_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_candidates" ADD CONSTRAINT "reconciliation_candidates_bank_tx_id_canonical_transactions_id_fk" FOREIGN KEY ("bank_tx_id") REFERENCES "public"."canonical_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_evidence" ADD CONSTRAINT "reconciliation_evidence_match_id_reconciliation_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."reconciliation_matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_match_items" ADD CONSTRAINT "reconciliation_match_items_match_id_reconciliation_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."reconciliation_matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_match_items" ADD CONSTRAINT "reconciliation_match_items_transaction_id_canonical_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."canonical_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_matches" ADD CONSTRAINT "reconciliation_matches_run_id_reconciliation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."reconciliation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_runs" ADD CONSTRAINT "reconciliation_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_runs" ADD CONSTRAINT "reconciliation_runs_wb_import_id_imports_id_fk" FOREIGN KEY ("wb_import_id") REFERENCES "public"."imports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_runs" ADD CONSTRAINT "reconciliation_runs_bank_import_id_imports_id_fk" FOREIGN KEY ("bank_import_id") REFERENCES "public"."imports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_run_id_reconciliation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."reconciliation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_profiles" ADD CONSTRAINT "statement_profiles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_user_id_idx" ON "audit_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_events_event_type_idx" ON "audit_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "audit_events_created_at_idx" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "billing_transactions_user_id_idx" ON "billing_transactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "billing_transactions_status_idx" ON "billing_transactions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "canonical_transactions_import_id_idx" ON "canonical_transactions" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX "canonical_transactions_transaction_date_idx" ON "canonical_transactions" USING btree ("transaction_date");--> statement-breakpoint
CREATE INDEX "canonical_transactions_amount_kopeks_idx" ON "canonical_transactions" USING btree ("amount_kopeks");--> statement-breakpoint
CREATE INDEX "canonical_transactions_direction_idx" ON "canonical_transactions" USING btree ("direction");--> statement-breakpoint
CREATE INDEX "canonical_transactions_row_hash_idx" ON "canonical_transactions" USING btree ("row_hash");--> statement-breakpoint
CREATE INDEX "consents_user_id_idx" ON "consents" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "imports_user_id_idx" ON "imports" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "imports_source_type_idx" ON "imports" USING btree ("source_type");--> statement-breakpoint
CREATE INDEX "imports_status_idx" ON "imports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "imports_created_at_idx" ON "imports" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "imports_file_hash_idx" ON "imports" USING btree ("file_hash");--> statement-breakpoint
CREATE INDEX "jobs_status_idx" ON "jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "jobs_job_type_idx" ON "jobs" USING btree ("job_type");--> statement-breakpoint
CREATE INDEX "jobs_created_at_idx" ON "jobs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "jobs_correlation_id_idx" ON "jobs" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "parsing_errors_import_id_idx" ON "parsing_errors" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX "parsing_errors_error_code_idx" ON "parsing_errors" USING btree ("error_code");--> statement-breakpoint
CREATE INDEX "reconciliation_candidates_run_id_idx" ON "reconciliation_candidates" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "reconciliation_candidates_score_idx" ON "reconciliation_candidates" USING btree ("score");--> statement-breakpoint
CREATE INDEX "reconciliation_candidates_wb_tx_id_idx" ON "reconciliation_candidates" USING btree ("wb_tx_id");--> statement-breakpoint
CREATE INDEX "reconciliation_candidates_bank_tx_id_idx" ON "reconciliation_candidates" USING btree ("bank_tx_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliation_candidates_unique_pair_idx" ON "reconciliation_candidates" USING btree ("run_id","wb_tx_id","bank_tx_id");--> statement-breakpoint
CREATE INDEX "reconciliation_evidence_match_id_idx" ON "reconciliation_evidence" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "reconciliation_match_items_match_id_idx" ON "reconciliation_match_items" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "reconciliation_match_items_transaction_id_idx" ON "reconciliation_match_items" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "reconciliation_matches_run_id_idx" ON "reconciliation_matches" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "reconciliation_matches_match_type_idx" ON "reconciliation_matches" USING btree ("match_type");--> statement-breakpoint
CREATE INDEX "reconciliation_runs_user_id_idx" ON "reconciliation_runs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "reconciliation_runs_status_idx" ON "reconciliation_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "reconciliation_runs_started_at_idx" ON "reconciliation_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "reports_run_id_idx" ON "reports" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "statement_profiles_status_idx" ON "statement_profiles" USING btree ("status");--> statement-breakpoint
CREATE INDEX "statement_profiles_signature_idx" ON "statement_profiles" USING btree ("signature");--> statement-breakpoint
CREATE UNIQUE INDEX "users_telegram_id_idx" ON "users" USING btree ("telegram_id");--> statement-breakpoint
CREATE INDEX "users_subscription_status_idx" ON "users" USING btree ("subscription_status");--> statement-breakpoint
CREATE INDEX "users_subscription_end_date_idx" ON "users" USING btree ("subscription_end_date");