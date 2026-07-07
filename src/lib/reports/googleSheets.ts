// Создание read-only Google-таблицы по сверке. Лёгкий стек:
// google-auth-library (JWT сервис-аккаунта) + REST-вызовы Sheets/Drive API.
// Env: GOOGLE_SERVICE_ACCOUNT_JSON (весь JSON ключа), GOOGLE_SHEETS_FOLDER_ID (опц.).

import { JWT } from 'google-auth-library';
import type { WbCsvRow } from './csvExport';

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
];
const MAX_SHEET_ROWS = 5000; // защита квот и maxDuration воркера

export interface SheetsRunSummary {
  runIdShort: string;
  dateStr: string;
  cabinetName: string | null;
  expectedKopeks: bigint;
  receivedKopeks: bigint;
  lossKopeks: bigint;
  matchRate: string; // '98.5'
}

function getClient(): JWT {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not set');
  const creds = JSON.parse(raw) as { client_email: string; private_key: string };
  return new JWT({ email: creds.client_email, key: creds.private_key, scopes: SCOPES });
}

function rubNum(kopeks: bigint): number {
  // Для Sheets отдаём число (2 знака); bigint → number безопасен для сумм селлера
  return Number(kopeks) / 100;
}

async function api<T>(client: JWT, url: string, method: 'POST' | 'PATCH', data: unknown): Promise<T> {
  const res = await client.request<T>({ url, method, data });
  return res.data;
}

/** Создаёт таблицу с двумя листами, заливает данные, форматирует,
 *  открывает доступ по ссылке (reader) и возвращает URL. */
export async function createSpreadsheetForRun(
  summary: SheetsRunSummary,
  rows: WbCsvRow[],
): Promise<string> {
  const client = getClient();
  const title = `Сверка WB ${summary.runIdShort} от ${summary.dateStr}` +
    (summary.cabinetName ? ` — ${summary.cabinetName}` : '');

  // 1. Создание книги с листами
  const created = await api<{ spreadsheetId: string; sheets: { properties: { sheetId: number; title: string } }[] }>(
    client,
    'https://sheets.googleapis.com/v4/spreadsheets',
    'POST',
    {
      properties: { title, locale: 'ru_RU' },
      sheets: [
        { properties: { title: 'Сводка' } },
        { properties: { title: 'Отчёт WB', gridProperties: { frozenRowCount: 1 } } },
      ],
    },
  );
  const id = created.spreadsheetId;
  const wbSheetId = created.sheets.find((s) => s.properties.title === 'Отчёт WB')!.properties.sheetId;

  // 2. Перенос в служебную папку (опционально)
  const folderId = process.env.GOOGLE_SHEETS_FOLDER_ID;
  if (folderId) {
    await api(
      client,
      `https://www.googleapis.com/drive/v3/files/${id}?addParents=${folderId}&removeParents=root&supportsAllDrives=true`,
      'PATCH',
      {},
    );
  }

  // 3. Данные
  const capped = rows.slice(0, MAX_SHEET_ROWS);
  const summaryValues = [
    ['Сверка', summary.runIdShort],
    ['Дата', summary.dateStr],
    ['Кабинет', summary.cabinetName ?? '—'],
    ['Ожидалось к выплате, ₽', rubNum(summary.expectedKopeks)],
    ['Поступило, ₽', rubNum(summary.receivedKopeks)],
    ['Неподтверждённые выплаты, ₽', rubNum(summary.lossKopeks)],
    ['Совпадение, %', summary.matchRate],
    ...(rows.length > capped.length
      ? [['Внимание', `Показаны первые ${capped.length} из ${rows.length} строк`]]
      : []),
  ];
  const wbValues = [
    ['Дата', 'Тип', 'Сумма, ₽', 'Назначение', 'Номер поставки (SRID)', 'Кабинет', 'Статус сверки'],
    ...capped.map((r) => [
      r.dateStr,
      r.type,
      rubNum(r.amountKopeks),
      r.description ?? '',
      r.srid ?? '',
      r.cabinetName ?? '',
      r.matchStatus,
    ]),
  ];
  await api(client, `https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchUpdate`, 'POST', {
    valueInputOption: 'RAW',
    data: [
      { range: 'Сводка!A1', values: summaryValues },
      { range: "'Отчёт WB'!A1", values: wbValues },
    ],
  });

  // 4. Форматирование: жирная шапка, числовой формат сумм, автоширина
  await api(client, `https://sheets.googleapis.com/v4/spreadsheets/${id}:batchUpdate`, 'POST', {
    requests: [
      {
        repeatCell: {
          range: { sheetId: wbSheetId, startRowIndex: 0, endRowIndex: 1 },
          cell: { userEnteredFormat: { textFormat: { bold: true } } },
          fields: 'userEnteredFormat.textFormat.bold',
        },
      },
      {
        repeatCell: {
          range: { sheetId: wbSheetId, startRowIndex: 1, startColumnIndex: 2, endColumnIndex: 3 },
          cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '# ##0,00 "₽"' } } },
          fields: 'userEnteredFormat.numberFormat',
        },
      },
      {
        autoResizeDimensions: {
          dimensions: { sheetId: wbSheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 7 },
        },
      },
    ],
  });

  // 5. Read-only доступ по ссылке (Tech Plan §9.2)
  await api(client, `https://www.googleapis.com/drive/v3/files/${id}/permissions?supportsAllDrives=true`, 'POST', {
    role: 'reader',
    type: 'anyone',
  });

  return `https://docs.google.com/spreadsheets/d/${id}`;
}

/** Удаление таблицы (retention-cleanup). URL → id → drive.files.delete. */
export async function deleteSpreadsheetByUrl(url: string): Promise<void> {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!m) return;
  const client = getClient();
  await client.request({
    url: `https://www.googleapis.com/drive/v3/files/${m[1]}?supportsAllDrives=true`,
    method: 'DELETE',
  });
}
