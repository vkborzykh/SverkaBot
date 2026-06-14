import { eq, and, isNull } from 'drizzle-orm';
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
