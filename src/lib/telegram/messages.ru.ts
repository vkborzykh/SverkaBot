// All user-visible strings for the Telegram bot.
// Keep every string in Russian. Never add English user-facing strings here.

export const msg = {
  // ── Onboarding ──────────────────────────────────────────────────────────────
  welcome: `Добро пожаловать в SverkaBot – ваш персональный аудитор выплат Wildberries. Я автоматически сверю еженедельный отчёт WB с банковской выпиской и покажу, сколько денег вы недополучили.\n\nЗагрузите два файла, и через минуту вы получите детальный HTML-отчёт:\n📊 Раскладка по каждой продаже и возврату\n💰 Все поступления от Wildberries и неопознанные платежи\n🚨 Сумма недоплаты и процент потерь\n📝 Готовый шаблон претензии и инструкция, как вернуть свои деньги\n\nЭто займёт не больше минуты, а экономия может составить десятки тысяч рублей. Для продолжения необходимо согласие на обработку данных.`,
  consentAccept: 'Принять',
  consentDecline: 'Отказаться',
  consentDeclined: 'Без согласия использование сервиса невозможно.',
  consentAccepted: (expiryDate: string) =>
    `Вам открыт бесплатный доступ на 7 дней (до ${expiryDate}).`,

  // ── Main menu ────────────────────────────────────────────────────────────────
  menuNewReconciliation: '🆕 Начать новую сверку',
  menuSubscribe: '💰 Подписка',
  menuHelp: '❓ Помощь',
  menuHistory: '📜 История',
  menuDeleteData: '🗑 Удалить мои данные',

  // ── Access ────────────────────────────────────────────────────────────────────
  accessExpired: '🔓 Пробный период завершён. Оформите подписку за 1 500 ₽ на 30 дней.',
  trialAlreadyUsed: 'Вы уже использовали пробный период. Для продолжения оформите подписку: /subscribe',
  trialExpired: 'Ваш пробный период завершён. Оформите подписку – /subscribe',


  // ── New reconciliation flow ────────────────────────────────────────────────
  newReconciliationPrompt:
    'Начинаем новую сверку.\nНажмите кнопку ниже, чтобы загрузить WB отчёт 📊',
  wbAlreadyUploaded: 'Отчёт WB уже был загружен. Если хотите заменить, нажмите «🔄 Заменить WB отчёт».',
  bankAlreadyUploaded: 'Банковская выписка уже была загружена. Если хотите заменить, нажмите «🔄 Заменить выписку».',

  // ── WB upload ──────────────────────────────────────────────────────────────
  uploadWbPrompt: 'Пришлите файл отчёта Wildberries в формате XLSX. Размер не более 20 МБ.',
  uploadWbReceived: 'Файл принят, начинаю обработку.',
  uploadWbCompleted: '✅ Отчёт WB обработан. Теперь можно загрузить выписку банка.',

  // ── Bank upload ─────────────────────────────────────────────────────────────
  uploadBankPrompt:
    'Пришлите выписку в формате CSV или XLSX. Размер не более 20 МБ. Мы автоматически определим структуру вашего банка.',
  uploadBankReceived: 'Файл принят, анализирую структуру.',
  uploadBankCompleted: '✅ Выписка обработана. Теперь можно запустить сверку.',

  // ── Reconciliation ─────────────────────────────────────────────────────────
  syncStarted: 'Сверка запущена.',
  syncCompleted: (expected: string, received: string): string =>
    `✅ Сверка завершена. Ожидалось к выплате: ${expected}. Поступило от Wildberries: ${received}.`,
  syncCompletedReconciled: 'Расхождений не найдено.',
  syncCompletedOverpaid: 'Поступило больше ожидаемого – расхождений в вашу пользу.',
  syncCompletedUnderpaid: 'Возможная недоплата.',
  syncCompletedMissing: 'Поступлений от Wildberries не найдено.',
  syncReportGenerating: '📄 Готовлю отчёт – он придёт в течение минуты.',
  syncNeedBothFiles: 'Сначала загрузите оба файла – отчёт WB и выписку банка.',
  syncNeedBothFilesCompleted:
    'Сначала загрузите оба файла – отчёт WB и выписку банка, и дождитесь завершения обработки.',
  syncPeriodMismatch:
    'Период банковской выписки не покрывает период отчёта WB. Проверьте файлы.',
  reconciliationCompleted: 'Можете начать новую сверку.',

  // ── Report ──────────────────────────────────────────────────────────────────
  reportReady: (url: string) =>
    `Ваш отчёт готов: ${url}.`,
  reportNotReady: 'Отчёт ещё не готов, попробуйте позже.',
  reportCaption: 'Ваш отчёт по сверке.',

  // ── History ─────────────────────────────────────────────────────────────────
  historyHeader: '📜 Последние сверки:',

  // ── Subscription ──────────────────────────────────────────────────────────────
  subscribeSuccess: (expiryDate: string) =>
    `Оплата прошла успешно! Ваша подписка активна до ${expiryDate}. Спасибо!`,
  subscribeReminderExpiry: 'Ваша подписка закончится через 3 дня. Продлите, чтобы не потерять доступ: /subscribe',
  subscribeReminderInactivity:
    'Давно не сверяли выплаты? Загрузите свежие отчёты и проверьте, все ли средства поступили.',

  // ── Sync status command ─────────────────────────────────────────────────────
  syncStatusMissingId: 'Укажите ID сверки: /sync_status <id>',
  syncStatusNotFound: 'Сверка не найдена или не принадлежит вашему аккаунту.',
  syncStatusPending: (runId: string) => `⏳ Сверка ${runId} ожидает обработки.`,
  syncStatusRunning: (runId: string) => `🔄 Сверка ${runId} выполняется. Пожалуйста, подождите.`,
  syncStatusDownloadReport: (runId: string) => `Для скачивания отчёта: /get_report ${runId}`,
  syncStatusFailed: (runId: string) =>
    `❌ Сверка завершилась с ошибкой. ID: ${runId}. Попробуйте запустить сверку снова или обратитесь в поддержку.`,
  syncStatusUnknown: (status: string) => `Статус сверки: ${status}`,

  // ── Help command ────────────────────────────────────────────────────────────
  helpText:
    '❓ **Как пользоваться SverkaBot**\n\n' +
    '1. Нажмите «🆕 Начать новую сверку».\n' +
    '2. Загрузите отчёт WB (XLSX) и банковскую выписку (CSV/XLSX) с помощью кнопок.\n' +
    '3. После обработки обоих файлов нажмите «🔎 Запустить сверку».\n' +
    '4. Дождитесь завершения и получите HTML-отчёт.\n\n' +
    '**Что внутри отчёта:**\n' +
    '📊 Финансовая сводка: сколько ожидалось, сколько пришло, размер недоплаты\n' +
    '📋 Детализация: все ваши продажи и возвраты, а также банковские поступления\n' +
    '🕵️ Неидентифицированные поступления: платежи, не связанные с WB (возможно, возвраты или ошибки)\n' +
    '📝 Готовый шаблон претензии в WB и пошаговая инструкция, как вернуть недоплату\n' +
    '🖨️ Удобная печатная версия для пересылки бухгалтеру или в поддержку\n\n' +
    'Полный HTML-отчёт доступен по подписке (1 500 ₽/30 дней).\n\n' +
    'SverkaBot – это ваш шанс перестать терять деньги на ошибках выплат Wildberries.\n\n' +
    'За дополнительной помощью обращайтесь в службу технической поддержки: @vBorzykh.',

  // ── Import / sync status stubs ──────────────────────────────────────────────
  importStatusMissingId: 'Введите ID импорта: /status <id>',
  syncStatusMissingIdShort: 'Введите ID сверки: /sync_status <id>',

  // ── Delete data ─────────────────────────────────────────────────────────────
  deleteConfirmPrompt:
    'Вы действительно хотите удалить все свои данные – файлы, импорты и сверки? Это действие необратимо.',
  deleteConfirm: 'Да, удалить',
  deleteCancel: 'Отмена',
  deleteSuccess:
    'Все ваши данные удалены. Если захотите пользоваться сервисом снова, отправьте /start.',
  deleteCancelled: 'Удаление отменено.',
  deleteError: 'Произошла ошибка при удалении данных. Попробуйте позже.',

  // ── Upload shared ───────────────────────────────────────────────────────────
  uploadDuplicateImport: (importId: string) =>
    `Этот файл уже был загружен ранее.`,
  uploadDuplicateWbWarning: 'Обратите внимание: этот отчёт WB уже был загружен ранее.',
  uploadDuplicateBankWarning: 'Обратите внимание: эта выписка уже была загружена ранее.',
  uploadNoSession:
    'Чтобы загрузить файл, сначала нажмите «🆕 Начать новую сверку».',
  uploadError: 'Не удалось обработать файл. Попробуйте ещё раз.',

  // ── Error messages ──────────────────────────────────────────────────────────
  errFileTooLarge: 'Файл слишком большой. Максимум 20 МБ.',
  errInvalidFormat: 'Неподдерживаемый формат. Загрузите XLSX или CSV.',

  // ── Admin ───────────────────────────────────────────────────────────────────
  adminNotAuthorized: 'Нет доступа.',
  adminProfilesHeader: '📋 Профили банковских выписок:',
  adminProfileRow: (id: string, name: string, status: string, usage: number, rate: string) =>
    `• ${name} [${status}] – использований: ${usage}, точность: ${rate}%\n  ID: ${id}`,
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

  // ── History / empty states ─────────────────────────────────────────────────
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
      ? `${n}. ${dateStr} – неподтверждённые выплаты: ${fmtRub(lossKopeks)}`
      : `${n}. ${dateStr} – расхождений не найдено`;
  },
  deleteNothing:
    '🤷 Данных для удаления не найдено – вы ещё не загружали файлы и не запускали сверки.',

  // ── /status (import) ────────────────────────────────────────────────────────
  importStatusNotFound: 'Импорт не найден.',
  importStatusReceived: 'Файл принят и ожидает обработки.',
  importStatusProcessing: 'Файл обрабатывается, подождите немного.',
  importStatusFailed: '❌ Не удалось обработать файл.',
  importStatusCompleted: (quality: string, parseRate: string | number, errorCount: number): string =>
    `✅ Обработка завершена.`,

  // ── /get_report ─────────────────────────────────────────────────────────────
  getReportNotFound: 'Сверка не найдена.',
  getReportNotReady: 'Сверка ещё не завершена.',
  getReportGenerating: 'Готовлю отчёт – он придёт в течение минуты.',
  getReportError: 'Не удалось получить отчёт. Попробуйте позже.',

  // ── Retry import ────────────────────────────────────────────────────────────
  retryMissingId: 'Укажите ID импорта: /retry_import <id>',
  retryNotFound: 'Импорт не найден.',
  retryAlreadyDone: 'Файл уже успешно обработан.',
  retryNotAllowed: 'Повторная обработка недоступна.',
  retryNoFile: 'Файл недоступен.',
  retryQueued: (id: string) => `Повторная обработка запущена.`,

  // ── Cancel ──────────────────────────────────────────────────────────────────
  cancelMissingId: 'Укажите ID: /cancel <id>',
  cancelNotFound: 'Объект не найден.',
  cancelNotAllowed: 'Операция уже завершена или отменена.',
  cancelImportDone: 'Обработка файла отменена.',
  cancelRunDone: 'Сверка отменена.',
} as const;
