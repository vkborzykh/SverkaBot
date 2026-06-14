import { NextRequest } from 'next/server';
import { okResponse } from '@/src/lib/http';

export async function POST(req: NextRequest) {
  // TODO: validate PAYMENT_PROVIDER_SECRET signature, update billing_transactions and subscription
  return okResponse({ received: true });
}
