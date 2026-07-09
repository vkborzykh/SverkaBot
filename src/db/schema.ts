import {
  pgTable,
  uuid,
  bigint,
  text,
  boolean,
  integer,
  decimal,
  jsonb,
  timestamp,
  date,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  subscriptionStatusEnum,
  importSourceEnum,
  marketplaceEnum,
  importStatusEnum,
  qualityStatusEnum,
  profileStatusEnum,
  fileTypeEnum,
  transactionDirectionEnum,
  reconciliationStatusEnum,
  matchTypeEnum,
  reportTypeEnum,
  paymentStatusEnum,
  jobStatusEnum,
} from './enums';

// ── users ────────────────────────────────────────────────────────────────────

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    telegram_id: bigint('telegram_id', { mode: 'bigint' }),
    username: text('username'),
    consent_given_at: timestamp('consent_given_at', { withTimezone: true }),
    trial_expires_at: timestamp('trial_expires_at', { withTimezone: true }),
    subscription_status: subscriptionStatusEnum('subscription_status'),
    subscription_end_date: timestamp('subscription_end_date', {
      withTimezone: true,
    }),
    has_used_trial: boolean('has_used_trial').notNull().default(false),
    invited_by: bigint('invited_by', { mode: 'bigint' }),
    tariff: text('tariff').default('START'),
    monthly_reconciliations: integer('monthly_reconciliations').default(0),
    current_cabinet_id: uuid('current_cabinet_id').references(() => wb_cabinets.id, { onDelete: 'set null' }),
    last_update_id: bigint('last_update_id', { mode: 'bigint' }),
    created_at: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    deleted_at: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('users_telegram_id_idx').on(t.telegram_id),
    index('users_subscription_status_idx').on(t.subscription_status),
    index('users_subscription_end_date_idx').on(t.subscription_end_date),
    index('users_has_used_trial_idx').on(t.has_used_trial),
    index('users_invited_by_idx').on(t.invited_by),
    check(
      'users_end_date_check',
      sql`subscription_end_date IS NULL OR subscription_end_date >= created_at`,
    ),
    check(
      'users_subscription_check',
      sql`(subscription_status = 'TRIAL' AND trial_expires_at IS NOT NULL) OR (subscription_status = 'ACTIVE' AND subscription_end_date IS NOT NULL) OR (subscription_status = 'EXPIRED' AND (trial_expires_at IS NOT NULL OR subscription_end_date IS NOT NULL))`,
    ),
  ],
);

// ── consents ─────────────────────────────────────────────────────────────────

export const consents = pgTable(
  'consents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    consent_version: text('consent_version'),
    accepted_at: timestamp('accepted_at', { withTimezone: true }),
  },
  (t) => [index('consents_user_id_idx').on(t.user_id)],
);

// ── trial_usage ──────────────────────────────────────────────────────────────

export const trial_usage = pgTable('trial_usage', {
  telegram_id: bigint('telegram_id', { mode: 'bigint' }).primaryKey(),
  used_at: timestamp('used_at', { withTimezone: true }).defaultNow().notNull(),
});

// ── admin_notifications ──────────────────────────────────────────────────────

export const admin_notifications = pgTable(
  'admin_notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    severity: text('severity').notNull(),
    title: text('title').notNull(),
    message: text('message').notNull(),
    resolved: boolean('resolved').notNull().default(false),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('admin_notifications_resolved_idx').on(t.resolved)],
);

// ── wb_cabinets ──────────────────────────────────────────────────────────────

export const wb_cabinets = pgTable(
  'wb_cabinets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    created_at: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    deleted_at: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('wb_cabinets_user_id_idx').on(t.user_id),
    uniqueIndex('wb_cabinets_user_name_unique_idx')
      .on(t.user_id, t.name)
      .where(sql`${t.deleted_at} IS NULL`),
    check('wb_cabinets_name_length_check', sql`char_length(name) BETWEEN 1 AND 64`),
  ],
);

// ── statement_profiles ────────────────────────────────────────────────────────

export const statement_profiles = pgTable(
  'statement_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    profile_key: text('profile_key').notNull().unique(),
    display_name: text('display_name'),
    bank_name_pattern: text('bank_name_pattern'),
    file_type: fileTypeEnum('file_type'),
    status: profileStatusEnum('status'),
    version: integer('version'),
    signature: text('signature'),
    header_row_index: integer('header_row_index'),
    column_mapping: jsonb('column_mapping'),
    date_format: text('date_format'),
    amount_format: text('amount_format'),
    usage_count: integer('usage_count').default(0),
    success_rate: decimal('success_rate', { precision: 5, scale: 2 }),
    config_json: jsonb('config_json'),
    marketplace: marketplaceEnum('marketplace').notNull().default('WB'),
    created_by: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    created_at: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    deleted_at: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('statement_profiles_status_idx').on(t.status),
    index('statement_profiles_signature_idx').on(t.signature),
    check(
      'statement_profiles_success_rate_check',
      sql`success_rate IS NULL OR (success_rate >= 0 AND success_rate <= 100)`,
    ),
  ],
);

// ── imports ───────────────────────────────────────────────────────────────────

export const imports = pgTable(
  'imports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    source_type: importSourceEnum('source_type'),
    marketplace: marketplaceEnum('marketplace'),
    cabinet_id: uuid('cabinet_id').references(() => wb_cabinets.id, {
      onDelete: 'set null',
    }),
    storage_path: text('storage_path'),
    original_filename: text('original_filename'),
    file_hash: text('file_hash'),
    file_size_bytes: bigint('file_size_bytes', { mode: 'bigint' }),
    period_start: date('period_start'),
    period_end: date('period_end'),
    status: importStatusEnum('status'),
    quality_status: qualityStatusEnum('quality_status'),
    profile_id: uuid('profile_id').references(() => statement_profiles.id, {
      onDelete: 'set null',
    }),
    profile_status: text('profile_status'),
    parser_version: text('parser_version'),
    profile_confidence: decimal('profile_confidence', {
      precision: 5,
      scale: 4,
    }),
    parse_success_rate: decimal('parse_success_rate', {
      precision: 5,
      scale: 2,
    }),
    error_count: integer('error_count'),
    delimiter: text('delimiter'),
    failure_reason: text('failure_reason'),
    created_at: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    deleted_at: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('imports_user_id_idx').on(t.user_id),
    index('imports_source_type_idx').on(t.source_type),
    index('imports_status_idx').on(t.status),
    index('imports_created_at_idx').on(t.created_at),
    index('imports_file_hash_idx').on(t.file_hash),
    index('imports_marketplace_idx').on(t.marketplace),
    index('imports_cabinet_id_idx').on(t.cabinet_id),
    uniqueIndex('imports_dedup_unique_idx')
      .on(t.user_id, t.source_type, t.file_hash)
      .where(sql`${t.deleted_at} IS NULL`),
    check(
      'imports_parse_success_rate_check',
      sql`parse_success_rate IS NULL OR (parse_success_rate >= 0 AND parse_success_rate <= 100)`,
    ),
    check(
      'imports_profile_confidence_check',
      sql`profile_confidence IS NULL OR (profile_confidence >= 0 AND profile_confidence <= 1)`,
    ),
  ],
);

// ── parsing_errors ────────────────────────────────────────────────────────────

export const parsing_errors = pgTable(
  'parsing_errors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    import_id: uuid('import_id')
      .notNull()
      .references(() => imports.id, { onDelete: 'cascade' }),
    row_number: integer('row_number'),
    error_code: text('error_code'),
    error_message: text('error_message'),
    raw_fragment: text('raw_fragment'),
    created_at: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('parsing_errors_import_id_idx').on(t.import_id),
    index('parsing_errors_error_code_idx').on(t.error_code),
  ],
);

// ── canonical_transactions ────────────────────────────────────────────────────

export const canonical_transactions = pgTable(
  'canonical_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    import_id: uuid('import_id')
      .notNull()
      .references(() => imports.id, { onDelete: 'cascade' }),
    source_type: importSourceEnum('source_type'),
    marketplace: marketplaceEnum('marketplace'),
    row_number: integer('row_number'),
    transaction_date: timestamp('transaction_date', { withTimezone: true }),
    amount_kopeks: bigint('amount_kopeks', { mode: 'bigint' }),
    currency: text('currency'),
    direction: transactionDirectionEnum('direction'),
    reference: text('reference'),
    description: text('description'),
    counterparty: text('counterparty'),
    row_hash: text('row_hash'),
    raw_payload: jsonb('raw_payload'),
    created_at: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('canonical_transactions_import_id_idx').on(t.import_id),
    index('canonical_transactions_transaction_date_idx').on(t.transaction_date),
    index('canonical_transactions_amount_kopeks_idx').on(t.amount_kopeks),
    index('canonical_transactions_direction_idx').on(t.direction),
    index('canonical_transactions_row_hash_idx').on(t.row_hash),
    check('canonical_transactions_amount_check', sql`amount_kopeks != 0`),
  ],
);

// ── reconciliation_runs ───────────────────────────────────────────────────────

export const reconciliation_runs = pgTable(
  'reconciliation_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    wb_import_id: uuid('wb_import_id')
      .notNull()
      .references(() => imports.id, { onDelete: 'restrict' }),
    bank_import_id: uuid('bank_import_id')
      .notNull()
      .references(() => imports.id, { onDelete: 'restrict' }),
    status: reconciliationStatusEnum('status'),
    failure_reason: text('failure_reason'),
    total_wb_rows: integer('total_wb_rows'),
    total_bank_rows: integer('total_bank_rows'),
    matched_count: integer('matched_count'),
    unmatched_count: integer('unmatched_count'),
    ambiguous_count: integer('ambiguous_count'),
    split_count: integer('split_count'),
    combined_count: integer('combined_count'),
    match_rate: decimal('match_rate', { precision: 5, scale: 2 }),
    unmatched_amount: bigint('unmatched_amount', { mode: 'bigint' }),
    ambiguous_amount: bigint('ambiguous_amount', { mode: 'bigint' }),
    turnover_kopeks: bigint('turnover_kopeks', { mode: 'bigint' }),
    loss_kopeks: bigint('loss_kopeks', { mode: 'bigint' }),
    loss_percent: decimal('loss_percent', { precision: 8, scale: 4 }),
    started_at: timestamp('started_at', { withTimezone: true }),
    completed_at: timestamp('completed_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('reconciliation_runs_user_id_idx').on(t.user_id),
    index('reconciliation_runs_status_idx').on(t.status),
    index('reconciliation_runs_started_at_idx').on(t.started_at),
    check(
      'reconciliation_runs_match_rate_check',
      sql`match_rate IS NULL OR (match_rate >= 0 AND match_rate <= 100)`,
    ),
    check(
      'reconciliation_runs_completed_at_check',
      sql`completed_at IS NULL OR completed_at >= started_at`,
    ),
  ],
);

// ── reconciliation_candidates ─────────────────────────────────────────────────

export const reconciliation_candidates = pgTable(
  'reconciliation_candidates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    run_id: uuid('run_id')
      .notNull()
      .references(() => reconciliation_runs.id, { onDelete: 'cascade' }),
    wb_tx_id: uuid('wb_tx_id')
      .notNull()
      .references(() => canonical_transactions.id, { onDelete: 'cascade' }),
    bank_tx_id: uuid('bank_tx_id')
      .notNull()
      .references(() => canonical_transactions.id, { onDelete: 'cascade' }),
    score: decimal('score', { precision: 5, scale: 4 }),
    reason_codes: jsonb('reason_codes'),
    created_at: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('reconciliation_candidates_run_id_idx').on(t.run_id),
    index('reconciliation_candidates_score_idx').on(t.score),
    index('reconciliation_candidates_wb_tx_id_idx').on(t.wb_tx_id),
    index('reconciliation_candidates_bank_tx_id_idx').on(t.bank_tx_id),
    uniqueIndex('reconciliation_candidates_unique_pair_idx').on(
      t.run_id,
      t.wb_tx_id,
      t.bank_tx_id,
    ),
  ],
);

// ── reconciliation_matches ────────────────────────────────────────────────────

export const reconciliation_matches = pgTable(
  'reconciliation_matches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    run_id: uuid('run_id')
      .notNull()
      .references(() => reconciliation_runs.id, { onDelete: 'cascade' }),
    match_type: matchTypeEnum('match_type'),
    final_score: decimal('final_score', { precision: 5, scale: 4 }),
    created_at: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('reconciliation_matches_run_id_idx').on(t.run_id),
    index('reconciliation_matches_match_type_idx').on(t.match_type),
  ],
);

// ── reconciliation_match_items ────────────────────────────────────────────────

export const reconciliation_match_items = pgTable(
  'reconciliation_match_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    match_id: uuid('match_id')
      .notNull()
      .references(() => reconciliation_matches.id, { onDelete: 'cascade' }),
    transaction_id: uuid('transaction_id')
      .notNull()
      .references(() => canonical_transactions.id, { onDelete: 'cascade' }),
    side: importSourceEnum('side'),
    created_at: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('reconciliation_match_items_match_id_idx').on(t.match_id),
    index('reconciliation_match_items_transaction_id_idx').on(t.transaction_id),
  ],
);

// ── reconciliation_evidence ───────────────────────────────────────────────────

export const reconciliation_evidence = pgTable(
  'reconciliation_evidence',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    match_id: uuid('match_id')
      .notNull()
      .references(() => reconciliation_matches.id, { onDelete: 'cascade' }),
    amount_score: decimal('amount_score', { precision: 5, scale: 4 }),
    date_score: decimal('date_score', { precision: 5, scale: 4 }),
    reference_score: decimal('reference_score', { precision: 5, scale: 4 }),
    description_score: decimal('description_score', {
      precision: 5,
      scale: 4,
    }),
    counterparty_score: decimal('counterparty_score', {
      precision: 5,
      scale: 4,
    }),
    penalties: jsonb('penalties'),
    created_at: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index('reconciliation_evidence_match_id_idx').on(t.match_id)],
);

// ── reports ───────────────────────────────────────────────────────────────────

export const reports = pgTable(
  'reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    run_id: uuid('run_id')
      .notNull()
      .references(() => reconciliation_runs.id, { onDelete: 'cascade' }),
    storage_path: text('storage_path'),
    export_type: reportTypeEnum('export_type'),
    report_version: integer('report_version'),
    is_primary: boolean('is_primary').default(true),
    retention_days: integer('retention_days'),
    created_at: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    deleted_at: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('reports_run_id_idx').on(t.run_id)],
);

// ── billing_transactions ──────────────────────────────────────────────────────

export const billing_transactions = pgTable(
  'billing_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    amount_kopeks: bigint('amount_kopeks', { mode: 'bigint' }),
    currency: text('currency'),
    status: paymentStatusEnum('status'),
    provider: text('provider'),
    provider_tx_id: text('provider_tx_id'),
    confirmation_url: text('confirmation_url'),
    referral_bonus_granted: boolean('referral_bonus_granted').default(false),
    created_at: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('billing_transactions_user_id_idx').on(t.user_id),
    index('billing_transactions_status_idx').on(t.status),
    uniqueIndex('billing_provider_tx_unique_idx')
      .on(t.provider_tx_id)
      .where(sql`${t.provider_tx_id} IS NOT NULL`),
  ],
);

// ── settings ──────────────────────────────────────────────────────────────────

export const settings = pgTable(
  'settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull().unique(),
    value_json: jsonb('value_json'),
    description: text('description'),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  () => [],
);

// ── audit_events ──────────────────────────────────────────────────────────────

export const audit_events = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    user_id: uuid('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    event_type: text('event_type'),
    entity_type: text('entity_type'),
    entity_id: uuid('entity_id'),
    old_state: jsonb('old_state'),
    new_state: jsonb('new_state'),
    created_at: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('audit_events_user_id_idx').on(t.user_id),
    index('audit_events_event_type_idx').on(t.event_type),
    index('audit_events_created_at_idx').on(t.created_at),
  ],
);

// ── jobs ──────────────────────────────────────────────────────────────────────

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    job_type: text('job_type'),
    entity_id: uuid('entity_id'),
    correlation_id: uuid('correlation_id'),
    status: jobStatusEnum('status'),
    retries: integer('retries'),
    last_error: text('last_error'),
    payload: jsonb('payload'),
    priority: integer('priority').notNull().default(100),
    started_at: timestamp('started_at', { withTimezone: true }),
    completed_at: timestamp('completed_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('jobs_status_idx').on(t.status),
    index('jobs_job_type_idx').on(t.job_type),
    index('jobs_created_at_idx').on(t.created_at),
    index('jobs_correlation_id_idx').on(t.correlation_id),
  ],
);

// ── telegram_sessions ─────────────────────────────────────────────────────────

export const telegramSessions = pgTable(
  'telegram_sessions',
  {
    telegram_id: bigint('telegram_id', { mode: 'bigint' }).primaryKey(),
    state: text('state').notNull(),
    payload: jsonb('payload').default(sql`'{}'::jsonb`),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('telegram_sessions_expires_at_idx').on(t.expires_at)],
);
