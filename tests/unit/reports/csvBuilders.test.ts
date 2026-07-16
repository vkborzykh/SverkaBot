import { describe, it, expect } from 'vitest';
import {
  buildSummaryCSV,
  buildMatchedCSV,
  buildUnmatchedCSV,
  buildAmbiguousCSV,
  buildAllTransactionsCSV,
  buildEvidenceCSV,
  buildParsingErrorsCSV,
  buildMetricsCSV,
} from '@/src/lib/reports/csvBuilders';

const BOM = '\uFEFF';

function makeRun(overrides = {}) {
  return {
    id: 'run-1',
    user_id: 'user-1',
    wb_import_id: 'wb-1',
    bank_import_id: 'bank-1',
    status: 'COMPLETED',
    total_wb_rows: 100,
    total_bank_rows: 120,
    matched_count: 80,
    unmatched_count: 15,
    ambiguous_count: 5,
    split_count: 3,
    combined_count: 2,
    match_rate: '80.00',
    unmatched_amount: BigInt(1500000),
    ambiguous_amount: BigInt(500000),
    started_at: new Date('2025-03-01T10:00:00Z'),
    completed_at: new Date('2025-03-01T10:01:30Z'),
    created_at: new Date('2025-03-01T10:00:00Z'),
    updated_at: new Date('2025-03-01T10:01:30Z'),
    failure_reason: null,
    ...overrides,
  } as never;
}

function makeTx(id: string, overrides = {}) {
  return {
    id,
    import_id: 'imp-1',
    source_type: 'WB',
    row_number: 1,
    transaction_date: new Date('2025-03-10T00:00:00Z'),
    amount_kopeks: BigInt(150000),
    currency: 'RUB',
    direction: 'IN',
    reference: 'REF-001',
    description: 'Payment',
    counterparty: 'WB LLC',
    row_hash: 'hash1',
    raw_payload: null,
    created_at: new Date('2025-03-01T10:00:00Z'),
    ...overrides,
  } as never;
}

describe('csvBuilders', () => {
  describe('buildSummaryCSV', () => {
    it('starts with BOM and uses semicolon delimiter', () => {
      const csv = buildSummaryCSV(makeRun(), BigInt(1750000));
      expect(csv.startsWith(BOM)).toBe(true);
      expect(csv).toContain(';');
    });

    it('contains Russian headers', () => {
      const csv = buildSummaryCSV(makeRun(), BigInt(1750000));
      expect(csv).toContain('Параметр');
      expect(csv).toContain('Значение');
    });

    it('includes loss estimate in rubles', () => {
      const csv = buildSummaryCSV(makeRun(), BigInt(1750000));
      expect(csv).toContain('17500.00');
    });

    it('includes run id', () => {
      const csv = buildSummaryCSV(makeRun(), BigInt(0));
      expect(csv).toContain('run-1');
    });
  });

  describe('buildMatchedCSV', () => {
    it('produces empty CSV with just headers when no rows', () => {
      const csv = buildMatchedCSV([]);
      expect(csv.startsWith(BOM)).toBe(true);
      expect(csv).toContain('ID совпадения');
      const lines = csv.trim().split('\r\n');
      expect(lines.length).toBe(1);
    });

    it('includes match data', () => {
      const csv = buildMatchedCSV([
        {
          match_id: 'm-1',
          match_type: 'MATCHED',
          final_score: '0.9500',
          wb_tx: makeTx('wb-tx-1'),
          bank_tx: makeTx('bank-tx-1', { source_type: 'BANK', counterparty: 'Company X' }),
        },
      ]);
      expect(csv).toContain('m-1');
      expect(csv).toContain('MATCHED');
      expect(csv).toContain('1500.00');
    });
  });

  describe('buildUnmatchedCSV', () => {
    it('lists unmatched WB transactions', () => {
      const csv = buildUnmatchedCSV([makeTx('u-1'), makeTx('u-2')]);
      const lines = csv.trim().split('\r\n');
      expect(lines.length).toBe(3); // header + 2 rows
      expect(csv).toContain('u-1');
      expect(csv).toContain('u-2');
    });
  });

  describe('buildAmbiguousCSV', () => {
    it('includes candidate count', () => {
      const csv = buildAmbiguousCSV([
        { match_id: 'am-1', wb_tx: makeTx('wb-amb-1'), candidates_count: 3 },
      ]);
      expect(csv).toContain('3');
      expect(csv).toContain('am-1');
    });
  });

  describe('buildAllTransactionsCSV', () => {
    it('includes all fields', () => {
      const csv = buildAllTransactionsCSV([makeTx('t-1')]);
      expect(csv).toContain('ID');
      expect(csv).toContain('t-1');
      expect(csv).toContain('1500.00');
    });
  });

  describe('buildEvidenceCSV', () => {
    it('includes score components', () => {
      const csv = buildEvidenceCSV([
        {
          match_id: 'ev-1',
          match_type: 'MATCHED',
          evidence: {
            id: 'e-1',
            match_id: 'ev-1',
            amount_score: '0.9800',
            date_score: '1.0000',
            reference_score: '0.7500',
            description_score: '0.5000',
            counterparty_score: '0.3000',
            penalties: null,
            created_at: new Date(),
          } as never,
        },
      ]);
      expect(csv).toContain('0.9800');
      expect(csv).toContain('1.0000');
    });
  });

  describe('buildParsingErrorsCSV', () => {
    it('includes error details', () => {
      const csv = buildParsingErrorsCSV([
        {
          id: 'pe-1',
          import_id: 'imp-1',
          row_number: 5,
          error_code: 'INVALID_DATE',
          error_message: 'Cannot parse date',
          raw_fragment: '32/13/2025',
          created_at: new Date(),
        } as never,
      ]);
      expect(csv).toContain('INVALID_DATE');
      expect(csv).toContain('Cannot parse date');
      expect(csv).toContain('32/13/2025');
    });
  });

  describe('buildMetricsCSV', () => {
    it('computes rates correctly', () => {
      const csv = buildMetricsCSV(makeRun());
      expect(csv).toContain('80.00%');
      expect(csv).toContain('5.00%'); // ambiguous rate: 5/100
      expect(csv).toContain('3.00%'); // split rate: 3/100
      expect(csv).toContain('2.00%'); // combined rate: 2/100
    });
  });

  describe('CSV escaping', () => {
    it('escapes semicolons in field values', () => {
      const csv = buildUnmatchedCSV([
        makeTx('esc-1', { description: 'Test; with semicolon' }),
      ]);
      expect(csv).toContain('"Test; with semicolon"');
    });

    it('escapes quotes in field values', () => {
      const csv = buildUnmatchedCSV([
        makeTx('esc-2', { description: 'Has "quotes" inside' }),
      ]);
      expect(csv).toContain('"Has ""quotes"" inside"');
    });

    it('uses CRLF line endings', () => {
      const csv = buildMetricsCSV(makeRun());
      expect(csv).toContain('\r\n');
    });
  });
});
