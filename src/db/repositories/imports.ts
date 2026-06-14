import { eq, and, isNull } from 'drizzle-orm';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { getDb } from '../index';
import { imports } from '../schema';

export type Import = InferSelectModel<typeof imports>;
export type NewImport = InferInsertModel<typeof imports>;

export async function findImportById(id: string): Promise<Import | undefined> {
  const db = getDb();
  const rows = await db
    .select()
    .from(imports)
    .where(and(eq(imports.id, id), isNull(imports.deleted_at)))
    .limit(1);
  return rows[0];
}

export async function findImportsByUserId(
  userId: string,
  opts?: { sourceType?: 'WB' | 'BANK'; status?: string; limit?: number },
): Promise<Import[]> {
  const db = getDb();
  const conditions = [eq(imports.user_id, userId), isNull(imports.deleted_at)];
  if (opts?.sourceType) {
    conditions.push(eq(imports.source_type, opts.sourceType));
  }
  const q = db
    .select()
    .from(imports)
    .where(and(...conditions))
    .orderBy(imports.created_at);
  return opts?.limit ? q.limit(opts.limit) : q;
}

export async function createImport(data: NewImport): Promise<Import> {
  const db = getDb();
  const rows = await db.insert(imports).values(data).returning();
  return rows[0];
}

export async function updateImport(
  id: string,
  data: Partial<Omit<NewImport, 'id' | 'created_at'>>,
): Promise<Import | undefined> {
  const db = getDb();
  const rows = await db
    .update(imports)
    .set(data)
    .where(eq(imports.id, id))
    .returning();
  return rows[0];
}

export async function softDeleteImport(id: string): Promise<Import | undefined> {
  const db = getDb();
  const rows = await db
    .update(imports)
    .set({ deleted_at: new Date() })
    .where(eq(imports.id, id))
    .returning();
  return rows[0];
}

export async function findImportByHash(
  userId: string,
  sourceType: 'WB' | 'BANK',
  fileHash: string,
): Promise<Import | undefined> {
  const db = getDb();
  const rows = await db
    .select()
    .from(imports)
    .where(
      and(
        eq(imports.user_id, userId),
        eq(imports.source_type, sourceType),
        eq(imports.file_hash, fileHash),
        isNull(imports.deleted_at),
      ),
    )
    .limit(1);
  return rows[0];
}
