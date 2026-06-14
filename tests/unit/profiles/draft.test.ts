import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDraftProfile } from '@/src/lib/profiles/draft';
import type { HeaderDetectionResult } from '@/src/lib/parsing/headerDetection';

// ── Mock DB repository ────────────────────────────────────────────────────────

vi.mock('@/src/db/repositories/statement-profiles', () => ({
  createProfile: vi.fn(),
}));

import { createProfile } from '@/src/db/repositories/statement-profiles';

const mockedCreateProfile = vi.mocked(createProfile);

// ── Fixture ───────────────────────────────────────────────────────────────────

const detection: HeaderDetectionResult = {
  headerRowIndex: 0,
  columnMapping: {
    dateColumn: 'Дата',
    amountColumn: 'Сумма',
    descriptionColumn: 'Назначение',
  },
  dateFormat: 'DD.MM.YYYY',
  amountFormat: 'comma',
  confidence: 0.78,
  signature: 'дата|назначение|сумма',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createDraftProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedCreateProfile.mockResolvedValue({
      id: 'new-draft-id',
      profile_key: 'draft_xxx',
      display_name: 'Черновик: неизвестный банк',
      status: 'DRAFT',
    } as never);
  });

  it('calls createProfile with status DRAFT', async () => {
    await createDraftProfile(detection, 'дата|назначение|сумма', 'user-123');
    expect(mockedCreateProfile).toHaveBeenCalledOnce();
    const arg = mockedCreateProfile.mock.calls[0][0];
    expect(arg.status).toBe('DRAFT');
  });

  it('returns the new profile id', async () => {
    const id = await createDraftProfile(detection, 'дата|назначение|сумма', 'user-123');
    expect(id).toBe('new-draft-id');
  });

  it('sets display_name to generic when no bankNameHint', async () => {
    await createDraftProfile(detection, 'дата|назначение|сумма', 'user-123');
    const arg = mockedCreateProfile.mock.calls[0][0];
    expect(arg.display_name).toBe('Черновик: неизвестный банк');
  });

  it('includes bank name hint in display_name when provided', async () => {
    await createDraftProfile(detection, 'дата|назначение|сумма', 'user-123', 'Тинькофф');
    const arg = mockedCreateProfile.mock.calls[0][0];
    expect(arg.display_name).toBe('Черновик: Тинькофф');
  });

  it('stores headerRowIndex from detection result', async () => {
    await createDraftProfile(detection, 'дата|назначение|сумма', 'user-123');
    const arg = mockedCreateProfile.mock.calls[0][0];
    expect(arg.header_row_index).toBe(0);
  });

  it('stores date_format and amount_format from detection result', async () => {
    await createDraftProfile(detection, 'дата|назначение|сумма', 'user-123');
    const arg = mockedCreateProfile.mock.calls[0][0];
    expect(arg.date_format).toBe('DD.MM.YYYY');
    expect(arg.amount_format).toBe('comma');
  });

  it('stores signature passed as argument', async () => {
    await createDraftProfile(detection, 'custom|sig', 'user-123');
    const arg = mockedCreateProfile.mock.calls[0][0];
    expect(arg.signature).toBe('custom|sig');
  });

  it('profile_key starts with draft_', async () => {
    await createDraftProfile(detection, 'дата|назначение|сумма', 'user-123');
    const arg = mockedCreateProfile.mock.calls[0][0];
    expect(arg.profile_key).toMatch(/^draft_/);
  });

  it('sets version to 1', async () => {
    await createDraftProfile(detection, 'дата|назначение|сумма', 'user-123');
    const arg = mockedCreateProfile.mock.calls[0][0];
    expect(arg.version).toBe(1);
  });

  it('sets created_by to userId', async () => {
    await createDraftProfile(detection, 'дата|назначение|сумма', 'user-abc');
    const arg = mockedCreateProfile.mock.calls[0][0];
    expect(arg.created_by).toBe('user-abc');
  });
});
