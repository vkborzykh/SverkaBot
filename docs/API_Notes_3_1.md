# SverkaBot — API Notes v3.1

This document supersedes API Notes v3.0 and defines the canonical HTTP contracts, internal API behavior, error catalog, and integration rules for the production system.

Aligned with: PRD 6.1, Tech Plan 6.1, DB Draft v4.1, User Flow v3.2, Security Spec v1.1

## 1. API principles

1. All user-facing text is Russian and rendered by the bot layer.
2. API field names and error codes are English and machine-readable.
3. Ownership checks are mandatory for all user-scoped data.
4. Long-running work is asynchronous.
5. PostgreSQL is the source of truth for lifecycle state and progress.
6. Redis is queue transport only.
7. `MANUAL_REVIEW` is a quality status only.
8. HTML is the primary report format.
9. Google Sheets is optional.
10. ZIP is not part of the contract.

## 2. Global conventions

### Base path
`/api`

### Authentication
- Telegram webhook secret for Telegram inbound requests
- internal service token for backend-to-backend requests
- admin bearer token for admin requests
- ownership validation for user-scoped endpoints

### Response envelope

Success:
```json
{ "success": true, "data": {}, "error": null }
```

Failure:
```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "ERROR_CODE",
    "message": "Developer message",
    "details": {}
  }
}
```

### Date and money
- timestamps are ISO-8601 UTC
- money is bigint kopeks
- percentages are numeric values, not floats for money

## 3. Canonical error catalog

General:
- `UNAUTHORIZED`
- `FORBIDDEN`
- `NOT_FOUND`
- `INVALID_REQUEST`
- `VALIDATION_ERROR`
- `CONFLICT`
- `RATE_LIMITED`
- `INTERNAL_ERROR`
- `DEPENDENCY_ERROR`
- `SERVICE_UNAVAILABLE`

Onboarding and access:
- `CONSENT_REQUIRED`
- `TRIAL_ALREADY_USED`
- `ACCESS_DENIED`
- `SUBSCRIPTION_EXPIRED`

Imports:
- `INVALID_FILE`
- `FILE_TOO_LARGE`
- `UNSUPPORTED_FORMAT`
- `DUPLICATE_IMPORT`
- `INVALID_DELIMITER`
- `IMPORT_NOT_FOUND`
- `IMPORT_NOT_COMPLETED`
- `INVALID_STATUS_FOR_RETRY`
- `INVALID_STATUS_FOR_CANCEL`
- `IMPORT_OWNERSHIP_MISMATCH`
- `PARSING_FAILED`

Reconciliation:
- `NO_ELIGIBLE_IMPORTS`
- `PERIOD_MISMATCH`
- `RUN_NOT_FOUND`
- `RUN_OWNERSHIP_MISMATCH`
- `INVALID_RECONCILIATION_STATE`

Billing:
- `PAYMENT_FAILED`
- `PAYMENT_TIMEOUT`
- `PAYMENT_ALREADY_PROCESSED`
- `INVALID_WEBHOOK_SIGNATURE`
- `SUBSCRIPTION_ALREADY_ACTIVE`

Admin and internal:
- `ADMIN_ONLY`
- `INVALID_PROFILE_STATE`
- `EXPORT_FAILED`
- `WORKER_FAILED`
- `QUEUE_BACKLOG`
- `RETENTION_JOB_FAILED`

## 4. Telegram webhook

### POST `/api/telegram/webhook`
Receives Telegram updates.

Authentication:
- `X-Telegram-Bot-Api-Secret-Token`

Behavior:
- validate Telegram secret;
- deduplicate update IDs;
- route commands and callbacks;
- acknowledge quickly;
- enqueue jobs or call internal services.

Response:
```json
{ "ok": true }
```

## 5. Onboarding

### `/start`
Handled in bot logic and backed by internal user/consent operations.

Effects on acceptance:
- create or update user;
- record consent and privacy versions;
- set `has_used_trial = true`;
- set `subscription_status = TRIAL`;
- set `trial_started_at`;
- set `trial_ends_at = now + 7 days`.

If trial was already used, no new trial is created.

## 6. Imports listing

### GET `/api/imports`
Query:
- `user_id` required
- `source_type` optional
- `status` optional
- `marketplace` optional
- `limit` optional
- `period` optional `YYYY-MM`

Response example:
```json
{
  "success": true,
  "data": {
    "imports": [
      {
        "id": "uuid",
        "source_type": "WB",
        "marketplace": "WB",
        "status": "COMPLETED",
        "quality_status": "NORMAL",
        "period_start": "2026-06-01",
        "period_end": "2026-06-30",
        "created_at": "2026-06-15T10:30:00Z"
      }
    ]
  },
  "error": null
}
```

## 7. Upload WB report

### POST `/api/imports/wb`
Bot command: `/upload_wb`

Validation:
- XLSX only
- max 20 MB
- duplicate check by `(user_id, source_type, file_hash)`
- access must be TRIAL or ACTIVE

Response:
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

Errors:
- `INVALID_FILE`
- `FILE_TOO_LARGE`
- `DUPLICATE_IMPORT`
- `ACCESS_DENIED`

## 8. Upload bank statement

### POST `/api/imports/bank`
Bot command: `/upload_bank`

Validation:
- XLSX or CSV
- max 20 MB
- duplicate check by hash
- access must be TRIAL or ACTIVE
- delimiter override must be `;`, `,`, or `\t`

Response:
```json
{
  "success": true,
  "data": {
    "import_id": "uuid",
    "status": "RECEIVED",
    "delimiter": ";"
  },
  "error": null
}
```

Errors:
- `INVALID_FORMAT`
- `FILE_TOO_LARGE`
- `DUPLICATE_IMPORT`
- `ACCESS_DENIED`
- `INVALID_DELIMITER`

## 9. Import status

### GET `/api/imports/:id/status`
Bot command: `/status <import_id>`

Response example:
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "status": "COMPLETED",
    "quality_status": "NORMAL",
    "total_rows": 1045,
    "error_count": 4,
    "parse_success_rate": 99.62,
    "profile_confidence": 0.93,
    "profile_status": "ACTIVE",
    "profile_id": "uuid",
    "progress": 100,
    "source_type": "BANK",
    "marketplace": null
  },
  "error": null
}
```

Rules:
- `RECEIVED` means accepted but not yet processed;
- `PARSING` means the worker is active;
- `COMPLETED` means the import is finished;
- `quality_status` is separate from lifecycle status;
- `MANUAL_REVIEW` never appears as an import status.

## 10. Retry import

### POST `/api/imports/:id/retry`
Bot command: `/retry_import <import_id>`

Rules:
- ownership required;
- allowed only if status is `FAILED` or `CANCELLED`;
- reset status to `RECEIVED`;
- enqueue parser job.

Response:
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

Errors:
- `IMPORT_NOT_FOUND`
- `INVALID_STATUS_FOR_RETRY`
- `IMPORT_OWNERSHIP_MISMATCH`

## 11. Cancel operation

### POST `/api/cancel`
Bot command: `/cancel <id>`

Request:
```json
{
  "entity_type": "import",
  "entity_id": "uuid"
}
```

or
```json
{
  "entity_type": "reconciliation",
  "entity_id": "uuid"
}
```

Rules:
- import cancellation allowed only in `RECEIVED` or `PARSING`;
- reconciliation cancellation allowed only in `PENDING` or `RUNNING`;
- report generation should be cancelled where possible.

Response:
```json
{ "success": true, "data": { "cancelled": true }, "error": null }
```

Errors:
- `ENTITY_NOT_FOUND`
- `INVALID_STATUS_FOR_CANCEL`
- `IMPORT_OWNERSHIP_MISMATCH`
- `RUN_OWNERSHIP_MISMATCH`

## 12. Start reconciliation

### POST `/api/reconciliation/run`
Bot command: `/run_sync`

Request:
```json
{
  "wb_import_id": "uuid",
  "bank_import_id": "uuid"
}
```

Validation:
- same user;
- both imports `COMPLETED`;
- periods overlap;
- low-confidence bank imports are allowed with warning.

Response:
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

Errors:
- `IMPORT_NOT_COMPLETED`
- `PERIOD_MISMATCH`
- `ACCESS_DENIED`
- `NO_ELIGIBLE_IMPORTS`
- `RUN_OWNERSHIP_MISMATCH`

## 13. Reconciliation status

### GET `/api/reconciliation/:run_id`
Bot command: `/sync_status <run_id>`

Running:
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "status": "RUNNING",
    "progress": 45
  },
  "error": null
}
```

Completed:
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "status": "COMPLETED",
    "matched_count": 100,
    "unmatched_count": 3,
    "ambiguous_count": 1,
    "split_count": 2,
    "combined_count": 1,
    "match_rate": 96.15,
    "unmatched_amount_kopeks": 12500,
    "ambiguous_amount_kopeks": 3400,
    "loss_kopeks": 14200,
    "loss_percent": 0.85,
    "failure_reason": null,
    "progress": 100
  },
  "error": null
}
```

Cancelled:
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "status": "CANCELLED"
  },
  "error": null
}
```

## 14. Report access

### GET `/api/reports/:run_id`
Bot command: `/get_report <run_id>`

Response for HTML:
```json
{
  "success": true,
  "data": {
    "run_id": "uuid",
    "report_type": "HTML",
    "storage_path": "reports/user_id/run_id/report.html",
    "external_url": null,
    "expires_at": "2027-01-01T00:00:00Z"
  },
  "error": null
}
```

Response for Google Sheets:
```json
{
  "success": true,
  "data": {
    "run_id": "uuid",
    "report_type": "GOOGLE_SHEETS",
    "storage_path": null,
    "external_url": "https://docs.google.com/...",
    "expires_at": null
  },
  "error": null
}
```

Rules:
- HTML is primary.
- Google Sheets is optional.
- ZIP is not returned or supported.

Errors:
- `RUN_NOT_FOUND`
- `RUN_OWNERSHIP_MISMATCH`
- `EXPORT_FAILED`

## 15. History

### GET `/api/history`
Bot command: `/history`

Returns the latest 10 runs for the user, newest first.

## 16. User statistics

### GET `/api/stats`
Bot command: `/stats`

Response example:
```json
{
  "success": true,
  "data": {
    "total_reconciliations": 5,
    "completed_without_unreconciled_amount": 3,
    "total_unreconciled_amount_kopeks": 1234567,
    "average_loss_percent": 2.3,
    "max_unreconciled_run": {
      "run_id": "uuid",
      "created_at": "2026-06-01T00:00:00Z",
      "loss_kopeks": 567890
    }
  },
  "error": null
}
```

## 17. Subscription management

### POST `/api/billing/create-payment`
Bot command: `/subscribe`

Response:
```json
{
  "success": true,
  "data": {
    "payment_url": "https://yookassa.ru/...",
    "provider": "YOOKASSA"
  },
  "error": null
}
```

Errors:
- `SUBSCRIPTION_ALREADY_ACTIVE`
- `PAYMENT_FAILED`
- `PAYMENT_TIMEOUT`

### POST `/api/billing/webhook`
YooKassa webhook handler.

Rules:
- validate signature;
- persist payment event;
- update billing transaction;
- activate subscription;
- extend subscription period by 30 days;
- ensure idempotency.

Errors:
- `INVALID_WEBHOOK_SIGNATURE`
- `PAYMENT_ALREADY_PROCESSED`

## 18. Delete my data

### POST `/api/users/delete`
Bot command: `/delete_my_data`

Behavior:
- delete storage artifacts;
- delete canonical transactions;
- delete reconciliation data;
- soft-delete imports;
- anonymize user record;
- preserve `has_used_trial`;
- keep audit events.

## 19. Admin endpoints

Auth:
- `Authorization: Bearer <ADMIN_TOKEN>`

### GET `/api/admin/metrics`
Bot command: `/admin_metrics`

Returns:
- funnel metrics;
- import quality metrics;
- reconciliation quality metrics;
- monetization metrics.

### GET `/api/admin/profiles`
Bot command: `/view_profiles`

### POST `/api/admin/profiles/:id/activate`
Bot command: `/activate_profile <id>`

### POST `/api/admin/profiles/:id/deprecate`
Bot command: `/deprecate_profile <id>`

### GET `/api/admin/parsing-errors`
Bot command: `/view_errors`

### POST `/api/admin/reports/:run_id/retry`
Bot command: `/retry_export <run_id>`

## 20. Internal admin alerts

A worker failure or threshold breach must create an admin notification and send a Telegram alert with:
- job type;
- job id;
- user id if available;
- error message;
- truncated stack trace.

## 21. Internal job endpoints

Optional internal endpoints:
- progress update
- job completion
- job failure
- job cancellation

These must be service-authenticated.

## 22. Error handling and localization

- Never expose stack traces to users.
- Never expose raw bank row data in public errors.
- Localize user-facing errors in the bot layer.
- Keep error codes stable for deterministic UI mapping.

End of API Notes v3.1.
