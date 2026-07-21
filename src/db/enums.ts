import { pgEnum } from 'drizzle-orm/pg-core';

export const subscriptionStatusEnum = pgEnum('subscription_status_enum', [
  'TRIAL',
  'ACTIVE',
  'EXPIRED',
]);

export const importSourceEnum = pgEnum('import_source_enum', ['WB', 'BANK']);

// NEW: business source of marketplace data — separate from source_type.
export const marketplaceEnum = pgEnum('marketplace_enum', [
  'WB',
  'OZON',
  'YANDEX',
  'MEGAMARKET',
]);

// ANALYZING is actively set by parseWb.ts/parseBank.ts during processing
// (alongside PARSING) — not a historical artifact. CANCELLED added.
export const importStatusEnum = pgEnum('import_status_enum', [
  'RECEIVED',
  'ANALYZING',
  'PARSING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);

// HIGH_CONFIDENCE renamed to NORMAL in DB (Phase 2). Position preserved by RENAME.
export const qualityStatusEnum = pgEnum('quality_status_enum', [
  'NORMAL',
  'LOW_CONFIDENCE',
  'MANUAL_REVIEW',
]);

export const profileStatusEnum = pgEnum('profile_status_enum', [
  'ACTIVE',
  'DRAFT',
  'DEPRECATED',
]);

export const fileTypeEnum = pgEnum('file_type_enum', ['CSV', 'XLSX']);

export const transactionDirectionEnum = pgEnum('transaction_direction_enum', [
  'IN',
  'OUT',
]);

// CANCELLED added.
export const reconciliationStatusEnum = pgEnum('reconciliation_status_enum', [
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);

export const matchTypeEnum = pgEnum('match_type_enum', [
  'MATCHED',
  'UNMATCHED',
  'AMBIGUOUS',
  'SPLIT_MATCHED',
  'COMBINED_MATCHED',
]);

// HTML added (primary format). ZIP kept as a historical artifact.
export const reportTypeEnum = pgEnum('report_type', ['HTML', 'GOOGLE_SHEETS', 'CSV']);

// payment_status enrichment (SUCCEEDED/REFUNDED/CANCELLED) deferred to Phase 4.
export const paymentStatusEnum = pgEnum('payment_status_enum', [
  'PENDING',
  'SUCCESS',
  'FAILED',
]);

export const jobStatusEnum = pgEnum('job_status_enum', [
  'PENDING',
  'RUNNING',
  'DONE',
  'FAILED',
]);
