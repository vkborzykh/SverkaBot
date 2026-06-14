import { pgEnum } from 'drizzle-orm/pg-core';

export const subscriptionStatusEnum = pgEnum('subscription_status_enum', [
  'TRIAL',
  'ACTIVE',
  'EXPIRED',
]);

export const importSourceEnum = pgEnum('import_source_enum', ['WB', 'BANK']);

export const importStatusEnum = pgEnum('import_status_enum', [
  'RECEIVED',
  'ANALYZING',
  'PARSING',
  'COMPLETED',
  'FAILED',
]);

export const qualityStatusEnum = pgEnum('quality_status_enum', [
  'HIGH_CONFIDENCE',
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

export const reconciliationStatusEnum = pgEnum('reconciliation_status_enum', [
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
]);

export const matchTypeEnum = pgEnum('match_type_enum', [
  'MATCHED',
  'UNMATCHED',
  'AMBIGUOUS',
  'SPLIT_MATCHED',
  'COMBINED_MATCHED',
]);

export const reportTypeEnum = pgEnum('report_type_enum', [
  'ZIP',
  'GOOGLE_SHEETS',
]);

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
