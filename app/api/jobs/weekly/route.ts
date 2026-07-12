import { enqueue } from '@/src/lib/jobs/queue';

export const runtime = 'edge';

export async function GET() {
  try {
    await enqueue('weekly_digest', crypto.randomUUID(), {});
    return new Response('ok', { status: 200 });
  } catch (e) {
    console.error('Failed to enqueue weekly_digest:', e);
    return new Response('error', { status: 500 });
  }
}
