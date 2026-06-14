import { NextRequest } from 'next/server';
import { isNull } from 'drizzle-orm';
import { requireAdminToken } from '@/src/lib/guards';
import { okResponse } from '@/src/lib/http';
import { getDb } from '@/src/db/index';
import { statement_profiles } from '@/src/db/schema';

export async function GET(req: NextRequest) {
  const guard = requireAdminToken(req);
  if (guard) return guard;

  const db = getDb();
  const profiles = await db
    .select()
    .from(statement_profiles)
    .where(isNull(statement_profiles.deleted_at))
    .orderBy(statement_profiles.created_at);

  return okResponse({ profiles });
}
