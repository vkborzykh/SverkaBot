import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveProfile } from '@/src/lib/profiles/resolve';
import type { HeaderDetectionResult } from '@/src/lib/parsing/headerDetection';

// ── Mock DB repository ────────────────────────────────────────────────────────

vi.mock('@/src/db/repositories/statement-profiles', () => ({
  findMatchableProfiles: vi.fn(),
}));

import { findMatchableProfiles } from '@/src/db/repositories/statement-profiles';

const mockedFindMatchableProfiles = vi.mocked(findMatchableProfiles);

// ── Fixture detection result ──────────────────────────────────────────────────

const sampleDetection: HeaderDetectionResult = {
  headerRowIndex: 3,
  columnMapping: {
    dateColumn: 'Дата операции',
    amountColumn: 'Сумма',
    descriptionColumn: 'Назначение платежа',
    counterpartyColumn: 'Контрагент',
    referenceColumn: 'Номер документа',
  },
  dateFormat: 'DD.MM.YYYY',
  amountFormat: 'space_comma',
  confidence: 0.85,
  signature: 'контрагент|назначение платежа|номер документа|сумма|дата операции',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('resolveProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns DRAFT when no active profiles exist', async () => {
    mockedFindMatchableProfiles.mockResolvedValue([]);
    const result = await resolveProfile(sampleDetection, sampleDetection.signature, 'user-1');
    expect(result.status).toBe('DRAFT');
    expect(result.profileId).toBeNull();
  });

  it('returns MATCHED when signature is an exact match', async () => {
    mockedFindMatchableProfiles.mockResolvedValue([
      {
        id: 'profile-sber',
        profile_key: 'sberbank_v1',
        display_name: 'Сбербанк',
        status: 'ACTIVE',
        signature: sampleDetection.signature, // exact match
        column_mapping: sampleDetection.columnMapping,
        date_format: 'DD.MM.YYYY',
        amount_format: 'space_comma',
        usage_count: 50,
        success_rate: '95.00',
      } as never,
    ]);

    const result = await resolveProfile(sampleDetection, sampleDetection.signature, 'user-1');
    expect(result.status).toBe('MATCHED');
    expect(result.profileId).toBe('profile-sber');
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it('returns DRAFT when signature similarity is below threshold', async () => {
    mockedFindMatchableProfiles.mockResolvedValue([
      {
        id: 'profile-other',
        profile_key: 'other_bank_v1',
        display_name: 'Другой банк',
        status: 'ACTIVE',
        // completely different signature
        signature: 'column_a|column_b|column_c|column_d',
        column_mapping: { dateColumn: 'Date', amountColumn: 'Amount' },
        date_format: 'YYYY-MM-DD',
        amount_format: 'dot',
        usage_count: 10,
        success_rate: '80.00',
      } as never,
    ]);

    const result = await resolveProfile(sampleDetection, sampleDetection.signature, 'user-1');
    expect(result.status).toBe('DRAFT');
    expect(result.profileId).toBeNull();
  });

  it('picks the profile with the highest score among multiple candidates', async () => {
    mockedFindMatchableProfiles.mockResolvedValue([
      {
        id: 'profile-low',
        profile_key: 'low_v1',
        display_name: 'Low Score',
        status: 'ACTIVE',
        signature: 'abc|def|ghi',
        column_mapping: { dateColumn: 0, amountColumn: 1 },
        date_format: 'YYYY-MM-DD',
        amount_format: 'dot',
        usage_count: 0,
        success_rate: null,
      } as never,
      {
        id: 'profile-high',
        profile_key: 'sber_v1',
        display_name: 'Сбербанк',
        status: 'ACTIVE',
        signature: sampleDetection.signature,
        column_mapping: sampleDetection.columnMapping,
        date_format: 'DD.MM.YYYY',
        amount_format: 'space_comma',
        usage_count: 100,
        success_rate: '97.00',
      } as never,
    ]);

    const result = await resolveProfile(sampleDetection, sampleDetection.signature, 'user-1');
    expect(result.status).toBe('MATCHED');
    expect(result.profileId).toBe('profile-high');
  });

  it('confidence is between 0 and 1', async () => {
    mockedFindMatchableProfiles.mockResolvedValue([
      {
        id: 'profile-x',
        profile_key: 'x_v1',
        display_name: 'X',
        status: 'ACTIVE',
        signature: sampleDetection.signature,
        column_mapping: sampleDetection.columnMapping,
        date_format: 'DD.MM.YYYY',
        amount_format: 'space_comma',
        usage_count: 10,
        success_rate: '90.00',
      } as never,
    ]);

    const result = await resolveProfile(sampleDetection, sampleDetection.signature, 'user-1');
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('matches against DRAFT profiles too, not only ACTIVE (avoids spawning duplicate drafts for the same unconfirmed bank template)', async () => {
    mockedFindMatchableProfiles.mockResolvedValue([
      {
        id: 'profile-draft',
        profile_key: 'draft_xxx',
        display_name: 'Черновик: неизвестный банк',
        status: 'DRAFT',
        signature: sampleDetection.signature, // exact match
        column_mapping: sampleDetection.columnMapping,
        date_format: 'DD.MM.YYYY',
        amount_format: 'space_comma',
        usage_count: 0,
        success_rate: null,
      } as never,
    ]);

    const result = await resolveProfile(sampleDetection, sampleDetection.signature, 'user-1');
    expect(result.status).toBe('MATCHED');
    expect(result.profileId).toBe('profile-draft');
  });
});
