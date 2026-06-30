import { msg } from './messages.ru';

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

export const mainMenuKeyboard = {
  reply_markup: {
    keyboard: [
      [msg.menuNewReconciliation],
      [msg.menuUploadWb, msg.menuUploadBank],
      [msg.menuRunSync, msg.menuHistory],
      [msg.menuSubscribe, msg.menuHelp],
      [msg.menuResetReconciliation],
    ],
    resize_keyboard: true,
  },
};
