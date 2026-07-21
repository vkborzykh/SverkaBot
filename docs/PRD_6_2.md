# SverkaBot — PRD v6.2

This document supersedes PRD v6.1 and is the canonical product definition for the production version of SverkaBot.

Aligned with: Tech Plan 6.1, User Flow 3.2, API Notes 3.1, DB Draft v4.2, Security Spec v1.1

Purpose: define the product vision, scope, user value, functional requirements, non-functional requirements, and business rules for the commercial Telegram bot that reconciles Wildberries payouts against bank statements.

All user-facing text must be Russian. Technical documentation, code comments, API field names, and internal logs may be English.

**Changelog v6.1 → v6.2 (2026-07):** FR-05 and FR-06 updated to describe the
actual two-engine reconciliation architecture and row-level claim generation
(see §6 below). **§5 Pricing is NOT updated in this revision** — the documented
single 1500₽/month plan has diverged significantly from the implemented
START/PRO/BUSINESS tier model with an export add-on and referral discounts.
That is a larger, separate sync (needs the current tariff copy, trial policy,
and referral mechanics written up properly) and is intentionally left as
known-divergent rather than rewritten hastily here.

## 1. Product vision

SverkaBot is a Telegram-first reconciliation product for marketplace sellers. It helps users determine whether Wildberries payouts were actually credited to their bank account, identify unresolved payouts, and produce an actionable report that can be shared with accountants or used for manual follow-up.

The product is built for:
- small businesses and individual entrepreneurs;
- users who need a fast, repeatable reconciliation workflow;
- future expansion to more marketplaces without rewriting the reconciliation core.

## 2. Core product principles

1. The product must be Telegram-native.
2. The product must be asynchronous and resilient.
3. The product must be explainable: users should be able to understand why a row matched or did not match.
4. The product must keep user-facing content in Russian.
5. The product must be marketplace-aware from the start.
6. The product must preserve data safety, retention policy, and deletion guarantees.
7. The product must not claim confirmed financial loss when it can only estimate unreconciled payouts.

## 3. Market and business scope

### 3.1 Initial scope
- One marketplace user journey: Wildberries.
- One bank statement journey: XLSX or CSV.
- One paid plan.
- One trial period.
- One Telegram bot interface.
- One primary report format: HTML.
- Optional Google Sheets export.

### 3.2 Excluded from v1
- ZIP report bundle.
- Mobile app.
- Web dashboard for end users.
- Bank API integration.
- Marketplace APIs.
- AI-generated legal claims.
- Corporate tier.
- Volume-based usage limits.

### 3.3 Future expansion
The architecture must allow adding more marketplaces later. That means the internal data model must separate:
- `source_type` = nature of the uploaded file, currently `WB` or `BANK`;
- `marketplace` = business source of marketplace data, currently `WB`, and later `OZON`, `YANDEX`, `MEGAMARKET`, etc.

Bank statements are not marketplaces.

## 4. User value proposition

The product answers:
- Did all payouts arrive?
- Which payouts are missing?
- Which rows are ambiguous and need manual review?
- What amount remains unresolved after reconciliation?

The product does not pretend to know the legal or accounting status of the funds. It identifies unreconciled payout amounts.

Canonical Russian wording:
- `Неподтверждённые выплаты`
- `Сумма неподтверждённых выплат`
- `Процент неподтверждённых выплат`

## 5. Pricing and monetization

### 5.1 Pricing
One paid plan:
- 1500 RUB per 30 days.

### 5.2 Trial
- 7-day trial.
- No monthly usage limits in v1.
- No corporate tier in v1.
- No repeat trial after deletion.

Trial-abuse prevention is mandatory:
- once `has_used_trial = true`, the user cannot receive a new trial after deletion.

### 5.3 Billing provider
YooKassa is the canonical payment provider for v1.

## 6. Functional requirements

### FR-01 Onboarding and consent
The first user interaction must present:
- a short explanation of the product;
- a consent message;
- links to the offer and privacy policy;
- buttons to accept or reject.

On acceptance:
- record consent version and privacy policy version;
- create the user if needed;
- set `has_used_trial = true`;
- set the user to TRIAL for 7 days;
- show the main menu.

If the user already used the trial, do not grant a new one.

### FR-02 Upload Wildberries report
Users can upload only XLSX files up to 20 MB.

Required behavior:
- validate file type and size;
- compute SHA-256 hash;
- reject duplicates by `(user_id, source_type, file_hash)`;
- store the file in Supabase Storage;
- create an import with status `RECEIVED`;
- enqueue WB parsing.

WB parsing must:
- detect the header row;
- normalize dates and amounts;
- create canonical transactions;
- store malformed rows separately;
- allow row-level errors without failing the whole file unless the file is structurally unreadable.

### FR-03 Upload bank statement
Users can upload XLSX or CSV files up to 20 MB.

Required behavior:
- validate file type and size;
- compute SHA-256 hash;
- reject duplicates by `(user_id, source_type, file_hash)`;
- autodetect CSV delimiter among `;`, `,`, `\t`;
- allow user override through command syntax;
- store the file in Supabase Storage;
- create an import with status `RECEIVED`;
- enqueue bank parsing.

Bank parsing must:
- detect candidate table layouts;
- resolve or create a bank statement profile;
- canonicalize rows;
- store parsing evidence;
- mark quality status according to parse confidence.

### FR-04 Parsing quality
Import status and quality status are separate concepts.

Import statuses:
- `RECEIVED`
- `PARSING`
- `COMPLETED`
- `FAILED`
- `CANCELLED`

Quality statuses:
- `NORMAL`
- `LOW_CONFIDENCE`
- `MANUAL_REVIEW`

`MANUAL_REVIEW` means the file was structurally parseable but the quality is poor enough for admin attention.

### FR-05 Reconciliation
The user can reconcile one completed WB import with one completed bank import.

**Current implementation (v6.2 — corrected from v6.1):** reconciliation runs on
an **aggregate engine** (`Σ WB IN − Σ WB OUT` vs. matched bank credits), not a
row-level matcher. This is the only engine that determines `reconciliation_runs`
status, metrics, and the user-facing result message.

A **row-level engine** (candidate generation → weighted scoring → conflict-aware
assignment → split/combined detection) exists and runs automatically after every
completed reconciliation, but only in shadow mode: it never determines the run's
status or the user-facing outcome, and its errors are caught and logged for admin
review rather than surfaced. It becomes the primary engine only after a sustained
period of agreement with the aggregate engine on real traffic (tracked via admin
notifications, not yet met as of this revision). See DB Draft v4.2 §27a for the
mechanical detail.

The engine must:
- verify ownership and status;
- ensure the periods overlap within configured tolerance;
- generate candidates using hard filters (**implemented**, always persisted —
  used independently by claim generation, see FR-06);
- score candidates using weighted factors (**implemented, shadow-only**);
- prevent double-use of rows (**implemented, shadow-only**);
- support split and combined matches up to configured limits (**implemented,
  shadow-only**);
- persist evidence for explainability (**shadow-only; not guaranteed present**
  for any given run until the engine is promoted to primary);
- compute unreconciled amount metrics (**aggregate engine, production**).

Final match groups (row-level engine, shadow-only until cutover):
- `MATCHED`
- `UNMATCHED`
- `AMBIGUOUS`
- `SPLIT_MATCHED`
- `COMBINED_MATCHED`

Empty candidate sets are not failures.

### FR-06 Report generation
Primary report format:
- HTML

Optional report format:
- Google Sheets

ZIP is not part of the product contract.

The report must include:
- summary;
- reconciliation metrics;
- matched rows;
- unmatched rows;
- ambiguous groups;
- WB rows;
- bank rows;
- evidence;
- parsing errors;
- claim-ready section for unresolved payouts. **v6.2:** built by `claimBuilder.ts`
  from persisted row-level candidates (independent of the shadow engine's
  scoring/assignment — see FR-05), cross-checked against the aggregate loss
  amount within a 5%/500₽ tolerance. Falls back to a generic, clearly-labeled
  aggregate list (not itemized) when the row-level breakdown doesn't clear
  that confidence check. Same logic is reused for the XLSX "Претензия" sheet
  and the 1С registry (row-level = one line per unpaid transaction; fallback =
  one aggregate line per run, as in the original v6.1 contract).

HTML is delivered as a document or secure link. Google Sheets is optional and read-only.

### FR-07 History and status
The user can:
- check import status;
- check reconciliation status;
- view history of the last 10 reconciliations;
- see the report link if available.

### FR-08 Subscription management
The user can:
- view current subscription state;
- request payment link;
- receive payment confirmation;
- be reminded before expiry.

### FR-09 Retry and cancel
The user can retry failed or cancelled imports.
The user can cancel active imports or active reconciliation runs.

### FR-10 Data deletion
The user can request full deletion of their data.

Deletion must:
- delete storage artifacts;
- remove canonical transactions;
- remove reconciliation data;
- soft-delete imports;
- anonymize the user;
- keep audit events;
- preserve `has_used_trial`.

### FR-11 Statistics
`/stats` shows:
- total reconciliations;
- reconciliations without unreconciled amount;
- total unreconciled amount;
- average unreconciled percentage;
- run with maximum unreconciled amount.

### FR-12 Administration
Administrators can:
- view profiles;
- activate/deprecate profiles;
- view parsing errors;
- retry failed report export;
- view admin metrics;
- receive worker failure alerts.

## 7. Non-functional requirements

### Performance
- Webhook acknowledgement within 5 seconds.
- Typical import or reconciliation should complete within about 30-60 seconds depending on size.
- Maximum supported load: 50k WB rows and 50k bank rows.
- The engine must degrade gracefully at maximum load and avoid brute-force O(n²) matching.

### Reliability
- Jobs must be asynchronous.
- Jobs must be idempotent.
- Jobs must support retries with backoff.
- Jobs must be cancellable where possible.

### Security
- Ownership checks on all user-scoped operations.
- Webhook validation for Telegram and YooKassa.
- No raw bank data in logs.
- No secrets in source code or logs.
- Signed or ownership-validated report access.

### Localization
All user-facing text must be Russian.
Use:
- `DD.MM.YYYY` dates;
- spaces as thousand separators;
- comma as decimal separator where needed.

## 8. Retention policy

- Uploaded files: 90 days.
- Reports: 180 days.
- Parsing errors: 30 days as raw records.
- Audit events: indefinite.
- Payment events: indefinite.
- Canonical transactions: removed with imports or with user deletion.

## 9. Success criteria

The full product is successful if:
- a user can complete onboarding, upload both files, reconcile, and receive a report without admin intervention;
- the report clearly distinguishes matched, unmatched, and ambiguous rows;
- the product can be monetized through YooKassa;
- the product preserves trial-abuse prevention;
- the system remains stable under typical seller workloads;
- the architecture can later support additional marketplaces.

End of PRD v6.2.
