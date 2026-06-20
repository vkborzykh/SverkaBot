# SverkaBot — User Flow v3.2

This document supersedes User Flow v3.1 and defines the canonical user journey, system messages, button labels, status transitions, admin actions, and edge-case behavior for the production product.

Aligned with: PRD 6.1, Tech Plan 6.1, API Notes 3.1, DB Draft v4.1, Security Spec v1.1

Purpose: provide a single source of truth for all Telegram interactions. All user-facing text must be Russian.

Core decisions:
- HTML is the primary report format.
- Google Sheets is optional.
- ZIP is not part of the product contract.
- `source_type` and `marketplace` are separate concepts.
- `MANUAL_REVIEW` is a quality status only.
- `/stats` is user-facing.
- `/admin_metrics` is admin-facing.
- `/retry_import` works only for `FAILED` and `CANCELLED`.
- Import cancellation is allowed only for `RECEIVED` and `PARSING`.
- Reconciliation cancellation is allowed only for `PENDING` and `RUNNING`.
- Trial abuse prevention persists through deletion.
- Consent requires offer and privacy policy links.

## Flow 1 — First launch and consent

User sends `/start`.

If the user does not exist, show a welcome message and consent prompt.

Recommended text:
`Добро пожаловать в SverkaBot — сервис сверки выплат Wildberries с банковскими выписками. Сервис помогает найти неподтверждённые выплаты, расхождения и потенциально отсутствующие суммы. Для продолжения необходимо согласие на обработку данных и принятие условий оферты.`

Buttons:
- `Принять`
- `Отказаться`

Include links to:
- оферта
- политика конфиденциальности

If user rejects:
`Без согласия использование сервиса невозможно.`

If user accepts:
- create user if needed;
- record consent version and privacy policy version;
- set `has_used_trial = true`;
- set `subscription_status = TRIAL`;
- set `trial_started_at = now`;
- set `trial_ends_at = now + 7 days`;
- open main menu.

Bot text:
`Спасибо! Вам открыт бесплатный доступ на 7 дней (до ДД.ММ.ГГГГ). Теперь загрузите отчёт Wildberries и выписку банка.`

If the user already used trial, do not grant a new one:
`Вы уже использовали пробный период. Для продолжения оформите подписку: /subscribe`

## Main menu

Buttons:
- `📄 Загрузить WB отчёт`
- `🏦 Загрузить выписку`
- `🔄 Запустить сверку`
- `📜 История`
- `📊 Статистика`
- `💰 Подписка`
- `❓ Помощь`

Commands:
- `/upload_wb`
- `/upload_bank`
- `/run_sync`
- `/history`
- `/stats`
- `/subscribe`
- `/status <id>`
- `/sync_status <run_id>`
- `/get_report <run_id>`
- `/retry_import <id>`
- `/cancel <id>`
- `/delete_my_data`

## Flow 2 — Upload Wildberries report

User clicks `📄 Загрузить WB отчёт` or sends `/upload_wb`.

Access check:
- allowed only in `TRIAL` or `ACTIVE`

If access expired:
`Ваш доступ завершился. Оформите подписку: /subscribe`

Ask:
`Пришлите файл отчёта Wildberries в формате XLSX. Размер не более 20 МБ.`

Validation:
- XLSX only
- max 20 MB
- compute hash
- reject duplicates by `(user_id, source_type, file_hash)`
- store in encrypted Supabase Storage

If invalid:
`Ошибка: неверный формат или размер файла. Пришлите XLSX до 20 МБ.`

If valid:
- create import with `RECEIVED`
- enqueue `PARSE_WB`
- reply:
`Файл принят, начинаю обработку. Статус можно проверить командой /status <id>.`

Parsing flow:
1. fetch file
2. detect header
3. normalize dates and amounts
4. create canonical WB transactions
5. store malformed rows in `parsing_errors`
6. compute quality

Parsing outcomes:
- structurally valid + row errors → `COMPLETED`
- structurally unreadable → `FAILED`
- quality below threshold → `LOW_CONFIDENCE` or `MANUAL_REVIEW` as quality status

Completion text:
`✅ Отчёт WB обработан. Загружено строк: X, ошибок: Y. Теперь можно загрузить выписку банка.`

If failed structurally:
`❌ Не удалось распознать отчёт WB. Попробуйте другой файл.`

## Flow 3 — Upload bank statement

User clicks `🏦 Загрузить выписку` or sends `/upload_bank`.

Access check is the same.

Ask:
`Пришлите выписку в формате XLSX или CSV. Размер не более 20 МБ. Мы автоматически определим структуру банка.`

CSV delimiter handling:
- autodetect among `;`, `,`, `\t`
- user override with `/upload_bank csv;` or `/upload_bank csv,`
- invalid override returns an immediate error

If invalid delimiter:
`Неверный разделитель. Используйте ; или ,`

Validation:
- XLSX or CSV only
- max 20 MB
- compute hash
- reject duplicates
- store in encrypted Supabase Storage
- create import with `RECEIVED`
- store delimiter if known
- enqueue `PARSE_BANK`

Bot text:
`Файл принят, анализирую структуру...`

Parsing flow:
1. detect format
2. inspect rows and table regions
3. generate header candidates
4. score candidates
5. resolve active profile if possible
6. otherwise create draft profile automatically
7. canonicalize rows
8. store parsing evidence and truncated debug fragments

Normalization rules:
- common date formats
- comma or dot decimal separators
- minus sign, trailing minus, parentheses
- trim and lowercase text fields for matching

If profile matched:
`✅ Выписка обработана. Использован профиль банка: «[profile name]». Распознано строк: X, ошибок: Y.`

If no profile matched:
`⚠️ Выписка обработана, но структура банка новая. Создан черновик профиля. Точность распознавания может быть ниже. Рекомендуем проверить отчёт.`

If parse quality is low:
`⚠️ Файл обработан, но значительная часть строк не распознана (ошибок: Y). Результаты сверки могут быть неполными. Мы проверим формат вашей выписки.`

If structurally unreadable:
`❌ Не удалось распознать выписку. Попробуйте другой файл или другой формат.`

Completion text:
`Готово. Теперь можно запустить сверку.`

## Flow 4 — Run reconciliation

User clicks `🔄 Запустить сверку` or sends `/run_sync`.

System checks:
- at least one completed WB import;
- at least one completed bank import;
- same user ownership;
- periods overlap within configured tolerance.

If missing:
`Сначала загрузите оба файла — отчёт WB и выписку банка, и дождитесь завершения обработки.`

If period mismatch:
`Периоды отчёта WB и выписки банка не совпадают. Загрузите файлы за один месяц.`

If no eligible imports:
`Не найдено подходящих завершённых импортов для сверки. Загрузите отчёт WB и выписку банка.`

If eligible:
- create `reconciliation_run` with `PENDING`
- enqueue `RECONCILE`
- reply:
`Сверка запущена. Обычно занимает до минуты. Статус: /sync_status <run_id>.`

Reconciliation steps:
1. generate candidates with hard filters
2. score candidates
3. perform conflict-aware matching
4. prevent double use of rows
5. support split and combined matches up to configured limits
6. mark ambiguous cases
7. store evidence and reason codes

Hard filters:
- direction
- currency
- exact amount in MVP
- date window default ±7 days

Final statuses:
- `MATCHED`
- `UNMATCHED`
- `AMBIGUOUS`
- `SPLIT_MATCHED`
- `COMBINED_MATCHED`

Completion message:
`✅ Сверка завершена. Совпадений: X. Не найдено: Y. Неоднозначно: Z. Сумма неподтверждённых выплат: <сумма> ₽.`

If there is unreconciled amount:
`Процент неподтверждённых выплат от оборота: <X.X>%`

If bank import quality is low:
`⚠️ Выписка была распознана с низкой уверенностью. Результаты сверки могут быть неточны.`

Then:
`📄 Готовлю отчёт — он придёт в течение минуты.`

If no candidates exist, the run still completes with unmatched rows.

## Flow 5 — View and receive report

After reconciliation completes, the report is prepared.

Primary format:
- HTML

Optional format:
- Google Sheets read-only link

ZIP is not used.

Bot text when report is ready:
`Ваш отчёт готов: [ссылка]. Он содержит сводку, совпадения, расхождения, детали оценки и данные для претензии.`

If Google Sheets is available:
`Ваш отчёт также доступен в Google Sheets: [ссылка]`

HTML report should include:
- summary
- run metadata
- matched rows
- unmatched rows
- ambiguous groups
- WB rows
- bank rows
- evidence
- parsing errors
- claim-ready section
- metrics

All headers and labels in the report must be Russian.

## Flow 6 — History

User clicks `📜 История` or sends `/history`.

Fetch latest 10 reconciliation runs.

Bot text:
`📜 Последние сверки:`

Each entry should include:
- date
- profile/bank name
- match rate or summary
- unreconciled amount
- unreconciled percent if present
- report link/button

If empty:
`🤷‍♂️ История сверок отсутствует.`

## Flow 7 — User statistics

User sends `/stats`.

System calculates:
- total reconciliations;
- number without unreconciled amount;
- total unreconciled amount;
- average unreconciled percentage over runs with loss;
- run with maximum unreconciled amount.

Bot reply:
`📊 Ваша статистика сверок:
• Всего сверок: 5
• Из них без неподтверждённых выплат: 3
• Суммарная сумма неподтверждённых выплат: 12 345,67 ₽
• Средний процент неподтверждённых выплат: 2.3%
• Максимальная сумма неподтверждённых выплат: 5 678,90 ₽ (сверка от 15.06.2026)`

If empty:
`🤷 Статистика пока отсутствует. Запустите сверку, чтобы получить данные.`

## Flow 8 — Subscription management

User clicks `💰 Подписка` or sends `/subscribe`.

If trial active:
`Ваш статус: Пробный период (активен до ДД.ММ.ГГГГ). Подписка на 30 дней стоит 1 500 ₽. Оплатить: [Ссылка на оплату]`

If active:
`Ваш статус: Активна (до ДД.ММ.ГГГГ). Продлить подписку: [Ссылка на оплату]`

If expired:
`Ваш доступ закончился. Чтобы продолжить, оформите подписку: [Ссылка на оплату]`

After successful payment:
`Оплата прошла успешно! Ваша подписка активна до ДД.ММ.ГГГГ. Спасибо!`

Reminder:
`Ваша подписка закончится через 3 дня. Продлите, чтобы не потерять доступ: /subscribe`

Inactivity reminder:
`Давно не сверяли выплаты? Загрузите свежие отчёты и проверьте, все ли средства поступили.`

## Flow 9 — Retry failed import

User sends `/retry_import <import_id>`.

Allowed only if:
- import belongs to the user;
- import status is `FAILED` or `CANCELLED`;
- file still exists.

If valid:
`Повторная обработка файла запущена. Статус: /status <import_id>.`

If completed:
`Файл уже успешно обработан. Если нужно загрузить новый файл, отправьте его через /upload_wb или /upload_bank.`

If not found or not owned:
`Импорт не найден или не принадлежит вашему аккаунту.`

## Flow 10 — Cancel operation

User sends `/cancel <id>`.

Import cancellation:
- allowed only for `RECEIVED` or `PARSING`
- set status to `CANCELLED`
- signal the worker if possible
- reply:
`Обработка файла отменена. Вы можете начать заново.`

Reconciliation cancellation:
- allowed only for `PENDING` or `RUNNING`
- set run status to `CANCELLED`
- cancel related report generation if possible
- reply:
`Сверка отменена. Вы можете запустить новую сверку.`

If already completed or failed:
`Операция уже завершена или отменена. Отмена невозможна.`

If object not found or not owned:
`Объект не найден или не принадлежит вашему аккаунту.`

## Flow 11 — Delete my data

User sends `/delete_my_data`.

Ask for confirmation:
`Вы действительно хотите удалить все свои данные — файлы, импорты и сверки? Это действие необратимо.`

Buttons:
- `Да, удалить`
- `Отмена`

If confirmed:
- delete storage artifacts;
- delete canonical transactions;
- delete reconciliation artifacts;
- soft-delete imports;
- anonymize user record;
- preserve `has_used_trial`;
- keep audit events.

Reply:
`Все ваши данные удалены. Если захотите пользоваться сервисом снова, отправьте /start.`

If cancelled:
Return to the main menu.

## Flow 12 — Admin commands

Available only to `TELEGRAM_ADMIN_IDS`.

Commands:
- `/view_profiles`
- `/activate_profile <profile_id>`
- `/deprecate_profile <profile_id>`
- `/view_errors`
- `/admin_metrics`
- `/retry_export <run_id>`

Behavior:
- profiles must not expose raw sensitive rows;
- parsing errors are truncated and limited to the last 30 days;
- export retry only for eligible failed runs;
- admin metrics show funnel, import quality, reconciliation quality, and monetization.

Admin replies must be in Russian.

Admin alerts:
When a worker fails or threshold is exceeded, send Telegram alert with:
- job type;
- job id;
- user id if available;
- error message;
- truncated stack trace.

Example:
`❌ Критическая ошибка в воркере:
Задача: RECONCILE
ID: 123e4567-e89b-12d3-a456-426614174000
Пользователь: 123456789
Ошибка: Connection timeout
Stack: ...`

## Edge cases

- Running reconciliation without both completed files:
  `Сначала загрузите оба файла — отчёт WB и выписку банка, и дождитесь завершения обработки.`

- No eligible imports:
  `Не найдено подходящих завершённых импортов для сверки. Загрузите отчёт WB и выписку банка.`

- File too large:
  `Файл слишком большой. Максимум 20 МБ.`

- Unsupported format:
  `Неподдерживаемый формат. Загрузите XLSX или CSV.`

- Malformed rows:
  continue import and store row-level errors

- Low bank confidence:
  warn during reconciliation

- No candidates:
  run completes normally with unmatched rows

- Report generation failure:
  retry a small number of times and alert admin; ZIP fallback is never offered

- Retry completed import:
  tell the user to upload a new file

- Cancel completed/failed task:
  tell the user cancellation is not possible

- Repeated trial after deletion:
  `Вы уже использовали пробный период. Для продолжения оформите подписку: /subscribe`

## Async behavior

Long-running operations are background jobs:
- file parsing
- profile resolution
- reconciliation
- report generation
- cleanup
- reminders

User progress queries:
- `/status <import_id>`
- `/sync_status <run_id>`

The bot must notify the user on completion, failure, or cancellation.

End of User Flow v3.2.
