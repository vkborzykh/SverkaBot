import type { Job } from '@/src/db/repositories/jobs';

export async function handleFileCleanup(job: Job): Promise<void> {
  // Stub: real implementation will delete physical files from storage for soft-deleted imports.
  console.log(`[file_cleanup] job=${job.id} entity=${job.entity_id}`);
}
