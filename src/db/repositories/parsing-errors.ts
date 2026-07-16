import { eq } from 'drizzle-orm';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { getDb } from '../index';
import { parsing_errors } from '../schema';

export type ParsingError = InferSelectModel<typeof parsing_errors>;
export type NewParsingError = InferInsertModel<typeof parsing_errors>;

export async function createParsingError(
  data: NewParsingError,
): Promise<ParsingError> {
  const db = getDb();
  const rows = await db.insert(parsing_errors).values(data).returning();
  return rows[0];
}

export async function createParsingErrors(
  data: NewParsingError[],
): Promise<ParsingError[]> {
  if (data.length === 0) return [];
  const db = getDb();
  return db.insert(parsing_errors).values(data).returning();
}

export async function findParsingErrorsByImportId(
  importId: string,
): Promise<ParsingError[]> {
  const db = getDb();
  return db
    .select()
    .from(parsing_errors)
    .where(eq(parsing_errors.import_id, importId))
    .orderBy(parsing_errors.row_number);
}
