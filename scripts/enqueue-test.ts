// Liveness probe. Run ON THE VM (co-located with Redis):
//   npm run test:enqueue
//
// Pushes a job straight into BullMQ with a bogus dbJobId. The worker loads the
// DB row, finds nothing, and fails fast with "DB job ... not found" — proving
// the worker is alive and consuming, with zero side effects.

import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { addBullJob } from '@/src/lib/jobs/bull/queue';
import { closeRedisConnection } from '@/src/lib/jobs/bull/connection';

async function main(): Promise<void> {
  const bogus = randomUUID();
  console.log(`[test] enqueuing liveness job, bogus dbJobId=${bogus}`);
  await addBullJob(
    { dbJobId: bogus, jobType: 'file_cleanup', entityId: bogus, correlationId: null },
    { jobId: `liveness-${bogus}`, attempts: 1 }, // 1 attempt: no retry storm
  );
  console.log('[test] enqueued. Watch worker logs for: "DB job ... not found".');
  await closeRedisConnection();
  process.exit(0);
}

main().catch((err) => {
  console.error('[test] error:', err);
  process.exit(1);
});
