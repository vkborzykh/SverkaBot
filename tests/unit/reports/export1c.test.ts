import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/src/lib/reports/runAggregates', () => ({
  getRunAggregates: vi.fn(),
  formatRub: (k: bigint) => (Number(k) / 100).toFixed(2).replace('.', ','),
  csvCell: (s: string) => s,
  fmtDate: () => '15.07.2026',
  COUNTERPARTY_BY_MARKETPLACE: { WB: 'ООО «Вайлдберриз»' },
}));

vi.mock('@/src/lib/reconciliation/claimBuilder', () => ({
  buildRowLevelClaim: vi.fn(),
}));

import { build1cForRun } from '@/src/lib/reports/export1c';
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

describe('build1cForRun', () => {
  beforeEach(() => vi.clearAllMocks());

  it('первая строка файла всегда заголовки — без explanation-row', async () => {
    mockGetAgg.mockResolvedValue(baseAgg());
    mockBuildClaim.mockResolvedValue(null); // низкая уверенность/нет данных -> fallback

    const buf = await build1cForRun('run-1');
    const text = buf.toString('utf-8').replace(/^\uFEFF/, '');
    const firstLine = text.split('\r\n')[0];

    expect(firstLine).toBe('ID сверки;Дата сверки;Кабинет WB;Период отчёта WB;Контрагент;Документ-основание;Ожидалось, руб.;Получено, руб.;Разница, руб.;Статус');
    expect(text).not.toContain('# Сверка выплат');
  });

  it('при высокой уверенности отдаёт реестр — по строке на непокрытую выплату', async () => {
    mockGetAgg.mockResolvedValue(baseAgg());
    mockBuildClaim.mockResolvedValue({
      rows: [
        { dateStr: '08.07.2026', amountKopeks: BigInt(60000), reference: 'REF-1', description: 'Продажа' },
        { dateStr: '10.07.2026', amountKopeks: BigInt(40000), reference: 'REF-2', description: 'Продажа' },
      ],
      sumUnmatchedKopeks: BigInt(100000),
      confidence: 'high',
    });

    const buf = await build1cForRun('run-1');
    const text = buf.toString('utf-8').replace(/^\uFEFF/, '');
    const lines = text.trim().split('\r\n');

    expect(lines[0]).toBe('ID сверки;Дата сверки;Кабинет WB;Дата начисления WB;Контрагент;Документ-основание;Не подтверждено, руб.;Статус');
    expect(lines).toHaveLength(3); // заголовок + 2 строки
    expect(lines[1]).toContain('REF-1');
    expect(lines[2]).toContain('REF-2');
  });

  it('при низкой уверенности откатывается на агрегатный режим', async () => {
    mockGetAgg.mockResolvedValue(baseAgg());
    mockBuildClaim.mockResolvedValue({
      rows: [{ dateStr: '08.07.2026', amountKopeks: BigInt(5000), reference: 'REF-1', description: null }],
      sumUnmatchedKopeks: BigInt(5000),
      confidence: 'low',
    });

    const buf = await build1cForRun('run-1');
    const text = buf.toString('utf-8').replace(/^\uFEFF/, '');
    expect(text.split('\r\n')[0]).toContain('Ожидалось, руб.'); // агрегатная шапка
  });

  it('не строит претензию, если недоплаты нет (diffKopeks <= 0)', async () => {
    mockGetAgg.mockResolvedValue(baseAgg({ diffKopeks: BigInt(0), statusLabel: 'Совпало' }));

    await build1cForRun('run-1');
    expect(mockBuildClaim).not.toHaveBeenCalled();
  });
});
