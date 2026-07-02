import * as XLSX from 'xlsx';

interface ContentCheckResult {
  valid: boolean;
  reason?: string;
}

const WB_KEYWORDS = [
  'к перечислению продавцу', 'к перечислению', 'к выплате',
  'сумма к выплате', 'дата продажи', 'номер поставки', 'srid',
];

const BANK_KEYWORDS = [
  'дата', 'сумма', 'дебет', 'кредит', 'списание', 'поступление',
  'назначение', 'контрагент', 'описание', 'приход', 'расход',
  'date', 'amount', 'debit', 'credit', 'transaction', 'description',
  'время', 'инн', 'назначение платежа', 'корреспондент', 'бик',
  'тип операции', 'документ', 'номер документа', 'входящий остаток',
  'исходящий остаток', 'реквизиты', 'кпп', 'расчётный счёт',
  'банк', 'период', 'валюта',
];

function normalizeHeader(cell: unknown): string {
  return String(cell ?? '').trim().toLowerCase();
}

async function validateHeaders(
  headers: unknown[],
  expectedKeywords: string[],
  fileType: string,
): Promise<ContentCheckResult> {
  const lowerHeaders = headers.map(normalizeHeader);
  const found = expectedKeywords.some((kw) =>
    lowerHeaders.some((h) => h.includes(kw)),
  );

  if (found) {
    return { valid: true };
  }

  return {
    valid: false,
    reason:
      fileType === 'WB'
        ? 'Файл не похож на отчёт Wildberries. Проверьте, что вы загружаете правильный XLSX с колонками: дата, сумма к выплате.'
        : `Файл не похож на банковскую выписку. Найденные заголовки: ${lowerHeaders.join(', ')}. Ожидаются колонки: дата, сумма, контрагент.`,
  };
}

async function getHeadersFromXlsx(buffer: Buffer): Promise<unknown[]> {
  try {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return [];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as unknown[][];
    for (const row of rows) {
      if (row.some((c) => c !== null && c !== '')) {
        return row;
      }
    }
    return [];
  } catch {
    return [];
  }
}

async function getHeadersFromCsv(buffer: Buffer): Promise<unknown[]> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Papa = require('papaparse') as typeof import('papaparse');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const iconv = require('iconv-lite') as typeof import('iconv-lite');

    // Пробуем UTF-8. Если есть кириллица – используем её.
    const utf8Str = iconv.decode(buffer, 'utf-8');
    const hasCyrillic = /[а-яА-ЯёЁ]/.test(utf8Str);

    // Если UTF-8 не дал кириллицы, пробуем Windows-1251
    const str = hasCyrillic ? utf8Str : iconv.decode(buffer, 'windows-1251');
    if (!str) return [];

    const result = Papa.parse(str, {
      header: false,
      skipEmptyLines: true,
      preview: 5,
    });
    const rows = result.data as unknown[][];
    if (rows.length === 0) return [];
    for (const row of rows) {
      if (row.some((c) => c !== null && c !== '')) {
        return row;
      }
    }
    return [];
  } catch {
    return [];
  }
}

export async function validateFileContent(
  buffer: Buffer,
  ext: 'csv' | 'xlsx',
  sourceType: 'WB' | 'BANK',
): Promise<ContentCheckResult> {
  let headers: unknown[] = [];

  if (ext === 'xlsx') {
    headers = await getHeadersFromXlsx(buffer);
  } else {
    headers = await getHeadersFromCsv(buffer);
  }

  if (headers.length === 0) {
    return {
      valid: false,
      reason: 'Не удалось прочитать заголовки файла. Проверьте формат.',
    };
  }

  const keywords = sourceType === 'WB' ? WB_KEYWORDS : BANK_KEYWORDS;
  return validateHeaders(headers, keywords, sourceType);
}
