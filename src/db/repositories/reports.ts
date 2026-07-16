import { eq, and, isNull, sql } from 'drizzle-orm';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { getDb } from '../index';
import { reports } from '../schema';

export type Report = InferSelectModel<typeof reports>;
export type NewReport = InferInsertModel<typeof reports>;

export async function findPrimaryReportByRunId(
  runId: string,
): Promise<Report | undefined> {
  const db = getDb();
  const rows = await db
    .select()
    .from(reports)
    .where(
      and(
        eq(reports.run_id, runId),
        eq(reports.is_primary, true),
        isNull(reports.deleted_at),
      ),
    )
    .limit(1);
  return rows[0];
}

export async function findReportsByRunId(runId: string): Promise<Report[]> {
  const db = getDb();
  return db
    .select()
    .from(reports)
    .where(and(eq(reports.run_id, runId), isNull(reports.deleted_at)));
}

export async function createReport(data: NewReport): Promise<Report> {
  const db = getDb();
  const rows = await db.insert(reports).values(data).returning();
  return rows[0];
}

export async function softDeleteReport(id: string): Promise<Report | undefined> {
  const db = getDb();
  const rows = await db
    .update(reports)
    .set({ deleted_at: new Date() })
    .where(eq(reports.id, id))
    .returning();
  return rows[0];
}

/** Отчёт конкретного типа по сверке (например, CSV). */
export async function findReportByRunIdAndType(
  runId: string,
  exportType: 'HTML' | 'GOOGLE_SHEETS' | 'CSV',
) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(reports)
    .where(
      and(
        eq(reports.run_id, runId),
        eq(reports.export_type, exportType),
        isNull(reports.deleted_at),
      ),
    )
    .limit(1);
  return row;
}

/**
 * Находит записи reports с указанным export_type,
 * у которых истёк срок хранения (created_at + retention_days < NOW()).
 */
export async function findExpiredReportsByType(
  exportType: 'HTML' | 'GOOGLE_SHEETS' | 'CSV',
) {
  const db = getDb();
  return db
    .select()
    .from(reports)
    .where(
      and(
        eq(reports.export_type, exportType),
        isNull(reports.deleted_at),
        sql`${reports.created_at} + make_interval(days => COALESCE(${reports.retention_days}, 180)) < NOW()`,
      ),
    );
}
