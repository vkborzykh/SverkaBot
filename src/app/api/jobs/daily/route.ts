import { NextRequest } from 'next/server';
import { okResponse } from '@/src/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  return okResponse({ ok: true, test: 'daily stub' });
}

export async function GET(req: NextRequest) {
  return okResponse({ ok: true, test: 'daily stub' });
}
