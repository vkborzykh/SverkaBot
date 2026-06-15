import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  console.log('✅ Test webhook called');
  return NextResponse.json({ ok: true, message: 'Test' });
}

export async function GET() {
  return NextResponse.json({ ok: true, message: 'GET test' });
}
