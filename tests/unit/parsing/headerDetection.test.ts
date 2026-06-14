import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import iconv from 'iconv-lite';
import {
  detectHeaderAndColumns,
  type HeaderDetectionResult,
} from '@/src/lib/parsing/headerDetection';

// ── Fixture builders ──────────────────────────────────────────────────────────

function buildXlsxBuffer(rows: unknown[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

function buildCsvBuffer(rows: string[][], encoding: 'utf8' | 'win1251' = 'utf8'): Buffer {
  const csv = rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
  if (encoding === 'win1251') {
    return iconv.encode(csv, 'windows-1251');
  }
  return Buffer.from(csv, 'utf8');
}

// ── Fixture 1: Sberbank-style XLSX — 3 metadata rows before header ────────────

const SBERBANK_ROWS: unknown[][] = [
  ['ПАО Сбербанк', null, null, null, null],
  ['Выписка по счёту 40817...', null, null, null, null],
  ['Период: 01.03.2025 - 31.03.2025', null, null, null, null],
  ['Дата операции', 'Сумма', 'Назначение платежа', 'Контрагент', 'Номер документа'],
  ['15.03.2025', '1 500,00', 'Оплата услуг', 'ООО Ромашка', 'ПП-123'],
  ['16.03.2025', '-250,00', 'Комиссия', 'Сбербанк', 'ПП-124'],
  ['20.03.2025', '3 200,00', 'Поступление', 'ИП Иванов', 'ПП-125'],
];

// ── Fixture 2: Simple UTF-8 CSV — header at row 0 ────────────────────────────

const SIMPLE_CSV_ROWS: string[][] = [
  ['Дата', 'Сумма', 'Описание'],
  ['01.03.2025', '5000.50', 'Перевод'],
  ['02.03.2025', '1200.00', 'Оплата'],
  ['03.03.2025', '-300.00', 'Списание'],
];

// ── Fixture 3: Tinkoff-style XLSX — header at row 0, European amount format ──

const TINKOFF_ROWS: unknown[][] = [
  ['Дата проводки', 'Дебет', 'Кредит', 'Описание', 'Плательщик'],
  ['15.03.2025', '1.500,00', null, 'Пополнение', 'Тинькофф'],
  ['16.03.2025', null, '250,00', 'Оплата', 'ООО Сервис'],
  ['17.03.2025', '3.200,00', null, 'Перевод', 'Иванов И.И.'],
];

// ── Fixture 4: Windows-1251 CSV ───────────────────────────────────────────────

const WIN1251_ROWS: string[][] = [
  ['Дата', 'Сумма', 'Назначение платежа', 'Контрагент'],
  ['01.03.2025', '10000,00', 'Оплата услуг', 'ООО Тест'],
  ['05.03.2025', '2500,50', 'Поступление', 'ИП Тестов'],
  ['10.03.2025', '-500,00', 'Комиссия банка', 'Банк'],
];

// ── Fixture 5: No table (free text) ──────────────────────────────────────────

const NO_TABLE_ROWS: string[][] = [
  ['Уважаемый клиент!'],
  ['Настоящим сообщаем вам об изменении тарифов.'],
  ['Для подробной информации обратитесь в отделение.'],
  ['С уважением, Служба поддержки.'],
  ['Тел: 8-800-555-35-35'],
];

// ── Fixture 6: Space-comma amounts with extra summary row ────────────────────

const SPACE_COMMA_ROWS: unknown[][] = [
  ['Входящий остаток на 01.03.2025', null, null, '50 000,00'],
  ['Дата', 'Сумма', 'Назначение', 'Номер'],
  ['01.03.2025', '10 000,00', 'Оплата', 'Д-001'],
  ['05.03.2025', '5 000,50', 'Перевод', 'Д-002'],
  ['10.03.2025', '-1 000,00', 'Списание', 'Д-003'],
  ['Итого:', '14 000,50', null, null],
];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('detectHeaderAndColumns', () => {
  it('Fixture 1: detects Sberbank-style XLSX with 3 metadata rows', async () => {
    const buf = buildXlsxBuffer(SBERBANK_ROWS);
    const result = await detectHeaderAndColumns(buf, 'xlsx');

    expect(result).not.toBeNull();
    const r = result as HeaderDetectionResult;

    expect(r.headerRowIndex).toBe(3);
    expect(r.confidence).toBeGreaterThan(0.7);
    // date column should reference "Дата операции"
    expect(String(r.columnMapping.dateColumn).toLowerCase()).toContain('дата');
    // amount column should reference "Сумма"
    expect(String(r.columnMapping.amountColumn).toLowerCase()).toContain('сумм');
    expect(r.columnMapping.descriptionColumn).toBeDefined();
    expect(r.columnMapping.counterpartyColumn).toBeDefined();
    expect(r.columnMapping.referenceColumn).toBeDefined();
    expect(r.dateFormat).toBe('DD.MM.YYYY');
    expect(r.signature).toBeTruthy();
  });

  it('Fixture 2: detects simple UTF-8 CSV with header at row 0', async () => {
    const buf = buildCsvBuffer(SIMPLE_CSV_ROWS, 'utf8');
    const result = await detectHeaderAndColumns(buf, 'csv');

    expect(result).not.toBeNull();
    const r = result as HeaderDetectionResult;

    expect(r.headerRowIndex).toBe(0);
    expect(r.confidence).toBeGreaterThan(0.7);
    expect(String(r.columnMapping.dateColumn).toLowerCase()).toContain('дата');
    expect(String(r.columnMapping.amountColumn).toLowerCase()).toContain('сумм');
    expect(r.dateFormat).toBe('DD.MM.YYYY');
  });

  it('Fixture 3: detects Tinkoff-style XLSX with debit column, header at row 0', async () => {
    const buf = buildXlsxBuffer(TINKOFF_ROWS);
    const result = await detectHeaderAndColumns(buf, 'xlsx');

    expect(result).not.toBeNull();
    const r = result as HeaderDetectionResult;

    expect(r.headerRowIndex).toBe(0);
    expect(r.confidence).toBeGreaterThan(0.7);
    expect(String(r.columnMapping.dateColumn).toLowerCase()).toContain('дата');
    // "Дебет" should be picked as amount column
    const amtCol = String(r.columnMapping.amountColumn).toLowerCase();
    expect(amtCol === 'дебет' || amtCol === 'кредит').toBe(true);
    expect(r.columnMapping.counterpartyColumn).toBeDefined();
    expect(r.dateFormat).toBe('DD.MM.YYYY');
  });

  it('Fixture 4: detects Windows-1251 CSV via encoding fallback', async () => {
    const buf = buildCsvBuffer(WIN1251_ROWS, 'win1251');
    const result = await detectHeaderAndColumns(buf, 'csv');

    expect(result).not.toBeNull();
    const r = result as HeaderDetectionResult;

    expect(r.headerRowIndex).toBe(0);
    expect(r.confidence).toBeGreaterThan(0.7);
    expect(String(r.columnMapping.dateColumn).toLowerCase()).toContain('дата');
    expect(String(r.columnMapping.amountColumn).toLowerCase()).toContain('сумм');
  });

  it('Fixture 5: returns null for free-text file with no table', async () => {
    const buf = buildCsvBuffer(NO_TABLE_ROWS, 'utf8');
    const result = await detectHeaderAndColumns(buf, 'csv');
    expect(result).toBeNull();
  });

  it('Fixture 6: detects header skipping summary row above it', async () => {
    const buf = buildXlsxBuffer(SPACE_COMMA_ROWS);
    const result = await detectHeaderAndColumns(buf, 'xlsx');

    expect(result).not.toBeNull();
    const r = result as HeaderDetectionResult;

    // Row 0 is "Входящий остаток..." — should be penalised; header is row 1
    expect(r.headerRowIndex).toBe(1);
    expect(r.confidence).toBeGreaterThan(0.7);
    expect(String(r.columnMapping.dateColumn).toLowerCase()).toContain('дата');
    expect(r.amountFormat).toBe('space_comma');
    expect(r.columnMapping.referenceColumn).toBeDefined();
  });

  it('returns a stable signature for repeated calls', async () => {
    const buf = buildXlsxBuffer(SBERBANK_ROWS);
    const r1 = await detectHeaderAndColumns(buf, 'xlsx');
    const r2 = await detectHeaderAndColumns(buf, 'xlsx');
    expect(r1?.signature).toBe(r2?.signature);
  });

  it('signature differs between different bank templates', async () => {
    const buf1 = buildXlsxBuffer(SBERBANK_ROWS);
    const buf2 = buildXlsxBuffer(TINKOFF_ROWS);
    const r1 = await detectHeaderAndColumns(buf1, 'xlsx');
    const r2 = await detectHeaderAndColumns(buf2, 'xlsx');
    expect(r1?.signature).not.toBe(r2?.signature);
  });

  it('detects comma amount format for Sberbank fixture', async () => {
    const buf = buildXlsxBuffer(SBERBANK_ROWS);
    const r = await detectHeaderAndColumns(buf, 'xlsx');
    // "1 500,00" → space_comma
    expect(r?.amountFormat === 'space_comma' || r?.amountFormat === 'comma').toBe(true);
  });

  it('returns headerRowIndex 0 when header is first non-empty row', async () => {
    const rows: unknown[][] = [
      ['Дата операции', 'Сумма', 'Описание'],
      ['15.03.2025', '1500.00', 'Перевод'],
      ['16.03.2025', '250.00', 'Комиссия'],
    ];
    const buf = buildXlsxBuffer(rows);
    const r = await detectHeaderAndColumns(buf, 'xlsx');
    expect(r?.headerRowIndex).toBe(0);
  });

  it('handles XLSX with leading blank rows before the header', async () => {
    const rows: unknown[][] = [
      [null, null, null],
      [null, null, null],
      ['Дата', 'Сумма', 'Назначение платежа'],
      ['01.03.2025', '1000,00', 'Оплата'],
      ['02.03.2025', '500,00', 'Перевод'],
    ];
    const buf = buildXlsxBuffer(rows);
    const r = await detectHeaderAndColumns(buf, 'xlsx');
    expect(r?.headerRowIndex).toBe(2);
    expect(r?.confidence).toBeGreaterThan(0.7);
  });
});
