```markdown
# SverkaBot — Database Draft v2.4 (Canonical Schema for Bolt AI)

This document defines the canonical database schema for SverkaBot MVP.

**Aligned with:** PRD 4.2, Tech Plan 4.2, User Flow 2.3, API Notes 2.3

**Purpose:**
- Serve as the single source of truth for all persistence logic.
- Prevent schema drift during Bolt AI implementation.
- Generate Drizzle ORM schema, migrations, types, and repository layer.

**Database:** PostgreSQL  
**ORM:** Drizzle ORM  
**Primary keys:** UUID (`gen_random_uuid()`)  
**Timestamps:** UTC (`timestamptz`)  
**Money:** integer kopeks (`bigint`) — never float  
**Files:** stored externally (Bolt Storage)

**Changes in v2.4:** fixed `users` CHECK for the TRIAL → EXPIRED transition; removed circular FK `reconciliation_runs.report_id` (primary report is now `reports.is_primary`); dedup key no longer includes `period_start`; added `statement_profiles.display_name`, `imports.profile_confidence`, `reconciliation_runs.updated_at`, `reports.is_primary`; deletion policy extended with `canonical_transactions` and `reconciliation_runs` plus an explicit `/delete_my_data` sequence; added quality-threshold settings.

---

## Global conventions

- `created_at` defaults to `now()`
- `updated_at` auto‑updates on row change
- `deleted_at` nullable — used for soft delete where required
- Cascade delete allowed **only for derived system data** (e.g., candidates, evidence, match items).  
  User‑originated entities (users, imports) are never hard‑deleted automatically.

---

## ENUMS

```sql
-- subscription_status_enum
TRIAL, ACTIVE, EXPIRED   -- ARCHIVED removed for MVP

-- import_source_enum
WB, BANK

-- import_status_enum
RECEIVED, ANALYZING, PARSING, COMPLETED, FAILED   -- READY replaced with COMPLETED

-- quality_status_enum
HIGH_CONFIDENCE, LOW_CONFIDENCE, MANUAL_REVIEW

-- profile_status_enum
ACTIVE, DRAFT, DEPRECATED

-- file_type_enum
CSV, XLSX

-- transaction_direction_enum
IN, OUT

-- reconciliation_status_enum
PENDING, RUNNING, COMPLETED, FAILED

-- match_type_enum
MATCHED, UNMATCHED, AMBIGUOUS, SPLIT_MATCHED, COMBINED_MATCHED

-- report_type_enum
ZIP, GOOGLE_SHEETS

-- payment_status_enum
PENDING, SUCCESS, FAILED

-- job_status_enum
PENDING, RUNNING, DONE, FAILED
```

---

## TABLE: users

Stores Telegram users and access state.

```sql
id                 UUID PK
telegram_id        BIGINT UNIQUE
username           TEXT
consent_given_at   TIMESTAMPTZ
trial_expires_at   TIMESTAMPTZ
subscription_status subscription_status_enum
subscription_end_date TIMESTAMPTZ
last_update_id     BIGINT                -- for webhook idempotency
created_at         TIMESTAMPTZ
updated_at         TIMESTAMPTZ
deleted_at         TIMESTAMPTZ
```

**Indexes:** `telegram_id` (unique), `subscription_status`, `subscription_end_date`  
**Check:** `subscription_end_date >= created_at`;  
`(subscription_status = 'TRIAL' AND trial_expires_at IS NOT NULL) OR (subscription_status = 'ACTIVE' AND subscription_end_date IS NOT NULL) OR (subscription_status = 'EXPIRED' AND (trial_expires_at IS NOT NULL OR subscription_end_date IS NOT NULL))`  
**Deletion:** anonymize only – never hard delete
**Note:** a trial that expires without payment transitions to `EXPIRED` with `subscription_end_date = NULL` — the CHECK above allows this.

---

## TABLE: consents

Stores consent acceptance history.

```sql
id               UUID PK
user_id          UUID REFERENCES users(id) ON DELETE RESTRICT
consent_version  TEXT
accepted_at      TIMESTAMPTZ
```

**Indexes:** `user_id`

---

## TABLE: statement_profiles

Reusable bank statement parsing profiles.

```sql
id                 UUID PK
profile_key        TEXT UNIQUE
display_name       TEXT                  -- human-readable profile/bank name for bot messages and history
bank_name_pattern  TEXT
file_type          file_type_enum
status             profile_status_enum
version            INTEGER
signature          TEXT
header_row_index   INTEGER
column_mapping     JSONB
date_format        TEXT
amount_format      TEXT
usage_count        INTEGER DEFAULT 0
success_rate       DECIMAL(5,2)
config_json        JSONB
created_by         UUID REFERENCES users(id) ON DELETE SET NULL
created_at         TIMESTAMPTZ
updated_at         TIMESTAMPTZ
deleted_at         TIMESTAMPTZ
```

**Indexes:** `profile_key` (unique), `status`, `signature`  
**Check:** `success_rate BETWEEN 0 AND 100`

---

## TABLE: imports

Represents one uploaded file (Wildberries report or bank statement).

```sql
id                  UUID PK
user_id             UUID REFERENCES users(id) ON DELETE RESTRICT
source_type         import_source_enum
storage_path        TEXT
original_filename   TEXT
file_hash           TEXT
file_size_bytes     BIGINT
period_start        DATE
period_end          DATE
status              import_status_enum          -- RECEIVED, ANALYZING, PARSING, COMPLETED, FAILED
quality_status      quality_status_enum         -- HIGH_CONFIDENCE, LOW_CONFIDENCE, MANUAL_REVIEW
profile_id          UUID REFERENCES statement_profiles(id) ON DELETE SET NULL
profile_status      TEXT                         -- 'MATCHED' or 'DRAFT' (free text for simplicity)
parser_version      TEXT                         -- e.g. 'wb_v1', 'bank_v3'
profile_confidence  DECIMAL(5,4)                 -- profile match/creation confidence, 0–1 (NULL for WB imports)
parse_success_rate  DECIMAL(5,2)
error_count         INTEGER
created_at          TIMESTAMPTZ
updated_at          TIMESTAMPTZ
deleted_at          TIMESTAMPTZ
```

**Indexes:** `user_id`, `source_type`, `status`, `created_at`, `file_hash`  
**Check:** `parse_success_rate BETWEEN 0 AND 100`, `profile_confidence BETWEEN 0 AND 1`  
**Deduplication (application level):** `(user_id, source_type, file_hash)` — checked at upload time.
**Periods:** `period_start` / `period_end` are computed after parsing as min/max `transaction_date` and drive the period overlap check before reconciliation.

---

## TABLE: parsing_errors

Row‑level parsing errors (does not fail the whole import).

```sql
id              UUID PK
import_id       UUID REFERENCES imports(id) ON DELETE CASCADE
row_number      INTEGER
error_code      TEXT
error_message   TEXT
raw_fragment    TEXT                     -- truncated after 30 days
created_at      TIMESTAMPTZ
```

**Indexes:** `import_id`, `error_code`

---

## TABLE: canonical_transactions

Normalised transactions from both WB and bank sources.

```sql
id                 UUID PK
import_id          UUID REFERENCES imports(id) ON DELETE CASCADE
source_type        import_source_enum
row_number         INTEGER
transaction_date   TIMESTAMPTZ
amount_kopeks      BIGINT
currency           TEXT
direction          transaction_direction_enum
reference          TEXT
description        TEXT
counterparty       TEXT
row_hash           TEXT                   -- for deduplication
raw_payload        JSONB                  -- debug only, never exposed to user
created_at         TIMESTAMPTZ
```

**Indexes:** `import_id`, `transaction_date`, `amount_kopeks`, `direction`, `row_hash`  
**Check:** `amount_kopeks != 0`

---

## TABLE: reconciliation_runs

One reconciliation session between a WB import and a bank import.

```sql
id                 UUID PK
user_id            UUID REFERENCES users(id) ON DELETE RESTRICT
wb_import_id       UUID REFERENCES imports(id) ON DELETE RESTRICT
bank_import_id     UUID REFERENCES imports(id) ON DELETE RESTRICT
status             reconciliation_status_enum
failure_reason     TEXT
total_wb_rows      INTEGER
total_bank_rows    INTEGER
matched_count      INTEGER
unmatched_count    INTEGER
ambiguous_count    INTEGER
split_count        INTEGER
combined_count     INTEGER
match_rate         DECIMAL(5,2)
unmatched_amount   BIGINT
ambiguous_amount   BIGINT
started_at         TIMESTAMPTZ
completed_at       TIMESTAMPTZ
created_at         TIMESTAMPTZ
updated_at         TIMESTAMPTZ
```

**Indexes:** `user_id`, `status`, `started_at`  
**Checks:** `match_rate BETWEEN 0 AND 100`, `completed_at >= started_at`

---

## TABLE: reconciliation_candidates

All candidate pairs (WB–bank) considered during matching.

```sql
id             UUID PK
run_id         UUID REFERENCES reconciliation_runs(id) ON DELETE CASCADE
wb_tx_id       UUID REFERENCES canonical_transactions(id) ON DELETE CASCADE
bank_tx_id     UUID REFERENCES canonical_transactions(id) ON DELETE CASCADE
score          DECIMAL(5,4)
reason_codes   JSONB
created_at     TIMESTAMPTZ
```

**Indexes:** `run_id`, `score`, `wb_tx_id`, `bank_tx_id`  
**Unique:** `(run_id, wb_tx_id, bank_tx_id)`

---

## TABLE: reconciliation_matches

Final reconciliation decision (per match group).

```sql
id           UUID PK
run_id       UUID REFERENCES reconciliation_runs(id) ON DELETE CASCADE
match_type   match_type_enum
final_score  DECIMAL(5,4)
created_at   TIMESTAMPTZ
```

**Indexes:** `run_id`, `match_type`

---

## TABLE: reconciliation_match_items

Links transactions to a match (supports 1:1, 1:N, N:1).

```sql
id               UUID PK
match_id         UUID REFERENCES reconciliation_matches(id) ON DELETE CASCADE
transaction_id   UUID REFERENCES canonical_transactions(id) ON DELETE CASCADE
side             import_source_enum      -- WB or BANK
created_at       TIMESTAMPTZ
```

**Indexes:** `match_id`, `transaction_id`

**Examples:**
- `MATCHED` → 1 row with side=WB + 1 row with side=BANK
- `SPLIT_MATCHED` → 1 row side=WB + 3 rows side=BANK
- `COMBINED_MATCHED` → 2 rows side=WB + 1 row side=BANK

---

## TABLE: reconciliation_evidence

Detailed scoring evidence for each match.

```sql
id                  UUID PK
match_id            UUID REFERENCES reconciliation_matches(id) ON DELETE CASCADE
amount_score        DECIMAL(5,4)
date_score          DECIMAL(5,4)
reference_score     DECIMAL(5,4)
description_score   DECIMAL(5,4)
counterparty_score  DECIMAL(5,4)
penalties           JSONB
created_at          TIMESTAMPTZ
```

**Indexes:** `match_id`

---

## TABLE: reports

Stored export artifacts.

```sql
id              UUID PK
run_id          UUID REFERENCES reconciliation_runs(id) ON DELETE CASCADE
storage_path    TEXT
export_type     report_type_enum
report_version  INTEGER
is_primary      BOOLEAN DEFAULT TRUE     -- primary report of the run (latest successful version)
created_at      TIMESTAMPTZ
deleted_at      TIMESTAMPTZ
```

**Indexes:** `run_id`
**Note:** for `export_type = 'GOOGLE_SHEETS'`, `storage_path` contains the report URL itself; no separate link file is stored.

---

## TABLE: billing_transactions

Payment records.

```sql
id              UUID PK
user_id         UUID REFERENCES users(id) ON DELETE RESTRICT
amount_kopeks   BIGINT
currency        TEXT
status          payment_status_enum
provider        TEXT
provider_tx_id  TEXT
created_at      TIMESTAMPTZ
updated_at      TIMESTAMPTZ
```

**Indexes:** `user_id`, `status`

---

## TABLE: settings

Runtime configuration (key‑value).

```sql
id           UUID PK
key          TEXT UNIQUE
value_json   JSONB
description  TEXT
updated_at   TIMESTAMPTZ
```

**Seed data:**
```json
{ "key": "date_window_days", "value_json": 7 }
{ "key": "amount_weight", "value_json": 0.5 }
{ "key": "date_weight", "value_json": 0.3 }
{ "key": "reference_weight", "value_json": 0.1 }
{ "key": "description_weight", "value_json": 0.05 }
{ "key": "counterparty_weight", "value_json": 0.05 }
{ "key": "split_combined_max_rows", "value_json": 3 }
{ "key": "low_confidence_threshold", "value_json": 0.6 }
{ "key": "high_confidence_success_rate_threshold", "value_json": 90 }
{ "key": "manual_review_success_rate_threshold", "value_json": 70 }
```

---

## TABLE: audit_events

Log of important admin/user actions.

```sql
id           UUID PK
user_id      UUID REFERENCES users(id) ON DELETE SET NULL   -- anonymized to NULL on user deletion
event_type   TEXT
entity_type  TEXT
entity_id    UUID
old_state    JSONB
new_state    JSONB
created_at   TIMESTAMPTZ
```

**Indexes:** `user_id`, `event_type`, `created_at`

---

## TABLE: jobs

Async job queue.

```sql
id             UUID PK
job_type       TEXT
entity_id      UUID
correlation_id UUID                 -- for tracing
status         job_status_enum
retries        INTEGER
last_error     TEXT
payload        JSONB
started_at     TIMESTAMPTZ
completed_at   TIMESTAMPTZ
created_at     TIMESTAMPTZ
```

**Indexes:** `status`, `job_type`, `created_at`, `correlation_id`

---

## Relationship summary

```
users
├── consents
├── imports
├── reconciliation_runs
├── billing_transactions
└── audit_events

imports
├── parsing_errors
├── canonical_transactions
└── statement_profiles (via profile_id)

canonical_transactions
├── reconciliation_candidates (as wb_tx_id or bank_tx_id)
└── reconciliation_match_items

reconciliation_runs
├── reconciliation_candidates
├── reconciliation_matches
└── reports

reconciliation_matches
├── reconciliation_match_items
└── reconciliation_evidence
```

---

## Deletion policy

| Entity | Action |
|--------|--------|
| users | anonymize (clear PII, set deleted_at), never hard delete |
| imports | soft delete (set deleted_at), keep for audit |
| canonical_transactions | hard delete on `/delete_my_data` for all of the user's imports (soft delete of imports does not trigger cascades) |
| reconciliation_runs | hard delete on `/delete_my_data` (cascade removes candidates, matches, match_items, evidence, and report records) |
| files (Bolt Storage) | delete physical file when import is soft‑deleted (scheduled background job) |
| reports | normal retention: delete storage artifact, soft delete record; on `/delete_my_data`: records removed via run cascade, artifacts deleted from storage |
| parsing_errors | cascade on import delete |
| reconciliation_candidates | cascade on run delete |
| reconciliation_matches | cascade on run delete |
| reconciliation_match_items | cascade on match delete |
| reconciliation_evidence | cascade on match delete |
| statement_profiles | soft delete (set deleted_at), keep for history |

---

## User data deletion sequence (`/delete_my_data`)

1. Delete physical import files and report artifacts from Bolt Storage (directly or via a `file_cleanup` job).
2. Hard-delete `canonical_transactions` for all of the user's imports.
3. Hard-delete the user's `reconciliation_runs` (cascade: candidates, matches, match_items, evidence, reports).
4. Soft-delete `imports` (set `deleted_at`).
5. Anonymize the `users` record (clear PII, set `deleted_at`).
6. Set `user_id = NULL` in `audit_events`; log the deletion event.

---

## Implementation rules for Bolt AI

Treat this document as the canonical schema.

Implementation may introduce additional indexes, generated columns, or internal helper tables for performance.

Business entities and the public schema must remain compatible with this document.

Do not redesign architecture without updating this document first.

**End of DB Draft v2.4**
```