-- Indexes for users
CREATE UNIQUE INDEX IF NOT EXISTS "users_telegram_id_idx" ON "users" USING btree ("telegram_id");
CREATE INDEX IF NOT EXISTS "users_subscription_status_idx" ON "users" USING btree ("subscription_status");
CREATE INDEX IF NOT EXISTS "users_subscription_end_date_idx" ON "users" USING btree ("subscription_end_date");

-- Indexes for consents
CREATE INDEX IF NOT EXISTS "consents_user_id_idx" ON "consents" USING btree ("user_id");

-- Indexes for statement_profiles
CREATE INDEX IF NOT EXISTS "statement_profiles_status_idx" ON "statement_profiles" USING btree ("status");
CREATE INDEX IF NOT EXISTS "statement_profiles_signature_idx" ON "statement_profiles" USING btree ("signature");

-- Indexes for imports
CREATE INDEX IF NOT EXISTS "imports_user_id_idx" ON "imports" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "imports_source_type_idx" ON "imports" USING btree ("source_type");
CREATE INDEX IF NOT EXISTS "imports_status_idx" ON "imports" USING btree ("status");
CREATE INDEX IF NOT EXISTS "imports_created_at_idx" ON "imports" USING btree ("created_at");
CREATE INDEX IF NOT EXISTS "imports_file_hash_idx" ON "imports" USING btree ("file_hash");

-- Indexes for parsing_errors
CREATE INDEX IF NOT EXISTS "parsing_errors_import_id_idx" ON "parsing_errors" USING btree ("import_id");
CREATE INDEX IF NOT EXISTS "parsing_errors_error_code_idx" ON "parsing_errors" USING btree ("error_code");

-- Indexes for canonical_transactions
CREATE INDEX IF NOT EXISTS "canonical_transactions_import_id_idx" ON "canonical_transactions" USING btree ("import_id");
CREATE INDEX IF NOT EXISTS "canonical_transactions_transaction_date_idx" ON "canonical_transactions" USING btree ("transaction_date");
CREATE INDEX IF NOT EXISTS "canonical_transactions_amount_kopeks_idx" ON "canonical_transactions" USING btree ("amount_kopeks");
CREATE INDEX IF NOT EXISTS "canonical_transactions_direction_idx" ON "canonical_transactions" USING btree ("direction");
CREATE INDEX IF NOT EXISTS "canonical_transactions_row_hash_idx" ON "canonical_transactions" USING btree ("row_hash");

-- Indexes for reconciliation_runs
CREATE INDEX IF NOT EXISTS "reconciliation_runs_user_id_idx" ON "reconciliation_runs" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "reconciliation_runs_status_idx" ON "reconciliation_runs" USING btree ("status");
CREATE INDEX IF NOT EXISTS "reconciliation_runs_started_at_idx" ON "reconciliation_runs" USING btree ("started_at");

-- Indexes for reconciliation_candidates
CREATE INDEX IF NOT EXISTS "reconciliation_candidates_run_id_idx" ON "reconciliation_candidates" USING btree ("run_id");
CREATE INDEX IF NOT EXISTS "reconciliation_candidates_score_idx" ON "reconciliation_candidates" USING btree ("score");
CREATE INDEX IF NOT EXISTS "reconciliation_candidates_wb_tx_id_idx" ON "reconciliation_candidates" USING btree ("wb_tx_id");
CREATE INDEX IF NOT EXISTS "reconciliation_candidates_bank_tx_id_idx" ON "reconciliation_candidates" USING btree ("bank_tx_id");
CREATE UNIQUE INDEX IF NOT EXISTS "reconciliation_candidates_unique_pair_idx" ON "reconciliation_candidates" USING btree ("run_id","wb_tx_id","bank_tx_id");

-- Indexes for reconciliation_matches
CREATE INDEX IF NOT EXISTS "reconciliation_matches_run_id_idx" ON "reconciliation_matches" USING btree ("run_id");
CREATE INDEX IF NOT EXISTS "reconciliation_matches_match_type_idx" ON "reconciliation_matches" USING btree ("match_type");

-- Indexes for reconciliation_match_items
CREATE INDEX IF NOT EXISTS "reconciliation_match_items_match_id_idx" ON "reconciliation_match_items" USING btree ("match_id");
CREATE INDEX IF NOT EXISTS "reconciliation_match_items_transaction_id_idx" ON "reconciliation_match_items" USING btree ("transaction_id");

-- Indexes for reconciliation_evidence
CREATE INDEX IF NOT EXISTS "reconciliation_evidence_match_id_idx" ON "reconciliation_evidence" USING btree ("match_id");

-- Indexes for reports
CREATE INDEX IF NOT EXISTS "reports_run_id_idx" ON "reports" USING btree ("run_id");

-- Indexes for billing_transactions
CREATE INDEX IF NOT EXISTS "billing_transactions_user_id_idx" ON "billing_transactions" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "billing_transactions_status_idx" ON "billing_transactions" USING btree ("status");

-- Indexes for audit_events
CREATE INDEX IF NOT EXISTS "audit_events_user_id_idx" ON "audit_events" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "audit_events_event_type_idx" ON "audit_events" USING btree ("event_type");
CREATE INDEX IF NOT EXISTS "audit_events_created_at_idx" ON "audit_events" USING btree ("created_at");

-- Indexes for jobs
CREATE INDEX IF NOT EXISTS "jobs_status_idx" ON "jobs" USING btree ("status");
CREATE INDEX IF NOT EXISTS "jobs_job_type_idx" ON "jobs" USING btree ("job_type");
CREATE INDEX IF NOT EXISTS "jobs_created_at_idx" ON "jobs" USING btree ("created_at");
CREATE INDEX IF NOT EXISTS "jobs_correlation_id_idx" ON "jobs" USING btree ("correlation_id");
