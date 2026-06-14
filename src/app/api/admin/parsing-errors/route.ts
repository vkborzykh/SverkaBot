import { NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';
import { requireAdminToken } from '@/src/lib/guards';
import { okResponse } from '@/src/lib/http';
import { getDb } from '@/src/db/index';

export async function GET(req: NextRequest) {
  const guard = requireAdminToken(req);
  if (guard) return guard;

  const limit = Math.min(
    Number(req.nextUrl.searchParams.get('limit') ?? '50'),
    200,
  );

  const db = getDb();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const errors = await db.execute(sql`
    SELECT
      id,
      import_id,
      row_number,
      error_code,
      error_message,
      LEFT(raw_fragment, 200) AS raw_fragment,
      created_at
    FROM parsing_errors
    WHERE created_at >= ${thirtyDaysAgo}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `);

  return okResponse({ errors });
}
