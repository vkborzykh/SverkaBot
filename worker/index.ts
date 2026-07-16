// Backend entrypoint — runs on the always-on host (Oracle VM):
//   npm run worker
//
//   - starts the BullMQ worker (processes parse_wb, parse_bank, reconcile,
//     report_export, file_cleanup, reminders)
//   - starts the DB → Bull poller (bridges PENDING job rows into BullMQ)
//   - exposes a tiny /health endpoint
//   - shuts down gracefully on SIGTERM/SIGINT (drains in-flight jobs)

import 'dotenv/config';
import { createServer } from 'node:http';
import { startWorker } from '@/src/lib/jobs/bull/worker';
import { startPoller, stopPoller } from '@/src/lib/jobs/bull/poller';
import { closeRedisConnection } from '@/src/lib/jobs/bull/connection';

const worker = startWorker();
startPoller();
console.log('[backend] worker + poller started');

// ── Health endpoint ───────────────────────────────────────────────────────────
const port = Number(process.env.WORKER_HEALTH_PORT ?? '8080');
const health = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', running: worker.isRunning() }));
    return;
  }
  res.writeHead(404);
  res.end();
});
health.listen(port, () => console.log(`[backend] health on :${port}/health`));

// ── Graceful shutdown ─────────────────────────────────────────────────────────
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[backend] ${signal} received, shutting down...`);
  try {
    stopPoller();
    await worker.close(); // waits for in-flight jobs
    health.close();
    await closeRedisConnection();
    console.log('[backend] shutdown complete');
    process.exit(0);
  } catch (err) {
    console.error('[backend] shutdown error:', err);
    process.exit(1);
  }
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
