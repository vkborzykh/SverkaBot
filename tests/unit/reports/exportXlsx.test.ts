import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as XLSX from 'xlsx';

vi.mock('@/src/lib/reconciliation/claimBuilder', () => ({
  buildRowLevelClaim: vi.fn(),
}));

vi.mock('@/src/lib/reports/runAggregates', async () => {
  const actual = await vi.importActual<any>('@/src/lib/reports/runAggregates');
  return { ...actual, getRunAggregates: vi.fn() };
});

import { buildXlsxForRun } from '@/src/lib/reports/exportXlsx';
import { getRunAggregates } from '@/src/lib/reports/runAggregates';
import type { RunAggregates } from '@/src/lib/reports/runAggregates';
import { buildRowLevelClaim } from '@/src/lib/reconciliation/claimBuilder';

const mockGetAgg = vi.mocked(getRunAggregates);
const mockBuildClaim = vi.mocked(buildRowLevelClaim);

function baseAgg(overrides: Partial<RunAggregates> = {}): RunAggregates {
  return {
    runId: 'run-1',
    createdAt: new Date('2026-07-15'),
    cabinetName: 'Кабинет 1',
    marketplace: 'WB',
    periodFrom: '07.07.2026',
    periodTo: '13.07.2026',
    expectedKopeks: BigInt(1000000),
    receivedKopeks: BigInt(900000),
    diffKopeks: BigInt(100000),
    status: 'UNDERPAID' as const,
    statusLabel: 'Недоплата',
    wbTxs: [],
    bankTxs: [],
    wbBankCredits: [],
    matchedBankTxIds: new Set(),
    contentHash: 'hash',
    ...overrides,
  };
}

describe('buildXlsxForRun — лист «Претензия»', () => {
  beforeEach(() => vi.clearAllMocks());

  it('не добавляет лист «Претензия», если уверенность низкая', async () => {
    mockGetAgg.mockResolvedValue(baseAgg());
    mockBuildClaim.mockResolvedValue(null);

    const buf = await buildXlsxForRun('run-1');
    const wb = XLSX.read(buf, { type: 'buffer' });
    expect(wb.SheetNames).not.toContain('Претензия');
  });

  it('добавляет лист «Претензия» с верной позицией строки «Итого» при высокой уверенности', async () => {
    mockGetAgg.mockResolvedValue(baseAgg());
    mockBuildClaim.mockResolvedValue({
      rows: [
        { dateStr: '08.07.2026', amountKopeks: BigInt(60000), reference: 'REF-1', description: 'Продажа 1' },
        { dateStr: '09.07.2026', amountKopeks: BigInt(20000), reference: 'REF-2', description: 'Продажа 2' },
        { dateStr: '10.07.2026', amountKopeks: BigInt(20000), reference: 'REF-3', description: 'Продажа 3' },
      ],
      sumUnmatchedKopeks: BigInt(100000),
      confidence: 'high',
    });

    const buf = await buildXlsxForRun('run-1');
    const wb = XLSX.read(buf, { type: 'buffer' });
    expect(wb.SheetNames).toContain('Претензия');

    const ws = wb.Sheets['Претензия'];
    const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1 });

    // 1 заголовок листа + 1 пустая + 1 шапка таблицы + 3 строки + 1 пустая + 1 итог = 8 строк
    expect(rows).toHaveLength(8);
    const totalRow = rows[7];
    expect(totalRow[2]).toBe('Итого не подтверждено');
    expect(totalRow[3]).toBe(1000); // 100000 копеек -> 1000.00 руб (число)
  });

  it('не добавляет лист «Претензия», если недоплаты нет', async () => {
    mockGetAgg.mockResolvedValue(baseAgg({ diffKopeks: BigInt(0) }));

    const buf = await buildXlsxForRun('run-1');
    const wb = XLSX.read(buf, { type: 'buffer' });
    expect(wb.SheetNames).not.toContain('Претензия');
    expect(mockBuildClaim).not.toHaveBeenCalled();
  });
});
