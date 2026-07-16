import { NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';
import { requireAdminToken } from '@/src/lib/guards';
import { okResponse } from '@/src/lib/http';
import { getDb } from '@/src/db/index';

export async function GET(req: NextRequest) {
  const guard = requireAdminToken(req);
  if (guard) return guard;

  const db = getDb();

  const [funnel, importQuality, reconQuality, monetization] = await Promise.all([
    computeFunnel(db),
    computeImportQuality(db),
    computeReconciliationQuality(db),
    computeMonetization(db),
  ]);

  return okResponse({
    funnel,
    import_quality: importQuality,
    reconciliation_quality: reconQuality,
    monetization,
  });
}

async function computeFunnel(db: ReturnType<typeof getDb>) {
  const result = await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM users WHERE deleted_at IS NULL) AS registrations,
      (SELECT count(*)::int FROM users WHERE consent_given_at IS NOT NULL AND deleted_at IS NULL) AS consents,
      (SELECT count(*)::int FROM imports WHERE deleted_at IS NULL) AS uploads,
      (SELECT count(*)::int FROM reconciliation_runs) AS reconciliations
  `);
  const row = result[0] ?? {};
  return {
    registrations: Number(row.registrations ?? 0),
    consents: Number(row.consents ?? 0),
    uploads: Number(row.uploads ?? 0),
    reconciliations: Number(row.reconciliations ?? 0),
  };
}

async function computeImportQuality(db: ReturnType<typeof getDb>) {
  const result = await db.execute(sql`
    SELECT
      COALESCE(AVG(parse_success_rate), 0)::numeric(5,2) AS parse_success_rate_avg,
      COALESCE(
        (SELECT count(*)::float FROM imports WHERE quality_status IN ('LOW_CONFIDENCE', 'MANUAL_REVIEW') AND status = 'COMPLETED' AND deleted_at IS NULL)
        / NULLIF((SELECT count(*)::float FROM imports WHERE status = 'COMPLETED' AND deleted_at IS NULL), 0)
        * 100, 0
      )::numeric(5,2) AS low_confidence_rate
    FROM imports
    WHERE status = 'COMPLETED' AND deleted_at IS NULL
  `);
  const row = result[0] ?? {};
  return {
    parse_success_rate_avg: Number(row.parse_success_rate_avg ?? 0),
    low_confidence_rate: Number(row.low_confidence_rate ?? 0),
  };
}

async function computeReconciliationQuality(db: ReturnType<typeof getDb>) {
  const result = await db.execute(sql`
    SELECT
      COALESCE(AVG(match_rate), 0)::numeric(5,2) AS match_rate_avg,
      COALESCE(
        AVG(
          CASE WHEN total_wb_rows > 0
            THEN (ambiguous_count::float / total_wb_rows * 100)
            ELSE 0
          END
        ), 0
      )::numeric(5,2) AS ambiguous_rate
    FROM reconciliation_runs
    WHERE status = 'COMPLETED'
  `);
  const row = result[0] ?? {};
  return {
    match_rate_avg: Number(row.match_rate_avg ?? 0),
    ambiguous_rate: Number(row.ambiguous_rate ?? 0),
  };
}

async function computeMonetization(db: ReturnType<typeof getDb>) {
  const result = await db.execute(sql`
    SELECT
      COALESCE(
        (SELECT count(DISTINCT id)::float FROM users WHERE subscription_status = 'ACTIVE' AND deleted_at IS NULL)
        / NULLIF((SELECT count(DISTINCT id)::float FROM users WHERE deleted_at IS NULL), 0)
        * 100, 0
      )::numeric(5,2) AS trial_to_paid_conversion,
      COALESCE(
        (SELECT count(*)::float FROM (
          SELECT user_id FROM reconciliation_runs GROUP BY user_id HAVING count(*) >= 2
        ) sub)
        / NULLIF((SELECT count(DISTINCT user_id)::float FROM reconciliation_runs), 0)
        * 100, 0
      )::numeric(5,2) AS repeat_reconciliation_rate
  `);
  const row = result[0] ?? {};
  return {
    trial_to_paid_conversion: Number(row.trial_to_paid_conversion ?? 0),
    repeat_reconciliation_rate: Number(row.repeat_reconciliation_rate ?? 0),
  };
}
