import { db } from '@/src/db/client';
import { wb_cabinets } from '@/src/db/schema';
import { and, eq, isNull, asc, count } from 'drizzle-orm';

export type WbCabinet = typeof wb_cabinets.$inferSelect;

export async function createCabinet(input: {
  user_id: string;
  name: string;
}): Promise<WbCabinet> {
  const [row] = await db
    .insert(wb_cabinets)
    .values({ user_id: input.user_id, name: input.name })
    .returning();
  return row;
}

/** Активные (неудалённые) кабинеты пользователя, старые первыми. */
export async function findCabinetsByUserId(userId: string): Promise<WbCabinet[]> {
  return db
    .select()
    .from(wb_cabinets)
    .where(and(eq(wb_cabinets.user_id, userId), isNull(wb_cabinets.deleted_at)))
    .orderBy(asc(wb_cabinets.created_at));
}

export async function findCabinetById(id: string): Promise<WbCabinet | undefined> {
  const [row] = await db
    .select()
    .from(wb_cabinets)
    .where(and(eq(wb_cabinets.id, id), isNull(wb_cabinets.deleted_at)))
    .limit(1);
  return row;
}

export async function countCabinetsByUserId(userId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(wb_cabinets)
    .where(and(eq(wb_cabinets.user_id, userId), isNull(wb_cabinets.deleted_at)));
  return Number(row?.value ?? 0);
}

/** Мягкое удаление: история импортов и сверок по кабинету сохраняется. */
export async function softDeleteCabinet(id: string): Promise<void> {
  await db
    .update(wb_cabinets)
    .set({ deleted_at: new Date(), updated_at: new Date() })
    .where(eq(wb_cabinets.id, id));
}
