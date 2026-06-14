```markdown
# PRD v4.2

**SverkaBot**

Version: 4.2  
Status: MVP Definition

Changes in v4.2: field names in Section 7.1 and FR-04A aligned with DB Draft v2.4; FR-07 status sets corrected; FR-10 deletion sequence made canonical; FR-11 (Claim data) added; `MANUAL_REVIEW` / `LOW_CONFIDENCE` rules defined in FR-04; reconciliation performance target unified (60 s target / 90 s hard limit); encryption requirement generalized.

This document is self-contained and provides a complete description of
the product, its business goals, user journeys, and functional
requirements for implementing the MVP.

---

## 1. Product Vision

SverkaBot is a financial reconciliation service for marketplace sellers
that automatically matches marketplace payouts with bank deposits and
identifies potentially lost funds.

The product is designed to help a seller quickly understand:

- whether all payouts were actually credited to the account;
- which payouts are missing;
- which transactions require additional review;
- what the potential amount of underpaid funds is.

The first supported marketplace is Wildberries.

The first interface is a Telegram bot.

---

## 2. Problem Statement

Marketplace sellers regularly face the following issues:

- delayed payouts;
- partial payouts;
- errors in fund transfers;
- difficulty performing manual data reconciliation;
- lack of transparent control over cash movement.

Most users do not perform systematic reconciliation because the process
is too labor-intensive.

An additional challenge is that bank statements do not follow a single
standard.

Different banks use:

- different file formats;
- different table structures;
- different column names;
- different date and amount formats;
- different export versions within the same bank.

For this reason, the system must be able to work with arbitrary bank
statements without requiring separate code for each new template.

---

## 3. MVP Goal

Validate the following hypotheses:

- Hypothesis 1: Sellers are willing to upload Wildberries reports and
  bank statements themselves in order to find discrepancies.

- Hypothesis 2: The service can automatically identify economically
  meaningful discrepancies.

- Hypothesis 3: At least 10% of users are willing to pay for the service
  after the trial period ends.

- Hypothesis 4: A statement-profile-based architecture makes it possible
  to scale support for new banks without rewriting the system.

---

## 4. What the Product Is

The user:

- launches the Telegram bot;
- accepts the data processing consent;
- uploads the Wildberries report;
- uploads the bank statement;
- starts reconciliation;
- receives the report;
- sees potential discrepancies and the amount of possible losses.

---

## 5. MVP Scope

**Interface:** Telegram bot

**Data sources:** Wildberries

Language: Russian only. All bot messages, menus, commands (except
technical /command names), prompts, buttons, reports, and error messages
must be in Russian.

**Wildberries report format:** XLSX

**Bank statements – supported formats for MVP:** XLSX, CSV

The architecture must allow the following formats to be added later
without changing the reconciliation logic: XLS, XML, DBF, TXT, SWIFT, PDF

**Core functions:**

- file upload;
- automatic detection of statement structure;
- creation and use of statement profiles;
- data normalization;
- transaction reconciliation;
- results export;
- reconciliation history;
- trial period;
- paid subscription;
- potential loss calculator;
- claim template;
- administrative tools.

**Language:** The entire Telegram bot interface must be in Russian. All
messages, menus, command descriptions, buttons, prompts, reconciliation
reports, and error notifications must be written in Russian. No English
text should be shown to the user except for technical log output (not
visible to user).

---

## 6. Out of Scope for the MVP

The following are not included:

- Ozon;
- Yandex Market;
- bank APIs;
- Wildberries API;
- automatic generation of legal documents;
- automatic claim submission;
- AI analysis of discrepancy causes;
- mobile app;
- customer web dashboard;
- success fee;
- cash flow forecasting.

---

## 7. Core System Concepts

### 7.1 Canonical Transaction

All transactions, regardless of source, must be normalized into a single
format.

| Field | Description |
|-------|-------------|
| `id` | UUID |
| `source_type` | WB or BANK |
| `import_id` | Reference to import |
| `row_number` | Original row number |
| `transaction_date` | Normalized transaction date |
| `amount_kopeks` | In kopeks (integer) |
| `direction` | IN / OUT |
| `currency` | Currency code (default `RUB` if absent in source) |
| `reference` | Document number or identifier (optional) |
| `description` | Normalized description |
| `counterparty` | Normalized counterparty name |

Field names above are canonical and must match DB Draft v2.4. Per-row confidence is not stored in the MVP; parsing quality is tracked at import level (`profile_confidence`, `parse_success_rate`, `quality_status`).

### 7.2 Statement Profile

A Statement Profile describes a specific bank statement template.
The profile defines how transactions are extracted from a file.

A profile contains:

- file format;
- structure signature;
- table detection rules;
- header detection rules;
- column mapping;
- date parsing rules;
- amount parsing rules;
- reference extraction rules;
- confidence parameters.

### 7.3 Draft Profile

If the system encounters an unknown statement format, it creates a Draft Profile.
The draft can be approved by an administrator and promoted to an active profile.

### 7.4 Profile Registry

All profiles are stored in a single registry.
The following data is stored for each profile:

- version;
- status (DRAFT, ACTIVE, DEPRECATED);
- usage statistics (`usage_count`, `success_rate` – updated asynchronously after each import);
- parsing success statistics.

---

## 8. User Roles

**User** can:

- upload files;
- start reconciliation;
- view history;
- pay for a subscription;
- delete their data.

**Administrator** can:

- view errors;
- view profiles;
- activate profiles;
- deactivate profiles;
- regenerate reports;
- view metrics.

---

## 9. User Journey (Summary)

1. `/start` – explanation and consent.
2. After consent: trial activated, main menu opens.
3. (Optional) Loss calculator: enter monthly turnover → receive estimate.
4. Upload Wildberries report (`/upload_wb`).
5. Upload bank statement (`/upload_bank`).
6. System analyzes structure, matches or creates profile, normalizes data.
7. User runs reconciliation (`/run_sync`).
8. System generates candidates, scores, matches, builds report.
9. User receives matches, discrepancies, potential loss amount, and report link.

---

## 10. Functional Requirements

### FR-01 Onboarding and Consent

On first launch, the user must accept the data processing consent.

After acceptance:

- the consent date is recorded;
- Trial is activated (7 days);
- access to system features is enabled.

Without consent, the product cannot be used.

### FR-02 Loss Calculator

The system must request the user's average monthly turnover.

Formula:
- Monthly loss = turnover × 4%
- Annual loss = monthly loss × 12

The result is displayed to the user.
The calculator is not required for further use of the product.

### FR-03 Wildberries Report Import

Supported format: XLSX

Limitations:
- file size ≤ 20 MB;
- number of rows ≤ 50,000 (checked at parse stage, not at upload).

Required fields:
- transaction date;
- transaction amount.

After successful processing:
- the file is saved;
- rows are normalized;
- `canonical_transactions` are created;
- import status becomes `COMPLETED` (or `FAILED` if structurally unreadable).

### FR-04 Bank Statement Import

Limitations (same as FR-03): file size ≤ 20 MB; number of rows ≤ 50,000 (checked at parse stage).

**Stage 1. Structure Analysis**
After upload, the system must:
- detect file format;
- detect tables and data region;
- find header candidates;
- calculate a confidence score for each candidate.

**Stage 2. Statement Profile Lookup**
Try to find a matching statement profile based on:
- column signature;
- file structure signature;
- known header templates;
- previously used profiles;
- successful import statistics.

If a profile is found with sufficient confidence:
- `profile_status = MATCHED`
- apply the profile.

If no profile is found:
- `profile_status = DRAFT`
- create a Draft Profile automatically.
- Import continues.

**Stage 3. Draft Profile Creation**
For an unknown template, the system must automatically determine:
- presumed header row;
- presumed date column;
- presumed amount column;
- presumed reference column;
- date format;
- amount format;
- number of rows before data starts.

The Draft Profile is saved in the system.

**Stage 4. Data Canonicalization**
After applying the profile, all rows must be converted into `canonical_transactions`.

Normalization includes:

*Dates:* support for `DD.MM.YYYY`, `DD.MM.YYYY HH:mm:ss`, `YYYY-MM-DD`, `YYYY/MM/DD`, and other common formats.

*Amounts:* support for `1234,56`, `1 234,56`, `1234.56`, `1 234.56`, negative values with minus, trailing minus, or parentheses. All amounts normalized to integer kopeks.

*Currencies:* remove `₽`, `rub.`, `RUB`, `$`, `€`, `USD`, `EUR`, etc.

*Text fields:* lowercase, trim extra spaces, normalize punctuation.

**Stage 5. Validation and Completion**
After canonicalization, the system calculates:
- `parse_success_rate` – percentage of successfully processed rows.
- `error_count` – number of rows with errors.
- `quality_status` – `HIGH_CONFIDENCE`, `LOW_CONFIDENCE`, or `MANUAL_REVIEW`.

`profile_confidence` (0–1) is stored on the import record (NULL for WB imports).

Quality rules (thresholds configurable in `settings`):
- `MANUAL_REVIEW` — `parse_success_rate < 70%`. The import still becomes `COMPLETED`; the user receives a strong warning and the import enters the admin review queue.
- `LOW_CONFIDENCE` — not MANUAL_REVIEW, and `profile_confidence < low_confidence_threshold` or `parse_success_rate < 90%`. The import becomes `COMPLETED`.
- `HIGH_CONFIDENCE` — otherwise. For WB imports (no profile) the rules use `parse_success_rate` only.

Errors in individual rows must not stop the import. Erroneous rows are logged in `parsing_errors`.

If the file is structurally unreadable, the import becomes `FAILED`.

### FR-04A Statement Profile Registry

The system must maintain a profile registry.

Each profile contains:
- `id`, `profile_key`, `display_name`, `bank_name_pattern`, `version`;
- `status` (DRAFT, ACTIVE, DEPRECATED);
- `created_at`, `updated_at`, `usage_count`, `success_rate`.

An administrator can:
- activate a profile;
- deactivate a profile;
- create a new profile version;
- view usage statistics.

### FR-05 Transaction Reconciliation

**General principle:** Reconciliation is performed between two sets of `canonical_transactions`:
- WB transactions (from a `COMPLETED` import)
- Bank transactions (from a `COMPLETED` import)

**Reconciliation objective:** For each Wildberries transaction, determine whether a corresponding deposit was found, whether multiple candidates exist, or whether it is missing.

**Stage 1. Candidate Generation**
For each WB transaction, generate a set of bank transaction candidates using hard filters:
- Direction matches.
- Currency matches.
- Amount exactly equal (MVP).
- Date within ±7 days (configurable).

**Stage 2. Score Calculation**
For each pair, calculate a weighted score:
- `amount_score` (40–50%)
- `date_score` (20–30%)
- `reference_score` (10–20%)
- `description_score` (5–15%)
- `counterparty_score` (5–10%)

Penalties applied for: fees, refunds, reversals, suspicious purpose, internal transfers.

**Stage 3. Global Matching**
Build a matching graph. Ensure:
- No bank transaction is used twice.
- No WB transaction is used twice.
- Select the best consistent set of matches.

**Stage 4. Split and Combined Matching (limited)**
- One WB transaction may match multiple bank transactions (`SPLIT_MATCHED`).
- Multiple WB transactions may match one bank transaction (`COMBINED_MATCHED`).
- MVP limit: max 3 rows per cluster.
- If no unambiguous solution → `AMBIGUOUS`.

### FR-05B Reconciliation Result Statuses

Each transaction pair gets one of:
- `MATCHED`
- `UNMATCHED`
- `AMBIGUOUS`
- `SPLIT_MATCHED`
- `COMBINED_MATCHED`

*Note:* `LOW_CONFIDENCE` is an import-level flag, not a match status.

### FR-06 Results Export

After reconciliation completes, the system must generate a report.

**Primary format:** Google Sheets (online, read‑only link)

**Fallback:** ZIP archive with CSV files containing:
- Summary, WB rows, Bank rows, Matched, Unmatched, Ambiguous, Parsing errors, Match evidence, Metrics, Claim data.

`SPLIT_MATCHED` and `COMBINED_MATCHED` results are included in the Matched section with an explicit match type column.

The report link is returned via `GET /api/reports/:run_id` and sent to the user in Telegram.

All report headers and labels must be in Russian.

### FR-07 History and Status

Command `/history` displays the user's last 10 reconciliations.

Command `/status <import_id>` shows import status:
- `RECEIVED`, `ANALYZING`, `PARSING`, `COMPLETED`, `FAILED`

Command `/sync_status <run_id>` shows reconciliation run status:
- `PENDING`, `RUNNING`, `COMPLETED`, `FAILED`

`/history` and report download remain available to `EXPIRED` users (read-only).

### FR-08 Access Management

**Trial:** After first consent, user receives `TRIAL` for 7 days.

**Paid access:** 1,500 RUB for 30 days. After successful payment → `ACTIVE`, `subscription_end_date = now + 30 days`.

**Expiry:** After trial or paid period ends → `EXPIRED`. No `ARCHIVED` in MVP. A trial that expires without payment also becomes `EXPIRED`; `subscription_end_date` remains `NULL` in that case.

Access is checked before protected actions (`/upload_wb`, `/upload_bank`, `/run_sync`).

### FR-09 Administration

Available only to administrators.

Commands:
- `/view_errors` – view recent parsing errors.
- `/view_profiles` – view profiles.
- `/activate_profile <profile_id>`
- `/deprecate_profile <profile_id>`
- `/retry_export <run_id>` – regenerate report.
- `/stats` – overall metrics.

### FR-10 Delete My Data

Command `/delete_my_data` with confirmation.

Actions (canonical sequence, aligned with DB Draft v2.4):
- delete physical files and report artifacts from storage;
- hard-delete `canonical_transactions` of the user's imports;
- hard-delete `reconciliation_runs` (cascade removes candidates, matches, match items, evidence, and report records);
- soft-delete imports (set `deleted_at`);
- anonymize user record (set `deleted_at`, clear PII);
- keep audit events with `user_id = NULL`.

### FR-11 Claim Data

The reconciliation report must include a “Claim data” section with the information needed to draft a claim to the marketplace: dates, amounts, and references of `UNMATCHED` (and optionally `AMBIGUOUS`) payouts. Automatic generation of legal documents remains out of scope (Section 6).

---

## 11. Non-Functional Requirements

**Performance:**
- Import 10,000 rows < 30 seconds.
- Reconciliation 50,000 × 50,000: target 60 seconds, hard limit 90 seconds.
- Bot commands (non‑heavy) < 1 second.

**Localization:** All user-facing text in Russian. Command descriptions in Russian.

**Security:**
- Files encrypted at rest (platform-provided encryption).
- Temporary files deleted after processing.
- No full raw bank rows in logs.
- Admin actions restricted by Telegram ID.

---

## 12. Security and Compliance

- All files stored encrypted.
- User data deletion supported.
- Retention: soft‑deleted imports kept for audit, physical files removed.
- Compliance with applicable data protection laws.

---

## 13. MVP Metrics

**Funnel:**
- registrations, consents, uploads, reconciliation runs.

**Import quality:**
- `parse_success_rate`, `error_count`, `profile_reuse_rate`, `profile_creation_rate`, `low_confidence_rate`.

**Reconciliation quality:**
- `match_rate`, `unmatched_rate`, `ambiguous_rate`, `split_match_rate`, `combined_match_rate`.

**Value:**
- % of users with discrepancies > 0, > 3,000 RUB.

**Monetization:**
- trial → paid conversion, retention, repeat reconciliation rate.

---

## 14. MVP Success Criteria

The MVP is considered successful if all conditions below are met.

**Product:**
- User completes full journey without support.
- System supports at least 5 different statement templates (not just 5 banks).
- At least 90% of files are imported successfully.

**Quality:**
- `ambiguous_rate` < 10% on test set.
- `low_confidence_rate` < 15% in pilot.

**Value:**
- At least 30% of users find economically meaningful discrepancies.

**Monetization:**
- At least 10% conversion TRIAL → ACTIVE.

**Resilience:**
- System correctly processes files with up to 30% parsing error rate (i.e., 70% of rows successfully normalized) – import still completes with `COMPLETED` and `LOW_CONFIDENCE`.

---

## 15. Risks and Mitigation

| Risk | Mitigation |
|------|-------------|
| Growth in number of statement templates | Statement Profiles, Draft Profiles, Profile Registry, versioning |
| Low reconciliation quality | Score‑based matching, global assignment, evidence storage |
| Import errors | Confidence scoring, profiles, quality statistics |

---

## 16. Post-MVP Development Strategy

1. Improve reconciliation quality.
2. Support additional marketplaces.
3. Support additional bank formats.
4. Build full seller financial hub.

---

## 17. Conclusion

SverkaBot MVP is an automated reconciliation system for marketplace
payouts and bank deposits built around three key principles:

- **Canonical Transactions** – a single data model regardless of source.
- **Statement Profiles** – scalable support for arbitrary bank statements without code changes.
- **Confidence‑Based Reconciliation** – explainable matching algorithm with global conflict resolution.

The architecture enables rapid onboarding of new statement templates,
maintains high reconciliation quality, and supports future scale without
a radical system redesign.

**End of PRD v4.2**
```