import type { Job } from '@/src/db/repositories/jobs';
import { findExpiredReportsByType, softDeleteReport } from '@/src/db/repositories/reports';
import { deleteSpreadsheetByUrl } from '@/src/lib/reports/googleSheets';

export async function handleFileCleanup(job: Job): Promise<void> {
  console.log(`[file_cleanup] job=${job.id} entity=${job.entity_id}`);

  // 1. Удаление устаревших Google Sheets из Drive
  try {
    const expiredSheets = await findExpiredReportsByType('GOOGLE_SHEETS');
    for (const report of expiredSheets) {
      try {
        if (report.storage_path) {
          await deleteSpreadsheetByUrl(report.storage_path);
        }
        await softDeleteReport(report.id);
      } catch (err) {
        console.error('[file_cleanup] sheets delete failed:', report.id, err);
      }
    }
  } catch (err) {
    console.error('[file_cleanup] sheets retention step failed:', err);
  }

  // 2. Очистка файлов Storage для soft-deleted импортов (реализовать по необходимости)
  // ...
}
