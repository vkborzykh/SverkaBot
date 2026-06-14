```markdown
# Tech Plan v4.2

### MVP Technical Plan for PRD 4.2

**Document purpose:** Describe the implementable technical architecture,
data model, processing pipeline, testing strategy, and delivery plan for
the SverkaBot MVP.

**Primary implementation target:** Bolt AI / Bolt Cloud full-stack web
app with TypeScript, database, file storage, authentication, and server
functions.

**Core principle:** Canonical Transactions + Statement Profiles +
Confidence-Based Reconciliation.

Changes in v4.2: aligned with DB Draft v2.4 (no `report_id` on runs; added
`display_name`, `profile_confidence`); library choices fixed (Papa Parse,
date-fns, Next.js 14); dedup key without period; period computation and
quality-status rules made explicit; empty-candidate rule stated; deletion
workflow aligned; reconciliation target unified (60 s / 90 s).

---

## 1. Product and delivery objective

The purpose of the MVP is to validate a repeatable financial
reconciliation workflow for Wildberries sellers. The system must ingest
one weekly Wildberries report and one monthly bank statement, normalize
both sources into a canonical transaction model, match them with
explainable rules, generate a report, and preserve enough evidence to
improve the next import.

The implementation must be practical inside Bolt AI: a single codebase,
a relational database, file storage for uploaded documents, server-side
functions for parsing and reconciliation, and lightweight async
orchestration via persisted jobs and polling rather than a large
external microservice stack.

---

## 2. Technical success criteria

- A new user can complete /start, consent, upload files, run
  reconciliation, and receive a report without admin intervention.

- The system supports at least five real bank statement templates at MVP
  start and can add new templates without code changes.

- Bank statement import is resilient to bad rows and does not fail the
  whole file because of one malformed row.

- The reconciliation engine is explainable: every matched, unmatched,
  ambiguous, split, or combined result stores evidence and reason codes.

- The report is generated automatically and includes a fallback export
  when the primary export channel is unavailable.

- The architecture supports a future increase in bank templates without
  rewriting the reconciliation core.

---

## 3. Recommended implementation stack

The stack below is optimized for Bolt AI and for shipping quickly
without sacrificing reliability.

- Frontend: Next.js 14 + React + TypeScript.

- UI: Tailwind CSS with a compact admin-friendly layout.

- Backend: TypeScript server functions for uploads, parsing, matching,
  billing webhooks, and admin actions.

- Database: Bolt Database / PostgreSQL-compatible relational storage.

- File storage: Bolt file storage for source files, generated CSV
  archives, and report artifacts.

- Validation: Zod for request and parsed row validation.

- Parsing: xlsx for Excel, Papa Parse for CSV, plus a small custom
  tokenizer for messy inputs.

- Date handling: date-fns.

- Matching: deterministic scoring and graph-based assignment implemented
  in TypeScript.

- Observability: structured application logs, job records, parsing error
  records, and reconciliation evidence tables.

This stack keeps all core logic in one language, which is important for
Bolt AI maintainability and for avoiding integration overhead.

---

## 4. System architecture

The MVP is organized as a small number of server-side modules with clear
boundaries. Each module has a single responsibility and writes its
output to the database so processing can resume safely after
interruption.

- Bot/API layer: Telegram webhook handlers, authorization, onboarding,
  access control, status commands, and admin commands. Localization: All
  user-facing bot content must be in Russian. Use Russian locale for
  date formatting (DD.MM.YYYY), number formatting (space as thousand
  separator, comma as decimal separator where applicable). Command names
  can remain in English (e.g., /start, /upload_wb) but their
  descriptions (visible via /help or BotFather) must be in Russian.

- File ingestion layer: upload validation, hashing, storage, file
  metadata, and virus-safe handling of user files.

- Statement analysis layer: file type detection, sheet/table discovery,
  header detection, and profile resolution.

- Canonicalization layer: row normalization into `canonical_transactions`
  records.

- Reconciliation layer: candidate generation, scoring, conflict
  resolution, and status assignment.

- Reporting layer: export to Google Sheets-style report or CSV archive
  fallback.

- Billing layer: payment links, webhook confirmation, access extension,
  and expiry handling.

- Job layer: persisted jobs with status transitions and retry-safe
  processing.

- Admin layer: diagnostics, profile review, overrides, and statistics.

---

## 5. Data model

The database should be relational and explicit. Avoid storing parsing or
matching state only in JSON blobs; use JSON only for raw evidence or
source fragments that must be preserved for debugging.

### 5.1 Core tables (aligned with DB Draft v2.4)

- `users`
- `consents`
- `statement_profiles`
- `imports`
- `parsing_errors`
- `canonical_transactions`
- `reconciliation_runs`
- `reconciliation_candidates`
- `reconciliation_matches`
- `reconciliation_match_items`
- `reconciliation_evidence`
- `reports`
- `billing_transactions`
- `settings`
- `audit_events`
- `jobs`

### 5.2 Important fields

- `imports`: `user_id`, `source_type`, `period_start`, `period_end`,
  `file_hash`, `status`, `quality_status`, `profile_id`, `profile_status`,
  `profile_confidence`, `parse_success_rate`, `error_count`

- `statement_profiles`: `profile_key`, `display_name`, `bank_name_pattern`, `file_type`,
  `status`, `version`, `signature`, `created_by`, `usage_count`,
  `success_rate`

- `canonical_transactions`: `source_type`, `transaction_date`,
  `amount_kopeks`, `direction`, `currency`, `reference`, `description`,
  `counterparty`, `row_hash`, `import_id`

- `reconciliation_runs`: `user_id`, `wb_import_id`, `bank_import_id`,
  `status`, `total_wb_rows`, `total_bank_rows`, `matched_count`,
  `unmatched_count`, `ambiguous_count`, `split_count`, `combined_count`,
  `match_rate`, `unmatched_amount`, `ambiguous_amount`

- `reconciliation_candidates`: `run_id`, `wb_tx_id`, `bank_tx_id`,
  `score`, `reason_codes`

- `reconciliation_evidence`: `match_id`, `amount_score`, `date_score`,
  `reference_score`, `description_score`, `counterparty_score`,
  `penalties`

- `reconciliation_match_items`: `match_id`, `transaction_id`, `side`

- `reports`: `run_id`, `storage_path`, `export_type`

---

## 6. File ingestion pipeline

The import pipeline must be resilient, deterministic, and safe to retry.
The pipeline is the same whether the file comes from a Telegram upload
or a future web upload.

### 6.1 Ingestion steps

1. Validate user permissions, file size, and allowed extensions.

2. Calculate `file_hash` and reject duplicates by `user_id + source_type +
   file_hash`. The import period is unknown at upload time and is not part
   of the dedup key.

3. Store the original file in encrypted storage or encrypted-at-rest
   storage depending on the platform setup.

4. Create an `import` record with status `RECEIVED`.

5. Dispatch a server-side job for analysis and parsing.

6. Update status through `ANALYZING`, `PARSING`, to `COMPLETED` or `FAILED`.

### 6.2 Bank statement discovery and header detection

A single regex for the header line is not sufficient. The parser must
evaluate several candidates and choose the best one using a score.

- Extract the first sheets, rows, and visible table regions.

- Generate header candidates from the top portion of each table.

- Score candidates by the presence of date, amount, reference, and
  transaction-description aliases in Russian and English.

- Measure how many rows below the candidate can be parsed successfully.

- Penalize candidates that look like summary rows, closing balances, or
  repeated headers.

- Select the highest-confidence candidate only if it passes a minimum
  threshold.

### 6.3 Statement Profile resolution

- Try to match an existing active profile using file signature, column
  aliases, header similarity, and historical success.

- If a match is found, apply the profile.

- If no profile is found, create a draft profile and continue parsing in
  draft mode.

- Store the profile decision (`profile_status = 'MATCHED'` or `'DRAFT'`)
  and `quality_status` (e.g., `LOW_CONFIDENCE` if confidence below
  threshold) in the import record.

- Allow an admin to promote a draft to active or to replace it with a
  newer version.

### 6.4 Canonicalization rules

- Normalize all dates to Europe/Moscow business date logic and store
  timestamps in UTC where timestamps exist.

- Store amounts as integer kopeks.

- Strip currency symbols and thousands separators.

- Support decimal separators as both comma and dot.

- Normalize negative amounts written with a minus sign, trailing minus,
  or parentheses.

- Normalize text fields to lower case and trim repeated whitespace.

- Preserve original raw fields only in controlled debugging fields or
  evidence JSON, not in user-facing output.

- After canonicalization, compute the import `period_start` / `period_end`
  as min/max of `transaction_date`; these fields drive the period overlap
  check before reconciliation.

### 6.5 Error handling

- A malformed row must create a `parsing_errors` record and not stop the
  import.

- If a file is structurally unreadable, the import fails fast with a
  clear reason and status `FAILED`.

- If the parser confidence is low, the file can still be marked
  `COMPLETED` but with `quality_status = LOW_CONFIDENCE`.

- Quality statuses follow configurable thresholds in `settings`:
  `MANUAL_REVIEW` when `parse_success_rate < 70%` (import still completes
  and enters the admin review queue), `LOW_CONFIDENCE` when profile
  confidence or success rate is below thresholds, `HIGH_CONFIDENCE`
  otherwise.

- Every error record stores row number, source fragment (truncated), and
  reason code.

---

## 7. Reconciliation engine

The reconciliation engine must solve the matching problem globally, not
row by row in a greedy order. This avoids double-use of a bank
transaction and reduces false positives on repeated amounts.

### 7.1 Inputs

- One Wildberries report (set of `canonical_transactions` with `source_type = WB`, status `COMPLETED`).

- One bank statement (set of `canonical_transactions` with `source_type = BANK`, status `COMPLETED`).

- Optional profile and settings data that control date windows and
  thresholds.

### 7.2 Candidate generation

- Filter by direction.
- Filter by currency.
- Filter by exact amount (MVP requirement).
- Allow a configurable date window around the WB operation date (default ±7 days).
- Optionally filter by reference or description hints.
- Exclude obvious non-payout rows such as internal transfers, fee rows, and balancing rows.

### 7.3 Scoring model

Each WB row and bank row candidate pair receives a weighted score. The
weights must be stored in `settings` so they can be tuned without a code
release.

- `amount_score`: highest weight, near-zero tolerance in MVP.
- `date_score`: penalize larger gaps inside the allowed window.
- `reference_score`: strong boost if document numbers or payout IDs align.
- `description_score`: boost if description tokens indicate Wildberries payouts.
- `counterparty_score`: boost if sender/receiver names align.
- Penalty terms: commissions, refunds, chargebacks, internal transfers, suspicious descriptions.

### 7.4 Global assignment

After scoring, the engine must build a graph of candidate pairs and
resolve conflicts globally.

- Fix obviously unique high-confidence matches first.
- Split candidate graphs into connected components.
- Solve small components with a maximum-weight assignment algorithm.
- Use a controlled greedy fallback only for very large components, with
  explicit ambiguity thresholds.
- Never assign one bank row to more than one WB row unless the result is
  explicitly marked `SPLIT_MATCHED`.
- Never assign one WB row to more than one bank row unless explicitly
  marked `COMBINED_MATCHED`.

### 7.5 Split and combined matches

- Support only small bounded groups in MVP, up to three rows in a split
  or combined cluster (configurable via `split_combined_max_rows`).
- Require that amounts sum exactly after normalization.
- Require that date windows remain plausible for all items in the
  cluster.
- If bounded rules do not resolve the cluster, mark the result
  `AMBIGUOUS`.

### 7.6 Result statuses

- `MATCHED` – one WB row matched to one bank row.
- `UNMATCHED` – no suitable bank candidate found.
- `AMBIGUOUS` – several candidates remain plausible.
- `SPLIT_MATCHED` – one WB row matched to several bank rows.
- `COMBINED_MATCHED` – several WB rows matched to one bank row.

*Note:* `LOW_CONFIDENCE` is an import-level flag (quality of parsing),
not a match-level status. A match can be `MATCHED` even if the import
has `LOW_CONFIDENCE`.

*Note:* an empty candidate set is not a failure: the run completes with
status `COMPLETED` and all WB rows marked `UNMATCHED`.

### 7.7 Evidence and explainability

- Store score components for every accepted or rejected candidate in
  `reconciliation_evidence` (linked via `match_id`).
- Store reason codes for every penalty and filter decision in
  `reconciliation_candidates.reason_codes`.
- Store top candidates for each ambiguous WB row (optional, can be
  derived from candidates table).
- Expose evidence in the export report for admin review.

---

## 8. Reporting and export

The report is part of the product value, not a side effect. It should
make the user immediately understand the economic outcome of the
reconciliation.

### 8.1 Primary export

- Generate a structured report with Summary, WB rows, Bank rows,
  Matched, Unmatched, Ambiguous, Parsing errors, Match evidence, and
  Metrics sheets or sections.

- Prefer a Google Sheets-style online report if the environment supports
  it.

- Provide a shareable read-only link to the report.

- Store the result in `reports` table with `export_type = 'GOOGLE_SHEETS'`
  and `storage_path` containing the URL.

### 8.2 Fallback export

- If the primary export path fails, generate a ZIP archive with CSV
  files for each logical section.

- Store the archive in file storage and return its link to the user.

- Create a `reports` record with `export_type = 'ZIP'` and `storage_path`
  pointing to the archive.

- Retry the primary export a small number of times before falling back.

### 8.3 Report content

- Matched, unmatched, ambiguous, split, and combined results.
- Potential loss estimate (sum of unmatched amounts + half of ambiguous amounts).
- Parsing error summary.
- Match rate and ambiguous rate.
- Profile confidence and import health metrics.
- Claim draft data with dates, sums, and references.

---

## 9. Billing, access control, and reminders

Billing is intentionally simple in MVP to measure willingness to pay
without adding product complexity.

- Trial begins automatically after consent and lasts seven days.

- Payment creates an active access period for 30 days.

- Access state is checked before all protected actions (`/upload_wb`,
  `/upload_bank`, `/run_sync`).

- Expired users see a clear prompt to renew access.

- A reminder for repeat reconciliation is sent when no new
  reconciliation has been completed for 30 days.

- A deletion workflow must remove user-linked financial data according
  to the canonical sequence in DB Draft v2.4: delete physical files and
  report artifacts via background job, hard-delete canonical transactions
  and reconciliation runs (with cascades), soft-delete imports, set
  `deleted_at` on user, nullify `user_id` in `audit_events`.

---

## 10. Admin and support tools

Administrative operations must be available without direct database
access.

- View recent parsing errors without exposing full raw statement rows.
- Review profile statistics and low-confidence imports.
- Promote, edit, or deprecate statement profiles.
- Add or override profile mappings for a bank template.
- Retry report generation for a failed run.
- Inspect conversion and retention statistics.
- Inspect reconciliation evidence for a problematic run.

---

## 11. Security and compliance

Financial files are sensitive. The plan must minimize exposure by
design.

- Store uploaded files encrypted or in encrypted storage.

- Delete temporary processing files as soon as they are no longer
  needed. Physical files from soft-deleted imports are removed by a
  scheduled background job.

- Do not write full raw bank rows to logs.

- Store only limited debugging fragments in `parsing_errors` and
  evidence tables.

- Use named secrets for API keys and signing keys.

- Restrict admin actions by explicit Telegram admin identifier or
  equivalent role control.

- Support a user-triggered data deletion flow.

- Keep data retention and deletion policies explicit in product copy and
  bot messages.

---

## 12. Observability and metrics

The MVP must be measurable from day one.

- Track imports received, parsed, normalized, and failed.
- Track profile reuse rate (`profile_status = 'MATCHED'`) and new profile creation rate (`profile_status = 'DRAFT'`).
- Track `parse_success_rate`, `error_count`, and `low_confidence_rate`.
- Track `match_rate`, `unmatched_rate`, `ambiguous_rate`, `split_match_rate`, `combined_match_rate`.
- Track trial-to-paid conversion.
- Track repeat reconciliation rate within 30 days.
- Track support intervention rate.
- Track `profile_match_rate` (percentage of bank imports where an existing active profile was found).
- Store metrics per run and per user cohort.

---

## 13. Testing strategy

Testing must cover both correctness and failure modes.

### 13.1 Unit tests

- File type detection.
- Header detection scoring.
- Date parsing and amount normalization.
- Profile matching and profile fallback.
- Candidate generation.
- Score calculation.
- Global assignment logic.
- Split and combined matching rules.
- Export builders.
- Billing webhook validation.
- Access expiry and reminder logic.

### 13.2 Integration tests

- Upload a real Excel bank statement and verify profile resolution.
- Upload malformed rows and verify `parsing_errors` are produced.
- Run matching on synthetic data with known answers.
- Validate fallback export when primary export is unavailable.
- Validate admin commands and permission checks.
- Validate duplicate file protection.

### 13.3 End-to-end tests

- New user consent flow.
- File upload to completed report flow.
- Expired access blocking and renewal flow.
- Reminder trigger after inactivity.
- Profile creation from a new bank template.
- Low-confidence import flow.
- Verify that all bot messages are in Russian, no English strings appear
  in user-facing interface.

---

## 14. Performance targets

- 10,000 rows should import in under 30 seconds under normal conditions.
- 50,000 WB rows versus 50,000 bank rows: target 60 seconds, hard limit
  90 seconds on the target hosting tier.
- Non-heavy bot commands should respond within one second.
- The reconciliation engine should use indexes and precomputed candidate
  buckets to avoid O(n²) brute-force comparisons across the full
  dataset.

---

## 15. Delivery roadmap

### Phase 0. Foundation
- Project setup, environment configuration, database schema, file
  storage, secrets, and authentication.
- Telegram webhook handlers.
- Core job model and logging.

### Phase 1. Import and canonicalization
- WB parser.
- Bank parser for XLSX and CSV.
- File hashing and deduplication.
- `canonical_transactions` model.
- Parsing error capture.

### Phase 2. Statement Profiles
- Header discovery.
- Profile resolution.
- Draft profile creation.
- Profile registry UI/admin actions.
- Profile versioning.

### Phase 3. Reconciliation
- Candidate generation.
- Scoring.
- Graph-based assignment.
- Split/combined limited support.
- Evidence storage.

### Phase 4. Reports and billing
- Report export (Google Sheets + CSV fallback).
- Trial and payment flows.
- Reminder logic.

### Phase 5. Admin, security, and QA
- Admin diagnostics.
- Deletion flow.
- Metrics dashboards.
- Load tests and pilot fixtures.
- Bug fixes before pilot.

---

## 16. Implementation notes for Bolt AI

To keep the whole system buildable in Bolt AI, the solution must remain
a single full-stack TypeScript application with clear server-side
boundaries.

- Keep the parsing and matching engine deterministic and self-contained.
- Avoid external queues unless they are absolutely necessary.
- Use persisted job records and polling for long-running work.
- Use built-in database, file storage, secrets, and server functions
  instead of introducing many external services.
- Prefer simple modules over deep framework abstractions.
- Keep all threshold values and aliases in tables or settings so Bolt
  can adjust behavior without code changes.

---

## 17. Risks and mitigation

| Risk | Mitigation |
|------|-------------|
| Many bank templates and frequent template drift | Use Statement Profiles, versioning, draft mode, and admin overrides. |
| Repeated amounts create false matches | Use global assignment, not greedy row-by-row matching. |
| Low-quality imports due to messy files | Use confidence scoring, row-level error isolation, and profile statistics. |
| Export service failure | Use CSV fallback and retry with limited exponential backoff. |
| Operational burden on support | Provide admin tools, evidence views, and profile management. |
| Bolt runtime constraints on long jobs | Use job records, chunked processing, and deterministic server-side modules. |

---

## 18. Definition of Done

- A new user can start the bot, consent, upload both files, run
  reconciliation, and get a usable report without human intervention.

- The system can process at least five bank templates and create a draft
  profile for unknown templates.

- Every reconciliation run stores evidence, metrics, and visible result
  statuses.

- Trial, payment, expiry, and reminders work end to end.

- Admin commands can inspect errors and manage profiles without exposing
  sensitive raw data.

- The test suite covers import, reconciliation, export, access control,
  and error handling.

---

## 19. Final recommendation

The safest and most scalable MVP architecture is not an AI parser that
guesses everything. It is a deterministic pipeline with canonical
transactions, reusable statement profiles, confidence thresholds, and a
global reconciliation engine. This design is realistic for Bolt AI,
practical for real bank statements, and extensible enough to support
future banks and future export formats without rewriting the core.

**End of Tech Plan v4.2**
```