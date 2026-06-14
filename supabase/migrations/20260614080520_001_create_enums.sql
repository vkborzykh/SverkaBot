DO $$ BEGIN
  CREATE TYPE subscription_status_enum AS ENUM ('TRIAL', 'ACTIVE', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE import_source_enum AS ENUM ('WB', 'BANK');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE import_status_enum AS ENUM ('RECEIVED', 'ANALYZING', 'PARSING', 'COMPLETED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE quality_status_enum AS ENUM ('HIGH_CONFIDENCE', 'LOW_CONFIDENCE', 'MANUAL_REVIEW');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE profile_status_enum AS ENUM ('ACTIVE', 'DRAFT', 'DEPRECATED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE file_type_enum AS ENUM ('CSV', 'XLSX');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE transaction_direction_enum AS ENUM ('IN', 'OUT');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE reconciliation_status_enum AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE match_type_enum AS ENUM ('MATCHED', 'UNMATCHED', 'AMBIGUOUS', 'SPLIT_MATCHED', 'COMBINED_MATCHED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE report_type_enum AS ENUM ('ZIP', 'GOOGLE_SHEETS');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE payment_status_enum AS ENUM ('PENDING', 'SUCCESS', 'FAILED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE job_status_enum AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');
EXCEPTION WHEN duplicate_object THEN null; END $$;
