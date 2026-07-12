// src/app/api/telegram/webhook/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ ok: true, hint: 'telegram webhook endpoint (POST only)' });
}

export async function POST(req: NextRequest) {
  return NextResponse.json({ ok: true });
}
