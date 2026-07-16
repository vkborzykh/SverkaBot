import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/src/db/index', () => ({
  getDb: vi.fn(),
}));
vi.mock('@/src/db/repositories/statement-profiles', () => ({
  findProfileById: vi.fn(),
  updateProfile: vi.fn(),
}));
vi.mock('@/src/db/repositories/reconciliation-runs', () => ({
  findRunById: vi.fn(),
}));
vi.mock('@/src/db/repositories/reports', () => ({
  findPrimaryReportByRunId: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/src/lib/audit/audit', () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/src/lib/jobs/queue', () => ({
  enqueue: vi.fn().mockResolvedValue('job-123'),
}));

import { findProfileById, updateProfile } from '@/src/db/repositories/statement-profiles';
import { findRunById } from '@/src/db/repositories/reconciliation-runs';
import { logAuditEvent } from '@/src/lib/audit/audit';
import { enqueue } from '@/src/lib/jobs/queue';

const mockFindProfileById = vi.mocked(findProfileById);
const mockUpdateProfile = vi.mocked(updateProfile);
const mockFindRunById = vi.mocked(findRunById);
const mockLogAuditEvent = vi.mocked(logAuditEvent);
const mockEnqueue = vi.mocked(enqueue);

function makeCtx(text: string) {
  return {
    from: { id: 123456 },
    message: { text },
    reply: vi.fn().mockResolvedValue(undefined),
    answerCbQuery: vi.fn(),
    editMessageReplyMarkup: vi.fn(),
  } as unknown;
}

describe('admin handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('TELEGRAM_ADMIN_IDS', '123456');
  });

  describe('handleActivateProfile', () => {
    it('activates a profile and logs audit event', async () => {
      const { handleActivateProfile } = await import('@/src/lib/telegram/handlers/admin');
      const profile = { id: 'p-1', status: 'DRAFT', display_name: 'Test' };
      mockFindProfileById.mockResolvedValue(profile as never);
      mockUpdateProfile.mockResolvedValue({ ...profile, status: 'ACTIVE' } as never);

      const ctx = makeCtx('/activate_profile p-1');
      await handleActivateProfile(ctx as never);

      expect(mockUpdateProfile).toHaveBeenCalledWith('p-1', { status: 'ACTIVE' });
      expect(mockLogAuditEvent).toHaveBeenCalledWith(null, 'profile_activated', {
        profile_id: 'p-1',
        previous_status: 'DRAFT',
        source: 'telegram',
      });
      expect((ctx as { reply: ReturnType<typeof vi.fn> }).reply).toHaveBeenCalled();
    });

    it('replies with error when profile not found', async () => {
      const { handleActivateProfile } = await import('@/src/lib/telegram/handlers/admin');
      mockFindProfileById.mockResolvedValue(undefined);

      const ctx = makeCtx('/activate_profile bad-id');
      await handleActivateProfile(ctx as never);

      expect(mockUpdateProfile).not.toHaveBeenCalled();
    });

    it('replies with missing id message when no id provided', async () => {
      const { handleActivateProfile } = await import('@/src/lib/telegram/handlers/admin');
      const ctx = makeCtx('/activate_profile');
      await handleActivateProfile(ctx as never);

      expect(mockFindProfileById).not.toHaveBeenCalled();
    });
  });

  describe('handleDeprecateProfile', () => {
    it('deprecates a profile and logs audit event', async () => {
      const { handleDeprecateProfile } = await import('@/src/lib/telegram/handlers/admin');
      const profile = { id: 'p-2', status: 'ACTIVE', display_name: 'Test' };
      mockFindProfileById.mockResolvedValue(profile as never);
      mockUpdateProfile.mockResolvedValue({ ...profile, status: 'DEPRECATED' } as never);

      const ctx = makeCtx('/deprecate_profile p-2');
      await handleDeprecateProfile(ctx as never);

      expect(mockUpdateProfile).toHaveBeenCalledWith('p-2', { status: 'DEPRECATED' });
      expect(mockLogAuditEvent).toHaveBeenCalledWith(null, 'profile_deprecated', {
        profile_id: 'p-2',
        previous_status: 'ACTIVE',
        source: 'telegram',
      });
    });
  });

  describe('handleRetryExport', () => {
    it('enqueues report_export job for valid run', async () => {
      const { handleRetryExport } = await import('@/src/lib/telegram/handlers/admin');
      mockFindRunById.mockResolvedValue({ id: 'run-1', status: 'COMPLETED' } as never);

      const ctx = makeCtx('/retry_export run-1');
      await handleRetryExport(ctx as never);

      expect(mockEnqueue).toHaveBeenCalledWith('report_export', 'run-1', {
        run_id: 'run-1',
        retry: true,
      });
      expect((ctx as { reply: ReturnType<typeof vi.fn> }).reply).toHaveBeenCalled();
    });

    it('replies with error when run not found', async () => {
      const { handleRetryExport } = await import('@/src/lib/telegram/handlers/admin');
      mockFindRunById.mockResolvedValue(undefined);

      const ctx = makeCtx('/retry_export bad-run');
      await handleRetryExport(ctx as never);

      expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it('replies with missing id message when no id provided', async () => {
      const { handleRetryExport } = await import('@/src/lib/telegram/handlers/admin');
      const ctx = makeCtx('/retry_export');
      await handleRetryExport(ctx as never);

      expect(mockFindRunById).not.toHaveBeenCalled();
    });
  });
});
