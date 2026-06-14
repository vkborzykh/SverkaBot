```markdown
# SverkaBot — API Notes v2.3 (Canonical Integration Contract for Bolt AI)

This document defines the canonical API and integration contracts for the SverkaBot MVP.

**Aligned with:**
- PRD 4.2
- Tech Plan 4.2
- User Flow 2.3
- DB Draft v2.4

**Purpose:**
- Prevent API drift during Bolt AI implementation.
- Define the public and internal contracts before coding.
- Keep Telegram bot logic, backend endpoints, async jobs, storage, billing, and reporting consistent.

**Stack:**
- Next.js 14
- Drizzle ORM
- PostgreSQL
- Telegram Bot API (Telegraf)
- Bolt Storage
- Background jobs via persisted DB records
- Optional Google Sheets export

**Important:**
- All user-facing messages remain in Russian.
- API responses are JSON and may use English error codes for internal processing.
- Public contracts must remain stable unless this file is updated first.

Changes in v2.3: user identification rule for user-scoped endpoints added; `MONTH_MISMATCH` renamed to `PERIOD_MISMATCH`; empty-candidate rule made explicit (no `FAILED` runs without candidates); `progress` field removed; dedup key without period; `metrics.csv` added; `file_cleanup` and `inactivity_reminder` job types added; Google Sheets URL stored in `storage_path` (no link file); reconciliation target unified (60 s / 90 s); `LOW_CONFIDENCE` reclassified as a warning flag.

---

## Global conventions

**Base path:** `/api/*`

**Content-Type:** `application/json`

**Authentication:**
- Telegram webhook: `X-Telegram-Bot-Api-Secret-Token`
- Internal service calls: `X-Internal-Token`
- Admin endpoints: `Bearer <ADMIN_TOKEN>`

**User identification for user-scoped endpoints:** `GET /api/imports`, `GET /api/imports/:id/status`, `POST /api/reconciliation/run`, `GET /api/reconciliation/:run_id`, `GET /api/reports/:run_id`, `GET /api/history`, and `POST /api/users/delete` are internal-only: they are called by the bot layer with `X-Internal-Token` and MUST include an explicit `user_id` (UUID) query or body parameter. “Current user” always means this parameter; ownership of every referenced entity must be validated against it.

**Time:** UTC, ISO-8601 timestamps

**Money:** integer kopeks, never float

**Response envelope:**
```json
{
  "success": true,
  "data": {},
  "error": null
}
```

**Error envelope:**
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable"
  }
}
```

**Long-running operations:**
- must be handled asynchronously
- must not block the Telegram webhook
- must write status to DB and be queryable by status endpoints

---

## 1. Telegram webhook

**Endpoint:** `POST /api/telegram/webhook`

**Source:** Telegram Bot API

**Auth:** secret token header

**Responsibilities:**
- receive updates
- deduplicate updates
- route commands and callback queries
- enqueue long jobs
- respond quickly

**Request body:** standard Telegram Update object

**Response:** `{ "ok": true }`

**Rules:**
- never process the same update twice
- store the latest processed update marker in the user/session layer according to implementation constraints
- reply within 5 seconds
- any parsing, reconciliation, export, billing, and reminder work must be delegated to background jobs

---

## 2. User onboarding

**Command:** `/start`

**Behavior:**
- Identify user by `telegram_id`.
- If the user does not exist, show consent buttons.
- If the user accepts consent:
  - create user
  - create consent record
  - set `subscription_status = TRIAL`
  - set `trial_expires_at = now + 7 days`
  - open the main menu

No separate HTTP endpoint is required for onboarding; this is webhook logic.

User-facing messages are sent only through Telegram in Russian.

---

## 3. Import discovery

To support main menu selection and “latest import” behavior, the backend must expose a way to list user imports.

**Endpoint:** `GET /api/imports`

**Query parameters:**
- `user_id` (UUID, required)
- `source_type=WB|BANK`
- `status=RECEIVED|ANALYZING|PARSING|COMPLETED|FAILED`
- `limit`
- `period` (format `YYYY-MM`)

**Purpose:** let the bot fetch recent WB or bank imports, support auto-selection of the latest valid imports when the user does not explicitly choose one

**Response example:**
```json
{
  "success": true,
  "data": {
    "imports": [
      {
        "id": "uuid",
        "source_type": "WB",
        "status": "COMPLETED",
        "quality_status": "HIGH_CONFIDENCE",
        "created_at": "2025-03-15T10:30:00Z"
      }
    ]
  },
  "error": null
}
```

---

## 4. Upload Wildberries report

**Command:** `/upload_wb`

**Accepted format:** XLSX only

**Validation:**
- file size ≤ 20 MB
- extension `.xlsx`
- compute SHA-256 hash
- reject duplicates by `user_id + source_type + file_hash` (the period is not known at upload time; `period_start`/`period_end` are computed after parsing)
- access must be valid (TRIAL or ACTIVE)

**Storage:** save file in Bolt Storage, store only a reference path in DB

**DB effect:**
- create imports record
- set status to `RECEIVED`
- enqueue `parse_wb` job

**Response to Telegram flow:** user-facing Telegram message is Russian; internal API result may contain import metadata

**Example internal response:**
```json
{
  "success": true,
  "data": {
    "import_id": "uuid",
    "status": "RECEIVED"
  },
  "error": null
}
```

**Possible error codes:**
- `INVALID_FILE`
- `FILE_TOO_LARGE`
- `DUPLICATE_IMPORT`
- `ACCESS_DENIED`

---

## 5. Upload bank statement

**Command:** `/upload_bank`

**Accepted formats:** CSV, XLSX

**Validation:**
- file size ≤ 20 MB
- allowed extensions only
- compute SHA-256 hash
- reject duplicates by `user_id + source_type + file_hash` (the period is not known at upload time; `period_start`/`period_end` are computed after parsing)
- access must be valid (TRIAL or ACTIVE)

**Processing:**
- store the file in Bolt Storage
- create imports record with status `RECEIVED`
- enqueue `parse_bank` job

**Response example:**
```json
{
  "success": true,
  "data": {
    "import_id": "uuid",
    "profile_status": "MATCHED"
  },
  "error": null
}
```

**Possible profile status values:** `MATCHED`, `DRAFT`

**Possible error codes:**
- `INVALID_FORMAT`
- `FILE_TOO_LARGE`
- `DUPLICATE_IMPORT`
- `ACCESS_DENIED`
- `PROFILE_UNKNOWN` only if draft creation fails unexpectedly

**Important:**
- unknown bank templates must normally create a draft profile and continue
- low confidence is not a failure by itself

---

## 6. Import status

**Command:** `/status <import_id>`

**Endpoint:** `GET /api/imports/:id/status`

**Status values:** `RECEIVED`, `ANALYZING`, `PARSING`, `COMPLETED`, `FAILED`

**Quality values:** `HIGH_CONFIDENCE`, `LOW_CONFIDENCE`, `MANUAL_REVIEW`

**Response example:**
```json
{
  "success": true,
  "data": {
    "status": "COMPLETED",
    "quality_status": "HIGH_CONFIDENCE",
    "total_rows": 1045,
    "error_count": 4,
    "parse_success_rate": 99.62,
    "profile_confidence": 0.93,
    "profile_status": "MATCHED",
    "profile_id": "uuid"
  },
  "error": null
}
```

**Notes:**
- `COMPLETED` is the canonical finished import state
- low-confidence parsing is represented by `quality_status = LOW_CONFIDENCE`
- row-level errors do not automatically fail the import
- `MANUAL_REVIEW` is set when `parse_success_rate < 70%` (configurable); the import still completes and enters the admin review queue

---

## 7. Start reconciliation

**Command:** `/run_sync`

**Endpoint:** `POST /api/reconciliation/run`

**Request body:**
```json
{
  "wb_import_id": "uuid",
  "bank_import_id": "uuid"
}
```

**Optional behavior:**
- if import IDs are omitted in the Telegram flow, the backend may auto-select the latest eligible WB and bank imports for the user (both must be `COMPLETED`)
- the bot may also let the user choose imports via inline menu

**Validation:**
- both imports must belong to the same user
- both imports must be `COMPLETED`
- bank imports with `LOW_CONFIDENCE` may still proceed, but a warning should be surfaced to the user
- period mismatch must respect the configured date window

**DB effect:**
- create `reconciliation_runs` record with status = `PENDING`
- enqueue `reconcile` job

**Response:**
```json
{
  "success": true,
  "data": {
    "run_id": "uuid",
    "status": "PENDING"
  },
  "error": null
}
```

**Possible error codes:**
- `IMPORT_NOT_COMPLETED` (if not COMPLETED)
- `PERIOD_MISMATCH`
- `ACCESS_DENIED`
- `NO_ELIGIBLE_IMPORTS`

**Important:** `LOW_CONFIDENCE` is not a hard error; it is a warning state. Reconciliation may proceed with a warning if the bank import quality is low.

**Important:** an empty candidate set is NOT an error: the run completes with `status = COMPLETED` and all WB rows marked `UNMATCHED` (see Section 8).

---

## 8. Reconciliation status

**Command:** `/sync_status <run_id>`

**Endpoint:** `GET /api/reconciliation/:run_id`

**Running response:**
```json
{
  "success": true,
  "data": {
    "status": "RUNNING"
  },
  "error": null
}
```

**Completed response:**
```json
{
  "success": true,
  "data": {
    "status": "COMPLETED",
    "matched_count": 100,
    "unmatched_count": 3,
    "ambiguous_count": 1,
    "split_count": 2,
    "combined_count": 1,
    "match_rate": 96.15,
    "unmatched_amount": 12500,
    "ambiguous_amount": 3400,
    "failure_reason": null
  },
  "error": null
}
```

**Failed response:**
```json
{
  "success": true,
  "data": {
    "status": "FAILED",
    "failure_reason": "Internal error during matching stage"
  },
  "error": null
}
```

*Note:* `FAILED` is reserved for technical failures (job crash, storage error, etc.). An empty candidate set is not a failure: such a run completes with `COMPLETED` and all WB rows marked `UNMATCHED`.

---

## 9. Report generation and download

**Command:** `/get_report <run_id>`

**Endpoint:** `GET /api/reports/:run_id`

**Response:**
```json
{
  "success": true,
  "data": {
    "report_url": "https://bolt.storage/..."
  },
  "error": null
}
```

**Report artifacts:**
- `summary.csv`
- `matched.csv`
- `unmatched.csv`
- `ambiguous.csv`
- `wb_rows.csv`
- `bank_rows.csv`
- `evidence.csv`
- `parsing_errors.csv`
- `metrics.csv`

`SPLIT_MATCHED` / `COMBINED_MATCHED` results are included in `matched.csv` with an explicit match type column.

**Primary export:** Google Sheets-style online export when supported

**Fallback:** ZIP archive with CSV files stored in Bolt Storage

**Retry:** admin retry endpoint can regenerate the report if export fails

**Important:** the report should include match rate, ambiguous rate, and loss estimate; all report headers exposed to the user must be in Russian

---

## 10. History

**Command:** `/history`

**Endpoint:** `GET /api/history`

**Response:**
```json
{
  "success": true,
  "data": {
    "runs": [
      {
        "run_id": "uuid",
        "created_at": "2025-03-15T10:00:00Z",
        "status": "COMPLETED",
        "matched_count": 95,
        "unmatched_amount": 12300,
        "report_url": "https://..."
      }
    ]
  },
  "error": null
}
```

**Rules:**
- return the latest 10 runs
- latest first
- only runs belonging to the current user

---

## 11. Subscription management

**Command:** `/subscribe`

**Endpoint:** `POST /api/billing/create-payment`

**Request:** user inferred from Telegram identity; no extra payload required for the standard flow

**Response:**
```json
{
  "success": true,
  "data": {
    "payment_url": "https://payment.provider.com/..."
  },
  "error": null
}
```

**Possible error codes:**
- `SUBSCRIPTION_ALREADY_ACTIVE`
- `PAYMENT_FAILED`
- `PAYMENT_TIMEOUT`

**Billing webhook:** `POST /api/billing/webhook`

**Behavior:**
- validate provider signature
- create or update `billing_transactions`
- on success:
  - set `subscription_status = ACTIVE`
  - set `subscription_end_date = now + 30 days`

**Reminder jobs:**
- 3 days before expiry: send renewal reminder
- if no reconciliation has been completed for 30 days while active: send inactivity reminder

---

## 12. Delete user data

**Command:** `/delete_my_data`

**Endpoint:** `POST /api/users/delete`

**Behavior:**
- confirm deletion in Telegram first
- delete physical files and report artifacts from Bolt Storage (directly or via a `file_cleanup` job)
- hard-delete `canonical_transactions` of the user's imports
- hard-delete `reconciliation_runs` (cascade removes candidates, matches, match items, evidence, and report records)
- soft-delete imports
- anonymize the user record (set `deleted_at`, clear PII, set `user_id` to NULL in `audit_events`)
- keep audit events for compliance (with `user_id = NULL`)
- do not expose raw financial data in the response

**Response:**
```json
{
  "success": true,
  "data": {
    "deleted": true
  },
  "error": null
}
```

**Important:**
- audit events must remain available
- user-linked sensitive files must be removed from storage
- database history should preserve only what is required for compliance and operational integrity

---

## 13. Loss calculator (bot command – no HTTP endpoint)

**Command:** `/loss_calculator`

This is a Telegram bot command only. It does not have an HTTP endpoint.

**Flow:**
- bot asks for monthly Wildberries turnover
- user sends a number
- backend calculates the estimate (within the bot handler, not via REST API)

**Formula:**
```
monthly_loss = turnover × 0.04
yearly_loss = monthly_loss × 12
```

**Internal calculation result (not exposed as HTTP API):**
```json
{
  "monthly_loss": 20000,
  "yearly_loss": 240000
}
```

This feature is informational only and does not affect access.

---

## 14. Admin endpoints

**Auth:** `Bearer <ADMIN_TOKEN>`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/metrics` | Funnel, import quality, reconciliation quality, monetization |
| GET | `/api/admin/profiles` | List statement profiles with stats |
| POST | `/api/admin/profiles/:id/activate` | Set profile status to ACTIVE |
| POST | `/api/admin/profiles/:id/deprecate` | Set profile status to DEPRECATED |
| POST | `/api/admin/reports/:run_id/retry` | Regenerate report |
| GET | `/api/admin/parsing-errors` | View recent parsing errors with limited raw fragments (truncated, last 30 days) |

**Example metrics response:**
```json
{
  "success": true,
  "data": {
    "funnel": {
      "registrations": 120,
      "consents": 115,
      "uploads": 98,
      "reconciliations": 72
    },
    "import_quality": {
      "parse_success_rate_avg": 94.5,
      "low_confidence_rate": 8.2
    },
    "reconciliation_quality": {
      "match_rate_avg": 87.3,
      "ambiguous_rate": 6.1
    },
    "monetization": {
      "trial_to_paid_conversion": 12.5,
      "repeat_reconciliation_rate": 34.0
    }
  },
  "error": null
}
```

Admin messages in Telegram must be in Russian.

---

## 15. Background jobs

**Queue table:** `jobs`

**Job types:**
- `parse_wb`
- `parse_bank`
- `reconcile`
- `report_export`
- `subscription_reminder`
- `inactivity_reminder`
- `file_cleanup`

**Lifecycle:** `PENDING` → `RUNNING` → `DONE` / `FAILED`

**Retries:** max 3, exponential backoff

**Job payload example:**
```json
{
  "run_id": "uuid",
  "wb_import_id": "uuid",
  "bank_import_id": "uuid"
}
```

**Job consumer:**
- polls jobs table for `PENDING`
- processes work asynchronously
- updates status and error fields
- must be idempotent where possible

---

## 16. Storage contract

**Provider:** Bolt Storage or S3-compatible storage

**Rules:**
- store only references in DB
- never store file binary in PostgreSQL
- delete physical files when user data deletion is confirmed or when the related import/report is soft-deleted according to retention rules (scheduled background job)

**Path conventions:**
- `imports/{user_id}/{file_hash}.{ext}`
- `reports/{run_id}/report.zip`

For `export_type = 'GOOGLE_SHEETS'`, `reports.storage_path` contains the report URL itself; no separate link file is stored.

---

## 17. Internal service interfaces

These are module boundaries, not HTTP endpoints.

```typescript
function parseWBFile(fileBuffer: Buffer, importId: string): Promise<ParseResult>;
function parseBankFile(fileBuffer: Buffer, importId: string, profileId?: string): Promise<ParseResult>;

function detectProfile(fileBuffer: Buffer): Promise<ProfileMatchResult>;
function createDraftProfile(fileBuffer: Buffer, detectedStructure: unknown): Promise<string>;

function generateCandidates(runId: string): Promise<number>;
function scoreCandidates(runId: string): Promise<void>;
function globalMatch(runId: string): Promise<MatchStats>;

function generateReport(runId: string): Promise<ReportArtifact>;
function exportToGoogleSheets(runId: string): Promise<string>;
function exportToZip(runId: string): Promise<string>;

function activateSubscription(userId: string, durationDays: number): Promise<void>;
function expireSubscription(userId: string): Promise<void>;
```

---

## 18. Reliability and performance targets

| Operation | Target |
|-----------|--------|
| Telegram webhook response | ≤ 5 sec |
| Import processing (10k rows) | ≤ 30 sec |
| Reconciliation | target ≤ 60 sec, hard limit 90 sec |
| Report generation | ≤ 30 sec |
| Admin metrics | ≤ 2 sec |

**Rules:**
- all long operations must use background jobs
- the webhook must remain lightweight
- API endpoints must be deterministic and retry-safe where possible

---

## 19. Error codes summary

| Code | Meaning |
|------|---------|
| `INVALID_FILE` | Unsupported format or corrupted file |
| `FILE_TOO_LARGE` | File exceeds 20 MB |
| `DUPLICATE_IMPORT` | Same file already imported for the same user/period |
| `ACCESS_DENIED` | Subscription expired or missing |
| `PROFILE_UNKNOWN` | No matching statement profile and draft creation failed |
| `IMPORT_NOT_COMPLETED` | Import not in `COMPLETED` state |
| `PERIOD_MISMATCH` | WB and bank periods do not overlap within the configured date window |
| `PAYMENT_FAILED` | Payment provider returned an error |
| `PAYMENT_TIMEOUT` | Payment webhook was not received in time |
| `INVALID_FORMAT` | Unsupported or corrupted bank file |
| `NO_ELIGIBLE_IMPORTS` | No valid WB and bank imports available for auto-selection |
| `SUBSCRIPTION_ALREADY_ACTIVE` | User already has an active subscription |

**Warning flags (not errors, never returned in the error envelope):** `LOW_CONFIDENCE` — parsing quality below threshold; surfaced via `quality_status` in import status responses.

---

## Final implementation rule

Treat this document as the canonical API contract.

Implementation may add internal helper endpoints, but public contracts must remain compatible.

Do not redesign flows without updating this document first.

**End of API Notes v2.3**
```