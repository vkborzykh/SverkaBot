import { eq, and, asc } from 'drizzle-orm';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { getDb } from '../index';
import { jobs } from '../schema';

export type Job = InferSelectModel<typeof jobs>;
export type NewJob = InferInsertModel<typeof jobs>;

export async function createJob(data: NewJob): Promise<Job> {
  const db = getDb();
  const rows = await db.insert(jobs).values(data).returning();
  return rows[0];
}

export async function findJobById(id: string): Promise<Job | undefined> {
  const db = getDb();
  const rows = await db
    .select()
    .from(jobs)
    .where(eq(jobs.id, id))
    .limit(1);
  return rows[0];
}

export async function findPendingJobs(jobType?: string): Promise<Job[]> {
  const db = getDb();
  const conditions = [eq(jobs.status, 'PENDING')];
  if (jobType) {
    conditions.push(eq(jobs.job_type, jobType));
  }
  return db
    .select()
    .from(jobs)
    .where(and(...conditions))
    .orderBy(asc(jobs.created_at));
}

export async function updateJob(
  id: string,
  data: Partial<Omit<NewJob, 'id' | 'created_at'>>,
): Promise<Job | undefined> {
  const db = getDb();
  const rows = await db
    .update(jobs)
    .set(data)
    .where(eq(jobs.id, id))
    .returning();
  return rows[0];
}
