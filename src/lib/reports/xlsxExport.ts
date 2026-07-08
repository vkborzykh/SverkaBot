import * as XLSX from 'xlsx';
import { collectReconciliationData } from './csvExport';

export async function buildXlsxForRun(run: {
  id: string;
  wb_import_id: string;
  bank_import_id: string;
}): Promise<Buffer> {
  const data = await collectReconciliationData(run);

  const wb = XLSX.utils.book_new();

  // Лист «Сводка»
  const summaryRows = [
    ['Ожидалось к выплате', Number(data.summary.expectedKopeks) / 100],
    ['Поступило от WB', Number(data.summary.receivedKopeks) / 100],
    ['Расхождение', Number(data.summary.lossKopeks) / 100],
    ['Совпадение', data.summary.matchRate],
  ];
  if (data.cabinetName) {
    summaryRows.unshift(['Кабинет', data.cabinetName]);
  }

  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Сводка');

  // Лист «Отчёт WB»
  const wbHeader = ['Дата', 'Тип', 'Сумма', 'Назначение', 'Номер поставки'];
  const wbData = data.wbRows.map(r => [
    r.dateStr, r.type, Number(r.amountKopeks) / 100,
    r.description ?? '', r.srid ?? '',
  ]);
  const wsWb = XLSX.utils.aoa_to_sheet([wbHeader, ...wbData]);
  XLSX.utils.book_append_sheet(wb, wsWb, 'Отчёт WB');

  // Лист «Банк»
  const bankHeader = ['Дата', 'Сумма', 'Отправитель', 'Назначение', 'От WB'];
  const bankData = data.bankRows.map(r => [
    r.dateStr, Number(r.amountKopeks) / 100,
    r.counterparty ?? '', r.description ?? '',
    r.isWb ? 'Да' : 'Нет',
  ]);
  const wsBank = XLSX.utils.aoa_to_sheet([bankHeader, ...bankData]);
  XLSX.utils.book_append_sheet(wb, wsBank, 'Банк');

  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}
