import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as XLSX from 'xlsx';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/src/lib/ingestion/storage', () => ({
  loadFile: vi.fn(),
}));
vi.mock('@/src/db/repositories/imports', () => ({
  findImportById: vi.fn(),
  updateImport: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/src/db/repositories/users', () => ({
  findUserById: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/src/db/repositories/canonical-transactions', () => ({
  createTransactions: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/src/db/repositories/parsing-errors', () => ({
  createParsingErrors: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/src/lib/telegram/keyboard', () => ({
  wbCompletedKeyboard: { reply_markup: {} },
  replaceWbInlineKeyboard: { reply_markup: {} },
}));

import { loadFile } from '@/src/lib/ingestion/storage';
import { findImportById } from '@/src/db/repositories/imports';
import { createTransactions } from '@/src/db/repositories/canonical-transactions';
import { handleParseWb } from '@/src/lib/jobs/handlers/parseWb';

const mockLoadFile = vi.mocked(loadFile);
const mockFindImportById = vi.mocked(findImportById);
const mockCreateTransactions = vi.mocked(createTransactions);

// Минимальный набор колонок реального 81-колоночного отчёта WB, достаточный
// для detectColumns(): дата, тип документа, "К перечислению" (амаунт),
// логистика (инлайн-удержание) и отдельная "Хранение" (для строки без
// собственного "К перечислению").
function buildWbBuffer(rows: (string | number)[][]): Buffer {
  const header = [
    'Дата продажи',
    'Тип документа',
    'К перечислению Продавцу за реализованный товар',
    'Услуги по доставке товара покупателю',
    'Хранение',
    'Номер поставки',
  ];
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Детализация WB');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('handleParseWb — деduction double-counting fix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindImportById.mockResolvedValue({
      id: 'imp-1',
      user_id: 'user-1',
      status: 'RECEIVED',
      storage_path: 'imports/user-1/report.xlsx',
    } as never);
  });

  it('does NOT create a separate OUT transaction for a deduction column on the same row as "К перечислению" (already netted there)', async () => {
    const buf = buildWbBuffer([
      // Строка продажи: payout=1000, инлайн-логистика=100 на ТОЙ ЖЕ строке
      ['15.07.2026', 'Продажа', 1000, 100, '', 'SUP1'],
    ]);
    mockLoadFile.mockResolvedValue(buf);

    await handleParseWb({ id: 'job-1', entity_id: 'imp-1', payload: { import_id: 'imp-1' } } as never);

    const allInserted = mockCreateTransactions.mock.calls.flatMap((c) => c[0]);
    expect(allInserted).toHaveLength(1);
    expect(allInserted[0]).toMatchObject({ direction: 'IN', amount_kopeks: BigInt(100000) });
  });

  it('DOES create a separate OUT transaction for a standalone deduction row (no "К перечислению" on that row)', async () => {
    const buf = buildWbBuffer([
      // Отдельная строка "Хранение" — своего "К перечислению" нет вовсе
      ['20.07.2026', 'Хранение', '', '', 50, ''],
    ]);
    mockLoadFile.mockResolvedValue(buf);

    await handleParseWb({ id: 'job-1', entity_id: 'imp-1', payload: { import_id: 'imp-1' } } as never);

    const allInserted = mockCreateTransactions.mock.calls.flatMap((c) => c[0]);
    expect(allInserted).toHaveLength(1);
    expect(allInserted[0]).toMatchObject({ direction: 'OUT', amount_kopeks: BigInt(5000), category: 'STORAGE' });
  });

  it('mixed file: sale row (netted) + standalone storage row -> exactly one IN + one OUT, not double-deducted', async () => {
    const buf = buildWbBuffer([
      ['15.07.2026', 'Продажа', 1000, 100, '', 'SUP1'],
      ['20.07.2026', 'Хранение', '', '', 50, ''],
    ]);
    mockLoadFile.mockResolvedValue(buf);

    await handleParseWb({ id: 'job-1', entity_id: 'imp-1', payload: { import_id: 'imp-1' } } as never);

    const allInserted = mockCreateTransactions.mock.calls.flatMap((c) => c[0]);
    expect(allInserted).toHaveLength(2);
    const wbIn = allInserted.filter((t: any) => t.direction === 'IN').reduce((s: bigint, t: any) => s + t.amount_kopeks, BigInt(0));
    const wbOut = allInserted.filter((t: any) => t.direction === 'OUT').reduce((s: bigint, t: any) => s + t.amount_kopeks, BigInt(0));
    // 1000 руб. дохода, 50 руб. отдельного удержания (склад) — логистика в 100 руб.
    // НЕ должна быть вычтена ещё раз, иначе wbOut было бы 150, а не 50.
    expect(wbIn).toBe(BigInt(100000));
    expect(wbOut).toBe(BigInt(5000));
  });
});
