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
// handleDeleteConfirm первым делом проверяет, есть ли вообще что удалять
// (findImportsByUserId + findRunsByUserId) — раньше эти модули не мокались
// вовсе, из-за чего тест падал на реальном подключении к БД.
vi.mock('@/src/db/repositories/imports', () => ({
  findImportsByUserId: vi.fn(),
}));
vi.mock('@/src/db/repositories/reconciliation-runs', () => ({
  findRunsByUserId: vi.fn(),
}));

import { findUserByTelegramId } from '@/src/db/repositories/users';
import { deleteUserData } from '@/src/lib/users/deletion';
import { findImportsByUserId } from '@/src/db/repositories/imports';
import { findRunsByUserId } from '@/src/db/repositories/reconciliation-runs';

const mockFindUser = vi.mocked(findUserByTelegramId);
const mockDeleteUser = vi.mocked(deleteUserData);
const mockFindImports = vi.mocked(findImportsByUserId);
const mockFindRuns = vi.mocked(findRunsByUserId);

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
    // По умолчанию — есть что удалять (хотя бы один импорт), чтобы тесты,
    // которым это не важно, не проваливались на ветке "нечего удалять".
    mockFindImports.mockResolvedValue([{ id: 'imp-1' }] as never);
    mockFindRuns.mockResolvedValue([] as never);
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
    it('calls deleteUserData and replies with success when the user has data', async () => {
      const { handleDeleteConfirm } = await import('@/src/lib/telegram/handlers/deleteData');
      mockFindUser.mockResolvedValue({ id: 'user-1' } as never);
      mockFindImports.mockResolvedValue([{ id: 'imp-1' }] as never);

      const ctx = makeCtx();
      await handleDeleteConfirm(ctx as never);

      expect(mockDeleteUser).toHaveBeenCalledWith('user-1');
      expect((ctx as { reply: ReturnType<typeof vi.fn> }).reply).toHaveBeenCalledWith(
        expect.stringContaining('удалены'),
      );
    });

    it('handles case when user is already gone (anonymized/deleted) without touching deleteUserData', async () => {
      const { handleDeleteConfirm } = await import('@/src/lib/telegram/handlers/deleteData');
      mockFindUser.mockResolvedValue(undefined);

      const ctx = makeCtx();
      await handleDeleteConfirm(ctx as never);

      expect(mockDeleteUser).not.toHaveBeenCalled();
      // Пользователь не найден -> "нечего удалять", а не "успешно удалено"
      expect((ctx as { reply: ReturnType<typeof vi.fn> }).reply).toHaveBeenCalledWith(
        expect.stringContaining('Данных для удаления не найдено'),
      );
    });

    it('replies with "nothing to delete" when the user exists but has no imports or runs', async () => {
      const { handleDeleteConfirm } = await import('@/src/lib/telegram/handlers/deleteData');
      mockFindUser.mockResolvedValue({ id: 'user-1' } as never);
      mockFindImports.mockResolvedValue([] as never);
      mockFindRuns.mockResolvedValue([] as never);

      const ctx = makeCtx();
      await handleDeleteConfirm(ctx as never);

      expect(mockDeleteUser).not.toHaveBeenCalled();
      expect((ctx as { reply: ReturnType<typeof vi.fn> }).reply).toHaveBeenCalledWith(
        expect.stringContaining('Данных для удаления не найдено'),
      );
    });

    it('handles deletion error gracefully', async () => {
      const { handleDeleteConfirm } = await import('@/src/lib/telegram/handlers/deleteData');
      mockFindUser.mockResolvedValue({ id: 'user-1' } as never);
      mockFindImports.mockResolvedValue([{ id: 'imp-1' }] as never);
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
