import { msg } from './messages.ru';
import { hasProFeatures } from '@/src/lib/billing/tariffs';

export const consentKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [{ text: msg.consentAccept, callback_data: 'consent:accept' }],
      [{ text: msg.consentDecline, callback_data: 'consent:decline' }],
    ],
  },
};

export const deleteConfirmKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: msg.deleteConfirm, callback_data: 'delete:confirm' },
        { text: msg.deleteCancel, callback_data: 'delete:cancel' },
      ],
    ],
  },
};

/**
 * Возвращает клавиатуру главного меню в зависимости от тарифа пользователя.
 * Кнопка «Мои кабинеты» видна только на PRO и BUSINESS.
 * Кнопка «📈 Статистика» – только на PRO/BUSINESS.
 * Во время активного пробного периода TRIAL все кнопки видимы.
 */
export function getMainMenuKeyboard(
  userTariff?: string | null,
  subscriptionStatus?: string | null,
  trialExpiresAt?: Date | null,
) {
  const secondRow = [msg.menuSubscribe];
  if (hasProFeatures(userTariff, subscriptionStatus, trialExpiresAt)) {
    secondRow.push(msg.menuMyCabinets);
  }

  const keyboard = [
    [msg.menuNewReconciliation],
    secondRow,
    [msg.menuHelp, msg.menuHistory],
  ];

  if (hasProFeatures(userTariff, subscriptionStatus, trialExpiresAt)) {
    keyboard.push([msg.menuStatistics]);
  }

  keyboard.push([msg.menuDeleteData]);

  return {
    reply_markup: {
      keyboard,
      resize_keyboard: true,
    },
  };
}

// Старая статическая клавиатура (оставлена для обратной совместимости,
// но в коде следует использовать getMainMenuKeyboard)
export const mainMenuKeyboard = getMainMenuKeyboard();

// Inline-клавиатуры для этапов сверки
export const newReconciliationKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '🆕 Начать новую сверку', callback_data: 'new_reconciliation' }],
    ],
  },
};

export const uploadWbInlineKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '📊 Загрузить WB отчёт', callback_data: 'upload_wb_inline' }],
    ],
  },
};

export const wbCompletedKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '🔄 Заменить WB отчёт', callback_data: 'replace_wb' }],
      [{ text: '🏦 Загрузить выписку', callback_data: 'upload_bank_inline' }],
    ],
  },
};

export const bankCompletedKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '🔄 Заменить выписку', callback_data: 'replace_bank' }],
      [{ text: '🔎 Запустить сверку', callback_data: 'run_sync_inline' }],
    ],
  },
};

/**
 * Формирует клавиатуру, показываемую после завершения сверки.
 * Кнопка «Текст претензии» получает идентификатор сверки для дальнейшей обработки.
 */
export function getReconciliationFinishedKeyboard(runId: string) {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📩 Текст претензии', callback_data: `claim_text:${runId}` }],
        [{ text: '🆕 Начать новую сверку', callback_data: 'new_reconciliation' }],
      ],
    },
  };
}

export const replaceWbInlineKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '🔄 Заменить WB отчёт', callback_data: 'replace_wb' }],
    ],
  },
};

export const replaceBankInlineKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '🔄 Заменить выписку', callback_data: 'replace_bank' }],
    ],
  },
};
