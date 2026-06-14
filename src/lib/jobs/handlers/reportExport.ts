import type { Job } from '@/src/db/repositories/jobs';

export async function handleReportExport(job: Job): Promise<void> {
  // Stub: real implementation will generate CSV artifacts and upload to storage.
  // Idempotency: check reports.storage_path before regenerating.
  console.log(`[report_export] job=${job.id} entity=${job.entity_id}`);
}
