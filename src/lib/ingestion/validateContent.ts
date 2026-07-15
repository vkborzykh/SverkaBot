// src/lib/ingestion/validateContent.ts
import * as XLSX from 'xlsx';

interface ContentCheckResult {
  valid: boolean;
  reason?: string;
}

// Максимальный допустимый суммарный размер распакованных записей XLSX
const MAX_UNCOMPRESSED_SIZE = 300 * 1024 * 1024; // 300 MB – для этапа A только лог

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

/**
 * Оценивает суммарный размер распакованных записей внутри XLSX-контейнера
 * по полям uncompressed size из Central Directory (конец ZIP-файла).
 * Возвращает размер в байтах или null при ошибке чтения.
 */
function estimateUncompressedSize(buffer: Buffer): number | null {
  try {
    if (buffer.length < 22) return null; // минимальный размер EOCD
    // Ищем сигнатуру End of Central Directory (0x06054b50) с конца
    let eocdOffset = -1;
    for (let i = buffer.length - 22; i >= 0; i--) {
      if (buffer[i] === 0x50 && buffer[i+1] === 0x4b && buffer[i+2] === 0x05 && buffer[i+3] === 0x06) {
        eocdOffset = i;
        break;
      }
    }
    if (eocdOffset === -1) return null;

    const centralDirOffset = buffer.readUInt32LE(eocdOffset + 16);
    const centralDirSize   = buffer.readUInt32LE(eocdOffset + 12);
    if (centralDirOffset + centralDirSize > buffer.length) return null;

    let totalUncompressed = 0;
    let pos = centralDirOffset;
    while (pos < centralDirOffset + centralDirSize) {
      if (buffer[pos] !== 0x50 || buffer[pos+1] !== 0x4b || buffer[pos+2] !== 0x01 || buffer[pos+3] !== 0x02) break;
      const uncompressedSize = buffer.readUInt32LE(pos + 24);
      totalUncompressed += uncompressedSize;
      const fileNameLen = buffer.readUInt16LE(pos + 28);
      const extraLen = buffer.readUInt16LE(pos + 30);
      const commentLen = buffer.readUInt16LE(pos + 32);
      pos += 46 + fileNameLen + extraLen + commentLen;
    }
    return totalUncompressed;
  } catch {
    return null;
  }
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

    const utf8Str = iconv.decode(buffer, 'utf-8');
    const hasCyrillic = /[а-яА-ЯёЁ]/.test(utf8Str);

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
  // Этап A (shadow-mode) защиты от zip-бомбы для XLSX
  if (ext === 'xlsx') {
    const uncompressedSize = estimateUncompressedSize(buffer);
    if (uncompressedSize !== null && uncompressedSize > MAX_UNCOMPRESSED_SIZE) {
      console.warn('[zip-guard] would reject', {
        uncompressedSize,
        compressedSize: buffer.length,
        ratio: (uncompressedSize / buffer.length).toFixed(1)
      });
      // На этом этапе файл не блокируется, логируем и продолжаем
    }
  }

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
