# SverkaBot — Database Draft v4.1

This document supersedes DB Draft v4.0 and defines the canonical PostgreSQL schema for SverkaBot.

Aligned with: PRD 6.1, Tech Plan 6.1, API Notes 3.1, User Flow 3.2, Security Spec v1.1

Purpose: serve as the single source of truth for persistence, relationships, constraints, retention, and cascade behavior.

## 1. Data model principles

- PostgreSQL is the database.
- UUID primary keys.
- UTC timestamptz for timestamps.
- Money stored as bigint kopeks.
- Files stored externally in Supabase Storage.
- Canonical transactions are the normalized source of truth.
- Derived reconciliation data is generated from canonical transactions.
- Audit records are retained indefinitely.
- User-facing data is ownership-protected.

## 2. Enumerations

### subscription_status
```text
TRIAL
ACTIVE
EXPIRED
```

### source_type
```text
WB
BANK
```

### marketplace
```text
WB
OZON
YANDEX
MEGAMARKET
```

### import_status
```text
RECEIVED
PARSING
COMPLETED
FAILED
CANCELLED
```

### quality_status
```text
NORMAL
LOW_CONFIDENCE
MANUAL_REVIEW
```

### profile_status
```text
DRAFT
ACTIVE
DEPRECATED
```

### reconciliation_status
```text
PENDING
RUNNING
COMPLETED
FAILED
CANCELLED
```

### match_type
```text
MATCHED
UNMATCHED
AMBIGUOUS
SPLIT_MATCHED
COMBINED_MATCHED
```

### report_type
```text
HTML
GOOGLE_SHEETS
```

### job_status
```text
PENDING
RUNNING
DONE
FAILED
CANCELLED
```

### job_type
```text
PARSE_WB
PARSE_BANK
RECONCILE
GENERATE_HTML_REPORT
GENERATE_GOOGLE_SHEET
FILE_CLEANUP
SUBSCRIPTION_REMINDER
INACTIVITY_REMINDER
ADMIN_ALERT
```

### payment_provider
```text
YOOKASSA
```

### billing_status
```text
PENDING
SUCCEEDED
FAILED
REFUNDED
CANCELLED
```

## 3. users

```text
id UUID PK
telegram_id BIGINT UNIQUE NOT NULL
username TEXT
first_name TEXT
last_name TEXT
subscription_status subscription_status NOT NULL
trial_started_at TIMESTAMPTZ
trial_ends_at TIMESTAMPTZ
subscription_end_date TIMESTAMPTZ
has_used_trial BOOLEAN NOT NULL DEFAULT FALSE
created_at TIMESTAMPTZ NOT NULL
updated_at TIMESTAMPTZ NOT NULL
deleted_at TIMESTAMPTZ
```

Indexes:
- telegram_id unique
- subscription_status
- subscription_end_date
- has_used_trial

Rules:
- `has_used_trial` never resets.
- deleted users are anonymized, not hard-deleted.
- only one logical user row per Telegram ID.

## 4. consents

```text
id UUID PK
user_id UUID FK users(id) ON DELETE RESTRICT
consent_version TEXT NOT NULL
privacy_policy_version TEXT NOT NULL
accepted_at TIMESTAMPTZ NOT NULL
ip_address TEXT
user_agent TEXT
```

Consent records are immutable and retained indefinitely.

## 5. subscriptions

```text
id UUID PK
user_id UUID FK users(id) ON DELETE RESTRICT
status subscription_status NOT NULL
started_at TIMESTAMPTZ
expires_at TIMESTAMPTZ
created_at TIMESTAMPTZ NOT NULL
updated_at TIMESTAMPTZ NOT NULL
```

A user may have many subscriptions historically, but only one active subscription at a time.

## 6. billing_transactions

```text
id UUID PK
user_id UUID FK users(id) ON DELETE RESTRICT
provider payment_provider NOT NULL
provider_payment_id TEXT UNIQUE NOT NULL
status billing_status NOT NULL
amount_kopeks BIGINT NOT NULL
currency TEXT NOT NULL
subscription_id UUID FK subscriptions(id) ON DELETE SET NULL
created_at TIMESTAMPTZ NOT NULL
updated_at TIMESTAMPTZ NOT NULL
```

## 7. payment_events

```text
id UUID PK
billing_transaction_id UUID FK billing_transactions(id) ON DELETE RESTRICT
provider payment_provider NOT NULL
event_type TEXT NOT NULL
payload JSONB NOT NULL
received_at TIMESTAMPTZ NOT NULL
```

Payment events are retained indefinitely.

## 8. statement_profiles

```text
id UUID PK
display_name TEXT NOT NULL
status profile_status NOT NULL
marketplace marketplace NOT NULL DEFAULT 'WB'
confidence_score NUMERIC(5,2)
usage_count INTEGER NOT NULL DEFAULT 0
success_count INTEGER NOT NULL DEFAULT 0
failure_count INTEGER NOT NULL DEFAULT 0
created_at TIMESTAMPTZ NOT NULL
updated_at TIMESTAMPTZ NOT NULL
```

## 9. statement_profile_signatures

```text
id UUID PK
profile_id UUID FK statement_profiles(id) ON DELETE CASCADE
signature_hash TEXT NOT NULL
header_fingerprint TEXT
sample_columns JSONB
created_at TIMESTAMPTZ NOT NULL
```

Used for matching statement templates.

## 10. imports

```text
id UUID PK
user_id UUID FK users(id) ON DELETE RESTRICT
source_type source_type NOT NULL
marketplace marketplace
status import_status NOT NULL
quality_status quality_status NOT NULL DEFAULT 'NORMAL'
file_name TEXT NOT NULL
file_hash TEXT NOT NULL
storage_path TEXT NOT NULL
file_size_bytes BIGINT NOT NULL
period_start DATE
period_end DATE
parse_success_rate NUMERIC(5,2)
error_count INTEGER NOT NULL DEFAULT 0
delimiter TEXT
profile_id UUID FK statement_profiles(id) ON DELETE SET NULL
created_at TIMESTAMPTZ NOT NULL
updated_at TIMESTAMPTZ NOT NULL
deleted_at TIMESTAMPTZ
```

Unique constraint:
```text
(user_id, source_type, file_hash)
```

Rules:
- `source_type = WB` or `BANK`.
- `marketplace` is typically `WB` for WB uploads and NULL for bank statements.
- `PARSING` is the active processing status.
- quality status is separate from import status.

## 11. parsing_errors

```text
id UUID PK
import_id UUID FK imports(id) ON DELETE CASCADE
row_number INTEGER
error_code TEXT NOT NULL
error_message TEXT NOT NULL
debug_fragment TEXT
created_at TIMESTAMPTZ NOT NULL
```

Retention: 30 days raw retention.

## 12. canonical_transactions

```text
id UUID PK
import_id UUID FK imports(id) ON DELETE CASCADE
source_type source_type NOT NULL
marketplace marketplace
transaction_date TIMESTAMPTZ NOT NULL
amount_kopeks BIGINT NOT NULL
currency TEXT NOT NULL
direction TEXT NOT NULL
reference TEXT
description TEXT
counterparty TEXT
external_id TEXT
row_hash TEXT NOT NULL
source_row_number INTEGER
raw_payload JSONB
created_at TIMESTAMPTZ NOT NULL
```

Indexes:
- import_id
- transaction_date
- amount_kopeks
- row_hash
- reference

Rules:
- immutable after insertion
- `row_hash` supports deduplication inside imports
- used by reconciliation engine as source of truth

## 13. reconciliation_runs

```text
id UUID PK
user_id UUID FK users(id) ON DELETE RESTRICT
wb_import_id UUID FK imports(id) ON DELETE RESTRICT
bank_import_id UUID FK imports(id) ON DELETE RESTRICT
status reconciliation_status NOT NULL
matched_count INTEGER NOT NULL DEFAULT 0
unmatched_count INTEGER NOT NULL DEFAULT 0
ambiguous_count INTEGER NOT NULL DEFAULT 0
split_count INTEGER NOT NULL DEFAULT 0
combined_count INTEGER NOT NULL DEFAULT 0
turnover_kopeks BIGINT NOT NULL DEFAULT 0
unmatched_amount_kopeks BIGINT NOT NULL DEFAULT 0
ambiguous_amount_kopeks BIGINT NOT NULL DEFAULT 0
loss_kopeks BIGINT NOT NULL DEFAULT 0
loss_percent NUMERIC(8,4)
started_at TIMESTAMPTZ
completed_at TIMESTAMPTZ
created_at TIMESTAMPTZ NOT NULL
updated_at TIMESTAMPTZ NOT NULL
failure_reason TEXT
```

Rules:
- `loss_kopeks` means unreconciled payout amount.
- `loss_percent` is computed only when `loss_kopeks > 0`.
- empty candidate sets are valid completions.

## 14. reconciliation_matches

```text
id UUID PK
run_id UUID FK reconciliation_runs(id) ON DELETE CASCADE
match_type match_type NOT NULL
score NUMERIC(8,4)
reason_code TEXT
created_at TIMESTAMPTZ NOT NULL
```

## 15. reconciliation_match_items

```text
id UUID PK
match_id UUID FK reconciliation_matches(id) ON DELETE CASCADE
transaction_id UUID FK canonical_transactions(id) ON DELETE CASCADE
side TEXT NOT NULL
created_at TIMESTAMPTZ NOT NULL
```

`side` values:
- `WB`
- `BANK`

## 16. reconciliation_evidence

```text
id UUID PK
match_id UUID FK reconciliation_matches(id) ON DELETE CASCADE
amount_score NUMERIC(8,4)
date_score NUMERIC(8,4)
reference_score NUMERIC(8,4)
description_score NUMERIC(8,4)
counterparty_score NUMERIC(8,4)
penalties JSONB
decision_payload JSONB
created_at TIMESTAMPTZ NOT NULL
```

## 17. reports

```text
id UUID PK
run_id UUID FK reconciliation_runs(id) ON DELETE CASCADE
report_type report_type NOT NULL
storage_path TEXT
external_url TEXT
generated_at TIMESTAMPTZ NOT NULL
expires_at TIMESTAMPTZ
```

Rules:
- `HTML` uses `storage_path` and no `external_url`.
- `GOOGLE_SHEETS` uses `external_url` and may have no storage path.
- report access is ownership-validated and may be delivered through signed or protected links.

Retention: 180 days.

## 18. jobs

```text
id UUID PK
job_type job_type NOT NULL
status job_status NOT NULL
entity_type TEXT NOT NULL
entity_id UUID
progress INTEGER NOT NULL DEFAULT 0
attempts INTEGER NOT NULL DEFAULT 0
max_attempts INTEGER NOT NULL DEFAULT 3
worker_id TEXT
last_error TEXT
started_at TIMESTAMPTZ
completed_at TIMESTAMPTZ
created_at TIMESTAMPTZ NOT NULL
updated_at TIMESTAMPTZ NOT NULL
```

Source of truth for progress and operational state is the database, not Redis.

## 19. audit_events

```text
id UUID PK
user_id UUID FK users(id) ON DELETE SET NULL
event_type TEXT NOT NULL
entity_type TEXT
entity_id UUID
payload JSONB
created_at TIMESTAMPTZ NOT NULL
```

Audit events are retained indefinitely.

## 20. admin_notifications

```text
id UUID PK
severity TEXT NOT NULL
title TEXT NOT NULL
message TEXT NOT NULL
resolved BOOLEAN NOT NULL DEFAULT FALSE
created_at TIMESTAMPTZ NOT NULL
```

Used for worker failures, threshold breaches, and other critical alerts.

## 21. system_settings

```text
key TEXT PRIMARY KEY
value TEXT NOT NULL
updated_at TIMESTAMPTZ NOT NULL
```

Examples:
- `date_window_days`
- `manual_review_threshold`
- `admin_error_threshold_percent`
- `admin_error_window_minutes`
- `file_retention_days`
- `report_retention_days`
- `parsing_error_retention_days`
- `max_cluster_size`

## 22. Index strategy

Mandatory indexes:
- users.telegram_id unique
- imports.user_id
- imports.status
- imports.source_type
- imports.marketplace
- imports.created_at
- canonical_transactions.import_id
- canonical_transactions.transaction_date
- canonical_transactions.amount_kopeks
- canonical_transactions.row_hash
- reconciliation_runs.user_id
- reconciliation_runs.status
- jobs.status
- jobs.job_type
- billing_transactions.provider_payment_id unique
- reports.run_id

## 23. Cascade rules

Allowed cascades:
- reconciliation_runs -> reconciliation_matches
- reconciliation_matches -> reconciliation_match_items
- reconciliation_matches -> reconciliation_evidence
- imports -> canonical_transactions
- imports -> parsing_errors
- statement_profiles -> statement_profile_signatures

User deletion is orchestrated explicitly and must not rely on hidden blanket cascades.

## 24. Row-level security strategy

All user-facing access must be ownership-validated.
Users may only access:
- their imports
- their runs
- their reports
- their billing state
- their stats

Admins may bypass via service role in trusted backend code only.

## 25. Storage layout

Supabase Storage paths:
- `imports/{user_id}/{file_hash}.{ext}`
- `reports/{user_id}/{run_id}/report.html`

Reports are private and must be accessed through ownership validation or signed delivery.

## 26. Retention policy

- imported files: 90 days
- reports: 180 days
- parsing errors: 30 days raw retention
- audit events: indefinite
- payment events: indefinite
- canonical transactions: deleted with imports or user deletion

## 27. Migration notes from MVP

Migration sequence:
1. add new enums and fields;
2. backfill subscriptions and jobs;
3. introduce `marketplace` while keeping `source_type`;
4. switch imports to `PARSING` and quality separation;
5. migrate report generation to HTML;
6. keep Google Sheets optional;
7. remove ZIP assumptions;
8. preserve history and audit trails.

End of DB Draft v4.1.
