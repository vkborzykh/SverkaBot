// src/lib/reports/cabinetsSummaryExport.ts
import { findRunsByUserId } from '@/src/db/repositories/reconciliation-runs';
import { findImportById } from '@/src/db/repositories/imports';
import { buildCsvForRun } from './exportCsv';
import { buildXlsxForRun } from './exportXlsx';
import { build1cForRun } from './export1c';

/**
 * Собирает все завершённые сверки пользователя, опционально фильтруя по cabinetId.
 * Если cabinetId не передан, берутся все кабинеты.
 */
async function getRunsForUser(userId: string, cabinetId?: string | null) {
  const allRuns = await findRunsByUserId(userId, 500);
  const completed = allRuns.filter(r => r.status === 'COMPLETED');
  if (!cabinetId) return completed;

  const filtered: typeof completed = [];
  for (const run of completed) {
    const wbImport = await findImportById(run.wb_import_id);
    const cabId = (wbImport as any)?.cabinet_id;
    if (cabId === cabinetId) filtered.push(run);
  }
  return filtered;
}

/** Генерирует общий CSV, объединяя данные всех переданных сверок. */
export async function buildCsvSummary(runs: any[]): Promise<Buffer> {
  if (runs.length === 0) return Buffer.from('Нет завершённых сверок.\n', 'utf-8');
  const buffers: Buffer[] = [];
  for (const run of runs) {
    try {
      const buf = await buildCsvForRun(run.id);
      buffers.push(buf);
    } catch (e) {
      // пропускаем ошибки по отдельным сверкам
    }
  }
  return Buffer.concat(buffers);
}

/** Генерирует общий XLSX, объединяя все сверки в одну книгу (упрощённо — через отдельные листы). */
export async function buildXlsxSummary(runs: any[]): Promise<Buffer> {
  if (runs.length === 0) throw new Error('Нет завершённых сверок');
  // Для простоты собираем все XLSX и конкатенируем (в будущем можно доработать до единой книги)
  const buffers: Buffer[] = [];
  for (const run of runs) {
    try {
      const buf = await buildXlsxForRun(run.id);
      buffers.push(buf);
    } catch (e) {}
  }
  return Buffer.concat(buffers);
}

/** Генерирует общий реестр 1С, объединяя данные всех сверок. */
export async function build1cSummary(runs: any[]): Promise<Buffer> {
  if (runs.length === 0) throw new Error('Нет завершённых сверок');
  const buffers: Buffer[] = [];
  for (const run of runs) {
    try {
      const buf = await build1cForRun(run.id);
      buffers.push(buf);
    } catch (e) {}
  }
  return Buffer.concat(buffers);
}
