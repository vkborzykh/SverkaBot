# SverkaBot — Tech Plan v6.1

This document supersedes Tech Plan v6.0 and is the canonical implementation blueprint for the production product.

Aligned with: PRD 6.1, DB Draft v4.1, API Notes 3.1, User Flow v3.2, Security Spec v1.1

Purpose: define the implementable backend architecture, service boundaries, queue topology, data flow, storage strategy, performance strategy, observability, and release approach for SverkaBot.

## 1. Architecture goals

The system must:
- remain Telegram-first;
- process files asynchronously;
- keep parsing and reconciliation deterministic;
- support trial-abuse prevention;
- produce HTML reports as the primary export;
- support optional Google Sheets export;
- be marketplace-aware;
- avoid brute-force reconciliation at scale;
- keep all user-facing strings in Russian.

## 2. Canonical architecture

### 2.1 Service boundaries
1. Bot Gateway
2. API Service
3. Worker Service
4. Scheduler Service

### 2.2 Responsibilities
Bot Gateway:
- receive Telegram updates;
- route commands and inline callbacks;
- display Russian messages;
- upload files and ask for confirmations;
- call internal APIs.

API Service:
- provide canonical HTTP contracts;
- validate ownership;
- expose status/history/stats/report/billing/admin endpoints;
- orchestrate internal operations.

Worker Service:
- parse WB files;
- parse bank files;
- resolve profiles;
- perform reconciliation;
- generate HTML reports;
- optionally generate Google Sheets;
- run cleanup jobs;
- dispatch reminders;
- emit admin alerts.

Scheduler Service:
- create periodic jobs;
- manage reminders;
- manage retention cleanup;
- ensure time-based operations are reliable.

## 3. Infrastructure stack

- Node.js
- TypeScript
- Fastify preferred for API service
- PostgreSQL
- Drizzle ORM
- Redis
- BullMQ
- Supabase Storage
- YooKassa
- Zod
- xlsx
- Papa Parse
- date-fns
- pino
- Vitest or Jest

BullMQ is the canonical queue layer.
Redis is transport and coordination, not source of truth.

## 4. Data flow

1. User sends Telegram command.
2. Bot validates access and request semantics.
3. Bot stores or uploads file reference.
4. Bot calls API or enqueues a job.
5. Worker processes file or reconciliation task.
6. Worker writes canonical records to PostgreSQL.
7. Worker stores artifacts in Supabase Storage.
8. API returns status or report metadata.
9. Bot renders Russian user message.

## 5. Queue model

### 5.1 Canonical job types
- `PARSE_WB`
- `PARSE_BANK`
- `RECONCILE`
- `GENERATE_HTML_REPORT`
- `GENERATE_GOOGLE_SHEET`
- `FILE_CLEANUP`
- `SUBSCRIPTION_REMINDER`
- `INACTIVITY_REMINDER`
- `ADMIN_ALERT`

### 5.2 Job persistence
Every job must have a persisted record in `jobs` with:
- status
- progress
- attempts
- retry policy
- worker id
- timestamps
- error message if any

Source of truth is PostgreSQL.
Redis queue state is ephemeral.

### 5.3 Idempotency
Jobs must be idempotent.
The workers must prevent:
- duplicate imports;
- duplicate canonical transactions;
- duplicate reconciliation results;
- duplicate report creation;
- duplicate billing effects.

### 5.4 Cancellation
Jobs must check for cancellation flags at safe checkpoints.

Imports are cancellable when:
- `RECEIVED`
- `PARSING`

Reconciliation runs are cancellable when:
- `PENDING`
- `RUNNING`

### 5.5 Retry policy
Use bounded retries with backoff.
Do not retry deterministic validation failures indefinitely.

## 6. Canonical status model

### Import status
- `RECEIVED`
- `PARSING`
- `COMPLETED`
- `FAILED`
- `CANCELLED`

### Import quality status
- `NORMAL`
- `LOW_CONFIDENCE`
- `MANUAL_REVIEW`

### Reconciliation status
- `PENDING`
- `RUNNING`
- `COMPLETED`
- `FAILED`
- `CANCELLED`

### Match type
- `MATCHED`
- `UNMATCHED`
- `AMBIGUOUS`
- `SPLIT_MATCHED`
- `COMBINED_MATCHED`

### Report type
- `HTML`
- `GOOGLE_SHEETS`

### Subscription status
- `TRIAL`
- `ACTIVE`
- `EXPIRED`

### Billing status
- `PENDING`
- `SUCCEEDED`
- `FAILED`
- `REFUNDED`
- `CANCELLED`

## 7. File ingestion pipeline

### 7.1 Validation
- size ≤ 20 MB
- allowed file types: WB = XLSX; bank = XLSX or CSV
- SHA-256 hash required
- duplicates rejected by `(user_id, source_type, file_hash)`

### 7.2 Storage
Use Supabase Storage with deterministic paths:
- imports: `imports/{user_id}/{file_hash}.{ext}`
- reports: `reports/{user_id}/{run_id}/report.html`

### 7.3 WB parser
Steps:
1. open workbook;
2. detect sheet/table;
3. detect headers;
4. normalize dates and amounts;
5. create canonical transactions;
6. store malformed rows;
7. compute success rate and quality.

### 7.4 Bank parser
Steps:
1. detect format;
2. inspect rows and tables;
3. generate header candidates;
4. score candidates;
5. resolve active profile or create draft;
6. normalize rows;
7. store evidence;
8. compute confidence and quality.

### 7.5 CSV delimiter support
Autodetect among `;`, `,`, `\t`.
Allow user override through command syntax.
Store resolved delimiter in imports.

## 8. Reconciliation pipeline

### 8.1 Inputs
- completed WB import
- completed bank import
- overlapping periods
- same user ownership

### 8.2 Candidate generation
Hard filters:
- direction
- currency
- exact amount in MVP
- date window

Candidate generation must avoid O(n²) brute force. Use bucketing, indexing, or keyed lookup.

### 8.3 Scoring
Weights are settings-driven:
- amount
- date
- reference
- description
- counterparty

Penalties:
- fee
- refund
- reversal
- suspicious purpose
- internal transfer

### 8.4 Matching
Perform conflict-aware matching on connected components or equivalent graph partitions.
Prevent double-use of rows.

### 8.5 Metrics
- matched_count
- unmatched_count
- ambiguous_count
- split_count
- combined_count
- match_rate
- unmatched_amount_kopeks
- ambiguous_amount_kopeks
- turnover_kopeks
- loss_kopeks
- loss_percent

`loss_kopeks` means unreconciled payout amount, not proven financial loss.

### 8.6 Reporting trigger
After successful reconciliation, enqueue HTML report generation.
Google Sheets is optional and may be generated on request.

## 9. Reporting pipeline

### 9.1 HTML report
HTML is the primary report.
It must be:
- self-contained;
- readable in a browser;
- Russian-labeled;
- safe to deliver as a Telegram document or secure link;
- suitable for retention in storage.

### 9.2 Google Sheets
Optional read-only export.
Useful for collaboration.
Not required for every run.

### 9.3 Report access
Report access must be ownership-validated.
If a link is generated, it should be signed or otherwise access-controlled.

### 9.4 Report contents
- summary
- run metadata
- WB rows
- bank rows
- matched rows
- unmatched rows
- ambiguous groups
- evidence
- parsing errors
- claim-ready section
- metrics

## 10. Billing and subscriptions

### 10.1 Provider
YooKassa.

### 10.2 Flow
- create payment link;
- validate webhook;
- record transaction;
- activate subscription;
- extend access 30 days.

### 10.3 Trial
- 7 days
- no repeat trial after deletion
- `has_used_trial` must persist forever

## 11. Retention and cleanup

### 11.1 Retention windows
- imported files: 90 days
- reports: 180 days
- parsing errors: 30 days raw retention
- audit events: indefinite
- payment events: indefinite

### 11.2 Cleanup job
FILE_CLEANUP must:
- delete expired storage objects;
- update DB state;
- preserve audit trails;
- avoid deleting unrelated data.

## 12. Security and observability

### 12.1 Security
- validate webhook secrets;
- validate payment webhook signatures;
- validate ownership on all user-scoped entities;
- never log raw bank rows or secrets;
- keep admin access restricted.

### 12.2 Observability
- structured JSON logging;
- correlation IDs;
- metrics for funnel, import quality, reconciliation quality, billing, queue health;
- alerts for worker failures and threshold breaches.

### 12.3 Health checks
- API health endpoint
- worker heartbeats
- queue depth monitoring

## 13. Configuration specification

Canonical environment variables:
- `DATABASE_URL`
- `REDIS_URL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_STORAGE_BUCKET`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `ADMIN_TELEGRAM_IDS`
- `YOOKASSA_SHOP_ID`
- `YOOKASSA_SECRET_KEY`
- `YOOKASSA_RETURN_URL`
- `GOOGLE_SERVICE_ACCOUNT_JSON`
- `GOOGLE_SHEETS_FOLDER_ID`
- `CRON_SECRET`
- `APP_BASE_URL`
- `DATE_WINDOW_DAYS`
- `MANUAL_REVIEW_THRESHOLD`
- `ADMIN_ERROR_THRESHOLD_PERCENT`
- `ADMIN_ERROR_WINDOW_MINUTES`
- `FILE_RETENTION_DAYS`
- `REPORT_RETENTION_DAYS`
- `PARSING_ERROR_RETENTION_DAYS`
- `JOB_RETRY_LIMIT`

## 14. Release and migration

### 14.1 Environments
- local
- staging
- production

### 14.2 Migration path from MVP
1. add new schema fields;
2. backfill subscriptions and jobs;
3. introduce `marketplace` while keeping `source_type`;
4. switch imports to `PARSING` and quality separation;
5. migrate report generation to HTML;
6. keep Google Sheets optional;
7. remove ZIP assumptions and legacy calculator references.

### 14.3 Versioning
Use semantic versioning for docs and releases.
Breaking changes require coordinated updates across PRD, Tech Plan, DB Draft, API Notes, and User Flow.

## 15. Performance targets

| Operation | Target |
|---|---:|
| Webhook acknowledgement | ≤ 5 sec |
| Typical import | ≤ 30 sec |
| Typical reconciliation | ≤ 60 sec |
| Maximum reconciliation | ≤ 90 sec hard limit |
| HTML report generation | ≤ 30 sec |
| Status/history/stats | ≤ 1 sec |
| Admin metrics | ≤ 2 sec |

## 16. Implementation principles

1. Keep business logic deterministic.
2. Keep row-level errors isolated.
3. Keep user-facing text Russian.
4. Keep source type separate from marketplace.
5. Keep report contract HTML-first.
6. Keep retry and cancel semantics strict.
7. Keep retention explicit.
8. Keep security first-class.

End of Tech Plan v6.1.
