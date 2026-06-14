/**
 * Seed script — inserts all settings from DB Draft v2.4 idempotently.
 * Run via: npm run db:seed
 */
import 'dotenv/config';
import { getDb } from './index';
import { settings } from './schema';
import { sql } from 'drizzle-orm';

const SEED_SETTINGS = [
  { key: 'date_window_days', value_json: 7, description: 'Date window (days) for candidate generation (±N days around WB date)' },
  { key: 'amount_weight', value_json: 0.5, description: 'Weight of amount score in reconciliation scoring' },
  { key: 'date_weight', value_json: 0.3, description: 'Weight of date score in reconciliation scoring' },
  { key: 'reference_weight', value_json: 0.1, description: 'Weight of reference score in reconciliation scoring' },
  { key: 'description_weight', value_json: 0.05, description: 'Weight of description score in reconciliation scoring' },
  { key: 'counterparty_weight', value_json: 0.05, description: 'Weight of counterparty score in reconciliation scoring' },
  { key: 'split_combined_max_rows', value_json: 3, description: 'Maximum rows per split/combined match cluster' },
  { key: 'low_confidence_threshold', value_json: 0.6, description: 'Profile confidence below this value → LOW_CONFIDENCE quality status' },
  { key: 'high_confidence_success_rate_threshold', value_json: 90, description: 'parse_success_rate >= this value → HIGH_CONFIDENCE (when profile confidence also passes)' },
  { key: 'manual_review_success_rate_threshold', value_json: 70, description: 'parse_success_rate < this value → MANUAL_REVIEW; import still completes' },
] as const;

async function seed() {
  const db = getDb();

  for (const row of SEED_SETTINGS) {
    await db
      .insert(settings)
      .values({
        key: row.key,
        value_json: row.value_json,
        description: row.description,
      })
      .onConflictDoNothing({ target: settings.key });
  }

  console.log(`Seeded ${SEED_SETTINGS.length} settings rows (ON CONFLICT DO NOTHING).`);
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
