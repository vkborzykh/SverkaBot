import { Markup } from 'telegraf';
import { msg } from './messages.ru';

export const consentKeyboard = Markup.inlineKeyboard([
  [
    Markup.button.callback(msg.consentAccept, 'consent:accept'),
    Markup.button.callback(msg.consentDecline, 'consent:decline'),
  ],
]);

export const mainMenuKeyboard = Markup.keyboard([
  [msg.menuUploadWb, msg.menuUploadBank],
  [msg.menuRunSync, msg.menuHistory],
  [msg.menuSubscribe, msg.menuHelp],
]).resize();

export const deleteConfirmKeyboard = Markup.inlineKeyboard([
  [
    Markup.button.callback(msg.deleteConfirm, 'delete:confirm'),
    Markup.button.callback(msg.deleteCancel, 'delete:cancel'),
  ],
]);
