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
  historyChooseFile: 'Выберите интересующий файл:',
  downloadWbFileButton: '📊 WB отчёт',
  downloadBankFileButton: '🏦 Выписка',
  fileNotFound: 'Файл не найден. Возможно, истёк срок хранения.',

  // ── Main menu ────────────────────────────────────────────────────────────────
  menuNewReconciliation: '🆕 Начать новую сверку',
  menuSubscribe: '💰 Подписка',
  menuMyCabinets: '🔑 Мои WB кабинеты',
  menuHelp: '❓ Помощь',
  menuHistory: '📜 История',
  menuStatistics: '📈 Статистика',
  menuDeleteData: '🗑 Удалить мои данные',

  // ── Access ────────────────────────────────────────────────────────────────────
  accessExpired:
    '🔓 Доступ к сверкам приостановлен. Ваши отчёты и история сохранены — вы можете продлить подписку в любой момент и продолжить без потери данных: /subscribe',
  trialAlreadyUsed: 'Вы уже использовали пробный период. Для продолжения оформите подписку: /subscribe',
  trialExpired: 'Ваш пробный период завершён. Все данные сохранены — оформите подписку, чтобы продолжить автоматический контроль выплат: /subscribe',

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
  syncCompletedOverpaid: 'Поступило больше ожидаемого.',
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
  reportExpired: '🤷‍♂️ Срок хранения этого HTML-отчёта уже истёк.',

  // ── History ─────────────────────────────────────────────────────────────────
  historyHeader: '📜 Последние сверки:',

  // ── Subscription ──────────────────────────────────────────────────────────────
  subscribeSuccess: (expiryDate: string) =>
    `Оплата прошла успешно! Ваша подписка активна до ${expiryDate}. Спасибо!`,
  subscribeActiveGreeting: (expiryDate: string): string =>
    `Ваша подписка активна до ${expiryDate}.`,
  subscribeReminderExpiry: 'Ваша подписка закончится через 3 дня. Продлите, чтобы сохранить доступ ко всем отчётам и истории: /subscribe',
  subscribeReminderInactivity:
    'Давно не сверяли выплаты? Загрузите свежие отчёты и проверьте, все ли средства поступили.',
  subscriptionStatusTrialActive: (date: string) => `Текущий статус: пробный период активен до ${date}.`,
  subscriptionStatusTrialExpired: 'Текущий статус: пробный период завершён.',
  subscriptionStatusTariffStart: (date: string) => `Текущий статус: подключен тариф «Старт» (до ${date}).`,
  subscriptionStatusTariffPro: (date: string) => `Текущий статус: подключен тариф «Профи» (до ${date}).`,
  subscriptionStatusTariffBusiness: (date: string) => `Текущий статус: подключен тариф «Бизнес» (до ${date}).`,
  tariffAlreadyActive: 'Этот тариф уже подключен.',
  chooseTariffPrompt: 'Выберите тариф:',

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
    '<b>Как пользоваться SverkaBot</b>\n\n' +
    '1. Нажмите «🆕 Начать новую сверку».\n' +
    '2. Загрузите отчёт WB (XLSX) и банковскую выписку (CSV/XLSX) с помощью кнопок.\n' +
    '3. После обработки обоих файлов нажмите «🔎 Запустить сверку».\n' +
    '4. Дождитесь завершения и получите HTML-отчёт.\n\n' +
    '<b>Что внутри отчёта:</b>\n' +
    '📊 Финансовая сводка: сколько ожидалось, сколько пришло, размер недоплаты\n' +
    '📋 Детализация: все ваши продажи и возвраты, а также банковские поступления\n' +
    '🕵️ Неидентифицированные поступления: платежи, не связанные с WB\n' +
    '📝 Готовый шаблон претензии в WB и пошаговая инструкция, как вернуть недоплату\n' +
    '🖨️ Удобная печатная версия для пересылки бухгалтеру или в поддержку\n\n' +
    '<b>Основные команды:</b>\n' +
    '/subscribe – управление подпиской\n' +
    '/my_cabinets – управление кабинетами WB (для нескольких юрлиц)\n' +
    '/history – история сверок\n' +
    '/referral – пригласить друга и получить +14 дней подписки за каждого\n' +
    '/delete_my_data – удалить все данные\n\n' +
    '<b>Тарифы</b> (оформление – /subscribe, доступна оплата за год со скидкой ~20%):\n' +
    '🚀 «Старт» – 990 ₽/мес (≈7 920 ₽/год): до 8 сверок в месяц, HTML-отчёт и шаблон претензии\n' +
    '⚡️ «Профи» – 1 990 ₽/мес (≈15 920 ₽/год): безлимитные сверки, «Статистика», до 2 кабинетов WB\n' +
    '💼 «Бизнес» – 4 990 ₽/мес (≈39 920 ₽/год): всё из «Профи» + до 5 кабинетов, экспорт (CSV/XLSX/1C), хранение 365 дней\n\n' +
    'Лимиты сверок сбрасываются ежемесячно, даже при годовой подписке.\n\n' +
    'Новым пользователям – пробный период 7 дней (до 3 сверок бесплатно).\n\n' +
    'За дополнительной помощью обращайтесь в службу поддержки: @vBorzykh.',

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

  // ── Tariff limits ───────────────────────────────────────────────────────────
  startLimitReached: (limit: number): string =>
    `Вы использовали все ${limit} сверки этого месяца по тарифу «Старт». ` +
    'Пожалуйста, выберите подходящий тариф и оплатите подписку, чтобы продолжить.',
  upgradeToProButton: '💰 Подписка',
  trialLimitReached: (limit: number): string =>
    `Вы использовали все ${limit} пробные сверки. ` +
    'Оформите подписку, чтобы продолжить проверять выплаты.',

  // ── WB cabinets ─────────────────────────────────────────────────────────────
  myCabinetsHeader: (n: number, limit: number): string =>
    `🗂 Ваши кабинеты WB (${n} из ${limit}).\nНажмите на кабинет, чтобы удалить его:`,
  myCabinetsEmpty: (limit: number): string =>
    `У вас пока нет кабинетов WB (доступно: ${limit}).\nКабинеты помогают разделять сверки по разным ИП/юрлицам.`,
  addCabinetButton: '➕ Добавить кабинет',
  upgradeToBusinessButton: '💼 Перейти на «Бизнес»',
  cabinetAddPrompt:
    'Введите название кабинета (например, «ИП Иванов» или «ООО Ромашка»), до 64 символов:',
  cabinetNameInvalid:
    'Название должно быть от 1 до 64 символов. Попробуйте ещё раз.',
  cabinetDuplicate: 'Кабинет с таким названием уже есть. Введите другое название.',
  cabinetAdded: (name: string): string => `Кабинет «${name}» добавлен.`,
  cabinetDeleted: (name: string): string =>
    `Кабинет «${name}» удалён. История сверок по нему сохранена.`,
  cabinetNotFound: 'Кабинет не найден.',
  cabinetLimitBusiness: (limit: number): string =>
    `Достигнут лимит: ${limit} кабинетов на тарифе «Бизнес». Удалите неиспользуемый кабинет, чтобы добавить новый.`,
  cabinetLimitUpgrade:
    'На вашем тарифе доступно 2 кабинета. До 5 кабинетов — на тарифе «Бизнес».',
  cabinetChoosePrompt: 'К какому кабинету относится эта сверка?',
  cabinetMustBeSelected: 'Чтобы загрузить файл, сначала выберите, к какому кабинету относится сверка.',
  cabinetChosen: (name: string): string => `Кабинет: «${name}».`,
  cabinetSelected: (name: string): string => `Выбран кабинет «${name}».`,

  // ── Statistics ──────────────────────────────────────────────────────────────
  statisticsHeader: '📈 Статистика сверок',
  statisticsTotalRuns: (n: number): string => `Всего сверок: ${n}`,
  statisticsTotalExpected: (amount: string): string => `Ожидалось к выплате: ${amount}`,
  statisticsTotalReceived: (amount: string): string => `Поступило: ${amount}`,
  statisticsTotalLoss: (amount: string): string => `Неподтверждённые выплаты: ${amount}`,
  statisticsAvgLossPercent: (pct: string): string => `Средний процент неподтверждённых выплат: ${pct}%`,
  statisticsUpgradeToPro: '📈 Статистика доступна на тарифах «Профи» и «Бизнес». Перейдите на Профи, чтобы видеть сводную аналитику.',
  statisticsFilterAll: 'Все кабинеты',
  statisticsCabinetLabel: (name: string): string => `🗂 ${name}`,

  // ── History buttons ─────────────────────────────────────────────────────────
  historyHtmlButton: '📄 Результат сверки',
  historyReportExpired: '🤷‍♂️ Срок хранения этого HTML-отчёта уже истёк.',

  // ── Export (BUSINESS) ───────────────────────────────────────────────────────
  exportBusinessOnly: 'Экспорт доступен только на тарифе «Бизнес».',
  exportNoAccessPro: '🔓 Экспорт доступен на тарифе «Бизнес», а на «Профи» и «Старт» – с аддоном «Экспорт для бухгалтера» (590 ₽/мес). Хотите выгрузить сверку для бухгалтера? Подключите: /subscribe',
  exportNoAccessOther: '🔓 Экспорт доступен на тарифе «Бизнес» или с аддоном «Экспорт для бухгалтера» (590 ₽/мес) на тарифах «Профи» и «Старт». Подробнее: /subscribe',
  exportMissingId: 'Укажите ID сверки: /export <id>',
  exportChooseFormat: 'Выберите формат экспорта',
  csvCaption: 'CSV-выгрузка результатов сверки.',
  xlsxCaption: 'Excel-отчёт по сверке.',
  export1cCaption: 'Реестр расхождений для 1С.',
  exportError: 'Не удалось сформировать файл. Попробуйте позже.',
  csvNotReady: 'Сверка не завершена или данные недоступны для экспорта.',
  exportCsvButton: '📊 CSV',
  exportXlsxButton: '📗 Excel',
  export1cButton: '📁 Для 1С',
} as const;

// ── Reconciliation verdicts ─────────────────────────────────────────────────
export const reconciliationVerdicts = {
  matched:   { title: 'Расхождений не найдено', hint: 'Сумма поступлений совпала с ожидаемой выплатой.' },
  underpaid: { title: 'Обнаружена недоплата',   hint: 'Поступило меньше ожидаемого. Проверьте расхождение.' },
  notFound:  { title: 'Выплата не найдена',     hint: 'Поступлений от Wildberries за период не обнаружено.' },
  overpaid:  { title: 'Поступило больше ожидаемого',
               hint: 'На счёт поступило больше, чем начислено к перечислению – вероятна корректировка прошлого периода.' },
} as const;
