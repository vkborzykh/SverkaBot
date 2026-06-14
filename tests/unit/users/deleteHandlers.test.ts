import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/src/db/repositories/users', () => ({
  findUserByTelegramId: vi.fn(),
}));
vi.mock('@/src/lib/users/deletion', () => ({
  deleteUserData: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../src/lib/telegram/keyboard', () => ({
  deleteConfirmKeyboard: { reply_markup: {} },
}));

import { findUserByTelegramId } from '@/src/db/repositories/users';
import { deleteUserData } from '@/src/lib/users/deletion';

const mockFindUser = vi.mocked(findUserByTelegramId);
const mockDeleteUser = vi.mocked(deleteUserData);

function makeCtx() {
  return {
    from: { id: 123456 },
    message: { text: '/delete_my_data' },
    reply: vi.fn().mockResolvedValue(undefined),
    answerCbQuery: vi.fn().mockResolvedValue(undefined),
    editMessageReplyMarkup: vi.fn().mockResolvedValue(undefined),
  } as unknown;
}

describe('deleteData handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleDeleteMyData', () => {
    it('shows confirmation prompt with keyboard', async () => {
      const { handleDeleteMyData } = await import('@/src/lib/telegram/handlers/deleteData');
      const ctx = makeCtx();
      await handleDeleteMyData(ctx as never);

      expect((ctx as { reply: ReturnType<typeof vi.fn> }).reply).toHaveBeenCalledWith(
        expect.stringContaining('удалить все свои данные'),
        expect.anything(),
      );
    });
  });

  describe('handleDeleteConfirm', () => {
    it('calls deleteUserData and replies with success', async () => {
      const { handleDeleteConfirm } = await import('@/src/lib/telegram/handlers/deleteData');
      mockFindUser.mockResolvedValue({ id: 'user-1' } as never);

      const ctx = makeCtx();
      await handleDeleteConfirm(ctx as never);

      expect(mockDeleteUser).toHaveBeenCalledWith('user-1');
      expect((ctx as { reply: ReturnType<typeof vi.fn> }).reply).toHaveBeenCalledWith(
        expect.stringContaining('удалены'),
      );
    });

    it('handles case when user is already gone', async () => {
      const { handleDeleteConfirm } = await import('@/src/lib/telegram/handlers/deleteData');
      mockFindUser.mockResolvedValue(undefined);

      const ctx = makeCtx();
      await handleDeleteConfirm(ctx as never);

      expect(mockDeleteUser).not.toHaveBeenCalled();
      expect((ctx as { reply: ReturnType<typeof vi.fn> }).reply).toHaveBeenCalledWith(
        expect.stringContaining('удалены'),
      );
    });

    it('handles deletion error gracefully', async () => {
      const { handleDeleteConfirm } = await import('@/src/lib/telegram/handlers/deleteData');
      mockFindUser.mockResolvedValue({ id: 'user-1' } as never);
      mockDeleteUser.mockRejectedValueOnce(new Error('DB error'));

      const ctx = makeCtx();
      await handleDeleteConfirm(ctx as never);

      expect((ctx as { reply: ReturnType<typeof vi.fn> }).reply).toHaveBeenCalledWith(
        expect.stringContaining('ошибка'),
      );
    });
  });

  describe('handleDeleteCancel', () => {
    it('replies with cancellation message', async () => {
      const { handleDeleteCancel } = await import('@/src/lib/telegram/handlers/deleteData');
      const ctx = makeCtx();
      await handleDeleteCancel(ctx as never);

      expect((ctx as { answerCbQuery: ReturnType<typeof vi.fn> }).answerCbQuery).toHaveBeenCalled();
      expect((ctx as { reply: ReturnType<typeof vi.fn> }).reply).toHaveBeenCalledWith(
        expect.stringContaining('отменено'),
      );
    });
  });
});
