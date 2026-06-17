import { sql } from 'drizzle-orm';
import { getDb } from '@/src/db/index';
import { findUserById } from '@/src/db/repositories/users';
import { deleteFile, deleteDirectory } from '@/src/lib/ingestion/storage';

export interface DeletionSummary {
  importCount: number;
  runCount: number;
}

export async function deleteUserData(userId: string): Promise<DeletionSummary> {
  const db = getDb();

  const user = await findUserById(userId);
  if (!user) throw new Error(`User not found: ${userId}`);

  // a) Active imports of the user
  const importRows = await db.execute(
    sql`SELECT id, storage_path FROM imports WHERE user_id = ${userId} AND deleted_at IS NULL`,
  );
  const importIds = importRows.map((r: Record<string, unknown>) => String(r.id));
  const importPaths = importRows
    .map((r: Record<string, unknown>) => r.storage_path as string | null)
    .filter(Boolean) as string[];

  // Count runs (independent of whether they produced reports)
  const runCountRows = await db.execute(
    sql`SELECT count(*)::int AS c FROM reconciliation_runs WHERE user_id = ${userId}`,
  );
  const runCount = Number((runCountRows as unknown as Array<{ c: number }>)[0]?.c ?? 0);

  // Nothing to delete → tell the caller, don't anonymize a bare account.
  if (importIds.length === 0 && runCount === 0) {
    return { importCount: 0, runCount: 0 };
  }

  // Report storage paths (before cascade removes the rows)
  const reportRows = await db.execute(
    sql`SELECT r.storage_path, rr.id AS run_id
        FROM reports r
        JOIN reconciliation_runs rr ON r.run_id = rr.id
        WHERE rr.user_id = ${userId} AND r.storage_path IS NOT NULL`,
  );
  const reportPaths = reportRows.map((r: Record<string, unknown>) => r.storage_path as string);
  const runIds = Array.from(
    new Set(reportRows.map((r: Record<string, unknown>) => String(r.run_id))),
  );

  // b) Delete physical files — resilient: a missing/failed object must not abort deletion.
  const safeDelete = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      console.error('[deletion] storage cleanup failed (continuing):', err);
    }
  };
  for (const path of importPaths) await safeDelete(() => deleteFile(path));
  for (const path of reportPaths) await safeDelete(() => deleteFile(path));
  for (const runId of runIds) await safeDelete(() => deleteDirectory(`reports/${runId}`));

  // c) Hard-delete canonical_transactions for the user's imports
  if (importIds.length > 0) {
    await db.execute(
      sql`DELETE FROM canonical_transactions WHERE import_id IN (
        SELECT id FROM imports WHERE user_id = ${userId}
      )`,
    );
    await db.execute(
      sql`DELETE FROM parsing_errors WHERE import_id IN (
        SELECT id FROM imports WHERE user_id = ${userId}
      )`,
    );
  }

  // d) Hard-delete runs (cascades to candidates, matches, match_items, evidence, reports)
  await db.execute(sql`DELETE FROM reconciliation_runs WHERE user_id = ${userId}`);

  // e) Billing
  await db.execute(sql`DELETE FROM billing_transactions WHERE user_id = ${userId}`);

  // f) Soft-delete imports
  await db.execute(
    sql`UPDATE imports SET deleted_at = now() WHERE user_id = ${userId} AND deleted_at IS NULL`,
  );

  // g) Anonymize audit_events + log the deletion
  await db.execute(sql`UPDATE audit_events SET user_id = NULL WHERE user_id = ${userId}`);
  await db.execute(
    sql`INSERT INTO audit_events (event_type, old_state, created_at)
        VALUES ('data_deleted', ${JSON.stringify({ anonymized_user_id: userId })}::jsonb, now())`,
  );

  // h) Consents
  await db.execute(sql`DELETE FROM consents WHERE user_id = ${userId}`);

  // i) Anonymize the user record.
  // IMPORTANT: do NOT null trial_expires_at / subscription_end_date here — the
  // users CHECK requires EXPIRED to keep at least one of those dates, so nulling
  // both (as before) made every deletion fail. Dates are not PII; we keep them.
  const negativeTelegramId = user.telegram_id ? -user.telegram_id : null;
  await db.execute(
    sql`UPDATE users SET
        username = NULL,
        telegram_id = ${negativeTelegramId},
        consent_given_at = NULL,
        subscription_status = 'EXPIRED',
        last_update_id = NULL,
        deleted_at = now(),
        updated_at = now()
      WHERE id = ${userId}`,
  );

  return { importCount: importIds.length, runCount };
}
