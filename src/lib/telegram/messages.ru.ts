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
  menuMyCabinets: '🔑 Мои WB кабинеты',
  menuHelp: '❓ Помощь',
  menuHistory: '📜 История',
  menuDeleteData: '🗑 Удалить мои данные',

  // ── Access ────────────────────────────────────────────────────────────────────
  accessExpired:
    '🔓 Пробный период завершён. Выберите тариф и продолжайте сверять выплаты: /subscribe',
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
  reportExpired: '🤷‍♂️ Срок хранения этого HTML-отчёта уже истёк.',

  // ── History ─────────────────────────────────────────────────────────────────
  historyHeader: '📜 Последние сверки:',

  // ── Subscription ──────────────────────────────────────────────────────────────
  subscribeSuccess: (expiryDate: string) =>
    `Оплата прошла успешно! Ваша подписка активна до ${expiryDate}. Спасибо!`,
  subscribeActiveGreeting: (expiryDate: string): string =>
    `Ваша подписка активна до ${expiryDate}.`,
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
    '🕵️ Неидентифицированные поступления: платежи, не связанные с WB\n' +
    '📝 Готовый шаблон претензии в WB и пошаговая инструкция, как вернуть недоплату\n' +
    '🖨️ Удобная печатная версия для пересылки бухгалтеру или в поддержку\n\n' +
    '**Основные команды:**\n' +
    '/subscribe – управление подпиской\n' +
    '/my_cabinets – управление кабинетами WB (для нескольких юрлиц)\n' +
    '/history – история сверок\n' +
    '/referral – пригласить друга и получить +14 дней подписки за каждого\n' +
    '/delete_my_data – удалить все данные\n\n' +
    '**Тарифы** (оформление – /subscribe):\n' +
    '🚀 «Старт» – 990 ₽/мес: до 4 сверок в месяц, HTML-отчёт и шаблон претензии\n' +
    '⚡️ «Профи» – 1 990 ₽/мес: безлимитные сверки, экспорт в Google Sheets, страница «Динамика», приоритетная обработка\n' +
    '💼 «Бизнес» – 4 990 ₽/мес: всё из «Профи» + до 5 кабинетов WB, CSV-выгрузка для 1С, хранение отчётов 365 дней\n\n' +
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
  upgradeToProButton: '💰 Подписка', // теперь ведёт на выбор любого тарифа  
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
    'На вашем тарифе доступен 1 кабинет. Несколько кабинетов (до 5) — на тарифе «Бизнес».',
  cabinetChoosePrompt: 'К какому кабинету относится эта сверка?',
  cabinetChosen: (name: string): string => `Кабинет: «${name}».`,
  cabinetSelected: (name: string): string => `Выбран кабинет «${name}».`,

  // ── Dynamics ────────────────────────────────────────────────────────────────
  dynamicsHeader: '📊 Динамика сверок',
  dynamicsTotalRuns: (n: number): string => `Всего сверок: ${n}`,
  dynamicsTotalExpected: (amount: string): string => `Ожидалось к выплате: ${amount}`,
  dynamicsTotalReceived: (amount: string): string => `Поступило: ${amount}`,
  dynamicsTotalLoss: (amount: string): string => `Неподтверждённые выплаты: ${amount}`,
  dynamicsAvgLossPercent: (pct: string): string => `Средний процент потерь: ${pct}%`,
  dynamicsUpgradeToPro: 'Страница «Динамика» доступна на тарифах «Профи» и «Бизнес». Перейдите на Профи, чтобы видеть сводную аналитику.',
  dynamicsFilterAll: 'Все кабинеты',
  dynamicsCabinetLabel: (name: string): string => `🗂 ${name}`,

  // ── CSV export (тариф «Бизнес») ─────────────────────────────────────────────
  csvCaption: 'CSV-выгрузка транзакций по сверке.',
  csvBusinessOnly:
    'CSV-выгрузка (для 1С и бухгалтерии) доступна на тарифе «Бизнес».',
  csvMissingId: 'Укажите ID сверки: /export_csv <id>',
  csvRunNotFound: 'Сверка не найдена или не принадлежит вашему аккаунту.',
  csvNotReady: 'Сверка ещё не завершена — CSV будет доступен после её окончания.',
  csvExpired:
    'Не удалось подготовить CSV: данные этой сверки уже удалены по сроку хранения.',
  historyChooseFormat: 'В каком формате прислать отчёт?',
  historyHtmlButton: '📄 HTML',
  historyCsvButton: '📊 CSV',
  historyReportExpired: '🤷‍♂️ Срок хранения этого HTML-отчёта уже истёк.',
} as const;
