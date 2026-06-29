// All user-visible strings for the Telegram bot.
// Keep every string in Russian. Never add English user-facing strings here.

export const msg = {
  // ── Onboarding ──────────────────────────────────────────────────────────────
  welcome: `Добро пожаловать в SverkaBot — сервис сверки выплат Wildberries с банковскими выписками. Вы сможете понять, все ли выплаты дошли, какие транзакции не найдены, какие требуют проверки, и увидеть сумму неподтверждённых выплат.\n\nКак это работает:\n1) загружаете отчёт WB в формате XLSX\n2) загружаете банковскую выписку в формате XLSX или CSV\n3) бот автоматически сверяет транзакции и формирует отчёт.\n\nВаши данные защищены и обрабатываются только для целей сверки.\nДля продолжения необходимо согласие на обработку данных.`,
  consentAccept: 'Принять',
  consentDecline: 'Отказаться',
  consentDeclined: 'Без согласия использование сервиса невозможно.',
  consentAccepted: (expiryDate: string) =>
    `Спасибо! Вам открыт бесплатный доступ на 7 дней (до ${expiryDate}). В течение этого времени вы можете выполнять сверки. Теперь загрузите отчёт Wildberries и выписку банка.`,

  // ── Main menu ────────────────────────────────────────────────────────────────
  menuUploadWb: '📊 Загрузить WB отчёт',
  menuUploadBank: '🏦 Загрузить выписку',
  menuRunSync: '🔄 Запустить сверку',
  menuHistory: '📜 История',
  menuSubscribe: '💰 Подписка',
  menuHelp: '❓ Помощь',

  // ── Access ────────────────────────────────────────────────────────────────────
  accessExpired: 'Ваш доступ завершился. Для продолжения оформите подписку: /subscribe',
  trialAlreadyUsed: 'Вы уже использовали пробный период. Для продолжения оформите подписку: /subscribe',

  // ── WB upload ────────────────────────────────────────────────────────────────
  uploadWbPrompt: 'Пришлите файл отчёта Wildberries в формате XLSX. Размер не более 20 МБ.',
  uploadWbInvalidFile: 'Ошибка: неверный формат или размер файла. Пришлите XLSX до 20 МБ.',
  uploadWbReceived: (importId: string) =>
    `Файл принят, начинаю обработку. Статус можно проверить командой /status ${importId}.`,
  uploadWbCompleted: (rows: number, errors: number) =>
    `✅ Отчёт WB обработан. Загружено строк: ${rows}, ошибок: ${errors}. Теперь можно загрузить выписку банка.`,

  // ── Bank upload ───────────────────────────────────────────────────────────────
  uploadBankPrompt:
    'Пришлите выписку в формате CSV или XLSX. Размер не более 20 МБ. Мы автоматически определим структуру вашего банка.',
  uploadBankReceived: (importId: string) =>
    `Файл принят, анализирую структуру... Статус выписки можно проверить командой /status ${importId}.`,
  uploadBankMatchedProfile: (profileName: string, rows: number, errors: number) =>
    `✅ Выписка обработана. Использован профиль банка: «${profileName}». Распознано строк: ${rows}, ошибок: ${errors}.`,
  uploadBankDraftProfile:
    '⚠️ Выписка обработана, но структура банка новая. Создан черновик профиля. Точность распознавания может быть ниже. Рекомендуем проверить отчёт.',
  uploadBankManualReview: (errors: number) =>
    `⚠️ Файл обработан, но значительная часть строк не распознана (ошибок: ${errors}). Результаты сверки могут быть неполными. Мы проверим формат вашей выписки.`,
  uploadBankFailed: '❌ Не удалось распознать выписку. Попробуйте другой файл или другой формат.',
  uploadBankReady: 'Готово. Теперь можно запустить сверку.',

  // ── Reconciliation ─────────────────────────────────────────────────────────
  syncNeedBothFiles: 'Сначала загрузите оба файла — отчёт WB и выписку банка.',
  syncNeedBothFilesCompleted:
    'Сначала загрузите оба файла — отчёт WB и выписку банка, и дождитесь завершения обработки.',
  syncPeriodMismatch:
    'Периоды отчёта WB и выписки банка не совпадают. Загрузите файлы за один период.',
  syncStarted: (runId: string) =>
    `Сверка запущена. Обычно занимает до минуты. Статус: /sync_status ${runId}.`,
  syncCompleted: (
    matched: number,
    unmatched: number,
    ambiguous: number,
    lossRub: string,
    lossPercent?: string | null,
  ): string => {
    let s = `✅ Сверка завершена. Совпадений: ${matched}. Не найдено: ${unmatched}. Неоднозначно: ${ambiguous}. Сумма неподтверждённых выплат: ${lossRub} ₽.`;
    if (lossPercent) s += `\nПроцент неподтверждённых выплат от оборота: ${lossPercent}%`;
    return s;
  },
  syncLowConfidenceWarning:
    '⚠️ Выписка была распознана с низкой уверенностью. Результаты сверки могут быть неточны.',
  syncNoEligibleImports:
    'Не найдено подходящих завершённых импортов для сверки. Загрузите отчёт WB и выписку банка.',
  syncDownloadReport: 'Скачать отчёт',

  // ── Report ────────────────────────────────────────────────────────────────────
  reportReady: (url: string) =>
    `Ваш отчёт готов: ${url}. Он содержит сводку, совпадения, расхождения и детали оценки.`,
  reportNotReady: 'Отчёт ещё не готов, попробуйте позже.',
  reportCaption: (runId: string) =>
    `Отчёт по сверке ${runId} готов. Содержит сводку, совпадения, расхождения и детали оценки.`,

  // ── History ───────────────────────────────────────────────────────────────────
  historyHeader: '📜 Последние сверки:',

  // ── Subscription ──────────────────────────────────────────────────────────────
    subscribeTrialStatus: (expiryDate: string, paymentUrl: string) =>
    `Ваш статус: Пробный период (активен до ${expiryDate}).\n\nСтоимость подписки: 1 500 ₽ за 30 дней.\nОплатить: ${paymentUrl}`,
  subscribeActiveStatus: (expiryDate: string, paymentUrl: string) =>
    `Ваш статус: Активна (до ${expiryDate}).\n\nСтоимость продления: 1 500 ₽ за 30 дней.\nПродлить подписку: ${paymentUrl}`,
  subscribeExpiredStatus: (paymentUrl: string) =>
    `Ваш доступ закончился.\n\nСтоимость подписки: 1 500 ₽ за 30 дней.\nЧтобы продолжить, оформите подписку: ${paymentUrl}`,
  subscribeSuccess: (expiryDate: string) =>
    `Оплата прошла успешно! Ваша подписка активна до ${expiryDate}. Спасибо!`,
  subscribeReminderExpiry: 'Ваша подписка закончится через 3 дня. Продлите, чтобы не потерять доступ: /subscribe',
  subscribeReminderInactivity:
    'Давно не сверяли выплаты? Загрузите свежие отчёты и проверьте, все ли средства поступили.',

  // ── Sync status command ───────────────────────────────────────────────────────
  syncStatusMissingId: 'Укажите ID сверки: /sync_status <id>',
  syncStatusNotFound: 'Сверка не найдена или не принадлежит вашему аккаунту.',
  syncStatusPending: (runId: string) => `⏳ Сверка ${runId} ожидает обработки.`,
  syncStatusRunning: (runId: string) => `🔄 Сверка ${runId} выполняется. Пожалуйста, подождите.`,
  syncStatusAmbiguousWarning: (amountRub: string) =>
    `⚠️ Неоднозначных транзакций на сумму ${amountRub} ₽. Рекомендуем проверить вручную.`,
  syncStatusDownloadReport: (runId: string) => `Для скачивания отчёта: /get_report ${runId}`,
  syncStatusFailed: (runId: string) =>
    `❌ Сверка завершилась с ошибкой. ID: ${runId}. Попробуйте запустить сверку снова или обратитесь в поддержку.`,
  syncStatusUnknown: (status: string) => `Статус сверки: ${status}`,

  // ── Help command ──────────────────────────────────────────────────────────────
  helpText:
    '/upload_wb — загрузить отчёт WB\n' +
    '/upload_bank — загрузить выписку банка\n' +
    '/run_sync — запустить сверку\n' +
    '/history — история сверок\n' +
    '/subscribe — управление подпиской\n' +
    '/retry_import <id> — повторить обработку файла\n' +
    '/cancel <id> — отменить обработку или сверку\n' +
    '/delete_my_data — удалить мои данные',

  // ── Import / sync status stubs ─────────────────────────────────────────────────
  importStatusMissingId: 'Введите ID импорта: /status <id>',
  syncStatusMissingIdShort: 'Введите ID сверки: /sync_status <id>',

  // ── Delete data ───────────────────────────────────────────────────────────────
  deleteConfirmPrompt:
    'Вы действительно хотите удалить все свои данные — файлы, импорты и сверки? Это действие необратимо.',
  deleteConfirm: 'Да, удалить',
  deleteCancel: 'Отмена',
  deleteSuccess:
    'Все ваши данные удалены. Если захотите пользоваться сервисом снова, отправьте /start.',
  deleteCancelled: 'Удаление отменено.',
  deleteError: 'Произошла ошибка при удалении данных. Попробуйте позже.',

  // ── Upload shared ─────────────────────────────────────────────────────────────
  uploadDuplicateImport: (importId: string) =>
    `Этот файл уже был загружен ранее (ID: ${importId}). Используйте /status ${importId} для проверки статуса.`,

  // ── Error messages ─────────────────────────────────────────────────────────────
  errFileTooLarge: 'Файл слишком большой. Максимум 20 МБ.',
  errInvalidFormat: 'Неподдерживаемый формат. Загрузите XLSX или CSV.',

  // ── Admin ──────────────────────────────────────────────────────────────────────
  adminNotAuthorized: 'Нет доступа.',
  adminProfilesHeader: '📋 Профили банковских выписок:',
  adminProfileRow: (id: string, name: string, status: string, usage: number, rate: string) =>
    `• ${name} [${status}] — использований: ${usage}, точность: ${rate}%\n  ID: ${id}`,
  adminNoProfiles: 'Профили не найдены.',
  adminProfileActivated: (id: string) => `Профиль ${id} активирован.`,
  adminProfileDeprecated: (id: string) => `Профиль ${id} помечен как устаревший.`,
  adminProfileNotFound: 'Профиль не найден.',
  adminProfileMissingId: 'Укажите ID профиля: /activate_profile <id>',
  adminStatsHeader: '📊 Статистика системы:',
  adminErrorsHeader: '⚠️ Последние ошибки парсинга:',
  adminErrorRow: (importId: string, row: number, code: string, message: string) =>
    `• Импорт ${importId.slice(0, 8)}..., строка ${row}: [${code}] ${message}`,
  adminNoErrors: 'Ошибок парсинга за последние 30 дней не найдено.',
  adminRetryQueued: (runId: string, jobId: string) =>
    `Повторная генерация отчёта поставлена в очередь.\nСверка: ${runId}\nЗадача: ${jobId}`,
  adminRetryMissingId: 'Укажите ID сверки: /retry_export <run_id>',
  adminRunNotFound: 'Сверка не найдена.',

  // ── Phase 3 additions ───────────────────────────────────────────────────────
  historyEmpty: '🤷‍♂️ История сверок отсутствует.',
  historyEntry: (n: number, dateStr: string, lossKopeks: bigint): string => {
    const fmtRub = (k: bigint): string => {
      const neg = k < BigInt(0);
      const a = neg ? -k : k;
      const whole = (a / BigInt(100))
        .toString()
        .replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
      const cents = (a % BigInt(100)).toString().padStart(2, '0');
      return `${neg ? '−' : ''}${whole},${cents} ₽`;
    };
    return lossKopeks > BigInt(0)
      ? `${n}. ${dateStr} — неподтверждённые выплаты: ${fmtRub(lossKopeks)}`
      : `${n}. ${dateStr} — расхождений не найдено`;
  },
  deleteNothing:
    '🤷 Данных для удаления не найдено — вы ещё не загружали файлы и не запускали сверки.',
  uploadNoSession:
    'Чтобы загрузить файл, сначала нажмите «📊 Загрузить WB отчёт» или «🏦 Загрузить выписку», затем пришлите документ.',
  uploadError: 'Не удалось обработать файл. Попробуйте ещё раз через минуту.',
  syncGenericError: 'Не удалось запустить сверку. Попробуйте ещё раз через минуту.',

  // ── /status (import) ─────────────────────────────────────────────────────────
  importStatusNotFound: 'Импорт не найден.',
  importStatusReceived: 'Файл принят и ожидает обработки.',
  importStatusProcessing: 'Файл обрабатывается, подождите немного.',
  importStatusFailed: '❌ Не удалось обработать файл.',
  importStatusCompleted: (
    quality: string,
    parseRate: string | number,
    errorCount: number,
  ): string =>
    `✅ Обработка завершена. Качество распознавания: ${quality}. Доля распознанных строк: ${parseRate}%. Ошибок в строках: ${errorCount}.`,

  // ── /get_report ──────────────────────────────────────────────────────────────
  getReportNotFound: 'Сверка не найдена.',
  getReportNotReady: 'Сверка ещё не завершена. Проверьте статус: /sync_status <run_id>.',
  getReportGenerating: 'Готовлю отчёт — он придёт в течение минуты.',
  getReportError: 'Не удалось получить отчёт. Попробуйте позже.',
  getReportCaption: 'Ваш отчёт по сверке.',
    // ── Retry import ──
  retryMissingId: 'Укажите ID импорта: /retry_import <id>',
  retryNotFound: 'Импорт не найден или не принадлежит вашему аккаунту.',
  retryAlreadyDone: 'Файл уже успешно обработан. Если нужно загрузить новый файл, отправьте его через /upload_wb или /upload_bank.',
  retryNotAllowed: 'Повторная обработка доступна только для импортов со статусом «ошибка» или «отменён».',
  retryNoFile: 'Файл импорта недоступен. Загрузите его заново через /upload_wb или /upload_bank.',
  retryQueued: (id: string) => `Повторная обработка файла запущена. Статус: /status ${id}.`,
  // ── Cancel ──
  cancelMissingId: 'Укажите ID: /cancel <id>',
  cancelNotFound: 'Объект не найден или не принадлежит вашему аккаунту.',
  cancelNotAllowed: 'Операция уже завершена или отменена. Отмена невозможна.',
  cancelImportDone: 'Обработка файла отменена. Вы можете начать заново.',
  cancelRunDone: 'Сверка отменена. Вы можете запустить новую сверку.',
} as const;
