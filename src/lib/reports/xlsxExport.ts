// src/lib/reports/xlsxExport.ts
import * as XLSX from 'xlsx';
import { collectWbCsvRows, type WbCsvRow } from './csvExport';

export async function buildXlsxForRun(run: {
  id: string;
  wb_import_id: string;
}): Promise<Buffer> {
  const rows: WbCsvRow[] = await collectWbCsvRows(run);

  const header = ['Дата', 'Тип', 'Сумма', 'Назначение', 'Номер поставки (SRID)', 'Кабинет', 'Статус сверки'];
  const data = rows.map(r => [
    r.dateStr,
    r.type,
    Number(r.amountKopeks) / 100, // рубли числом
    r.description ?? '',
    r.srid ?? '',
    r.cabinetName ?? '',
    r.matchStatus,
  ]);

  const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Сверка');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}
