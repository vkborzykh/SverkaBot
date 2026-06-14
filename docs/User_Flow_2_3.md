```markdown
# SverkaBot User Flow v2.3 (for Bolt AI implementation)

This document describes the exact user journey step by step, including system messages, button labels, status transitions, and admin actions. All user-facing text is in Russian. Command names may remain technical English names such as `/start`, `/upload_wb`, `/upload_bank`, `/run_sync`, `/status`, `/history`, and `/subscribe`, while help text and descriptions remain in Russian.

Changes in v2.3: deletion flow (Flow 9) aligned with the canonical sequence from DB Draft v2.4; `metrics.csv` added to the report ZIP; `MANUAL_REVIEW` handling added; duplicate check no longer references the period; `display_name` source for profile/bank names specified; read-only access for `EXPIRED` users clarified.

---

## Flow 1 — First launch (onboarding)

User sends `/start`.  
System checks whether the user exists. If not, onboarding begins.

Bot replies in Russian:

`Добро пожаловать в SverkaBot — сервис сверки выплат Wildberries с банковскими выписками. Вы сможете понять, все ли выплаты дошли, какие транзакции не найдены, какие требуют проверки, и оценить возможные потери. Как это работает: 1) загружаете отчёт WB в формате XLSX 2) загружаете банковскую выписку в формате XLSX или CSV 3) бот автоматически сверяет транзакции и формирует отчёт. Ваши данные защищены и обрабатываются только для целей сверки. Для продолжения необходимо согласие на обработку данных.`

Two inline buttons:

`[Принять]`  
`[Отказаться]`

If the user clicks `Отказаться`:  
Bot replies:

`Без согласия использование сервиса невозможно.`

Flow stops. Without consent the product cannot be used.

If the user clicks `Принять`:  
System stores consent in `consents`, creates the user record, activates **TRIAL** for 7 days, and opens the main menu. Trial starts automatically after consent.

Bot replies:

`Спасибо! Вам открыт бесплатный доступ на 7 дней (до ДД.ММ.ГГГГ). В течение этого времени вы можете выполнять сверки. Теперь загрузите отчёт Wildberries и выписку банка.`

Then the main menu is shown.

---

## Main Menu

Buttons:

`📊 Загрузить WB отчёт`  
`🏦 Загрузить выписку`  
`🔄 Запустить сверку`  
`📜 История`  
`💰 Подписка`  
`❓ Помощь`

Also available as text commands:

`/loss_calculator`  
`/delete_my_data`

All command descriptions shown in BotFather or help text must be in Russian. All bot text, prompts, menus, error messages, and report text must be in Russian.

---

## Flow 2 — Upload Wildberries report

User clicks `📊 Загрузить WB отчёт` or sends `/upload_wb`.

System checks access. Allowed statuses: **TRIAL** or **ACTIVE**. If access is expired, bot blocks the action and replies:

`Ваш доступ завершился. Оформите подписку: /subscribe`

Access must be checked before protected actions. Trial is 7 days. Paid access is 30 days. Expired users see a prompt to renew. Protected actions are `/upload_wb`, `/upload_bank`, `/run_sync`; `/history` and `/get_report` remain available to `EXPIRED` users in read-only mode.

Bot asks:

`Пришлите файл отчёта Wildberries в формате XLSX. Размер не более 20 МБ.`

User sends an XLSX file.

System validates:

- file size ≤ 20 MB;
- extension `.xlsx`;
- duplicate detection by file hash for the same user and source type (the import period is computed after parsing and is not part of the duplicate check);
- file storage in encrypted or encrypted-at-rest storage.

If the file is invalid, corrupted, unsupported, or too large, no import is created and the bot replies immediately:

`Ошибка: неверный формат или размер файла. Пришлите XLSX до 20 МБ.`

If valid:

- create an `import` record with status `RECEIVED`;
- start a background job;
- bot replies:

`Файл принят, начинаю обработку. Статус можно проверить командой /status <id>.`

Background job:

1. parses the WB file;
2. detects the header row;
3. normalizes dates and amounts;
4. stores canonical WB transactions;
5. writes malformed rows to `parsing_errors`;
6. updates `parse_success_rate` and `error_count`. Malformed rows must not stop the import.

After completion:

- if parsing is structurally successful, the import becomes `COMPLETED`;
- if the file is structurally unreadable, the import becomes `FAILED`;
- row-level errors do **not** automatically fail the import;
- if quality is low, the system may mark the import `LOW_CONFIDENCE` only where applicable to profile confidence, not merely because some rows failed.

Bot sends:

`✅ Отчёт WB обработан. Загружено строк: X, ошибок: Y. Теперь можно загрузить выписку банка.`

---

## Flow 3 — Upload bank statement

User clicks `🏦 Загрузить выписку` or sends `/upload_bank`.

System checks access as above.

Bot asks:

`Пришлите выписку в формате CSV или XLSX. Размер не более 20 МБ. Мы автоматически определим структуру вашего банка.`

User sends CSV or XLSX.

System validates:

- size ≤ 20 MB;
- allowed formats: CSV and XLSX;
- duplicate detection by hash;
- encrypted storage;
- create `import` record with status `RECEIVED`.

Bot replies:

`Файл принят, анализирую структуру...`

Background job for bank processing:

1. detect file format;
2. inspect rows and table regions;
3. generate header candidates;
4. score candidates;
5. try to match an existing active `statement_profile`;
6. if no profile matches, create a `Draft Profile` automatically and continue in draft mode;
7. canonicalize all rows into `canonical_transactions`;
8. store parsing evidence and limited debug fragments only; do not log full raw rows.

Normalization rules for bank rows:

- dates support common formats including `DD.MM.YYYY`, `DD.MM.YYYY HH:mm:ss`, `YYYY-MM-DD`, `YYYY/MM/DD`;
- amounts support comma and dot decimal separators;
- negative values may appear with minus, trailing minus, or parentheses;
- currency symbols and markers are stripped;
- text fields are lowercased and trimmed.

If an existing profile is found with sufficient confidence:

- set `profile_status = MATCHED`;
- parse using that profile;
- update statistics.

Bot replies:

`✅ Выписка обработана. Использован профиль банка: «[profile name]». Распознано строк: X, ошибок: Y.`

(`[profile name]` is taken from `statement_profiles.display_name`.)

If no profile is found:

- create a draft profile;
- set `profile_status = DRAFT`;
- continue parsing automatically;
- if profile confidence is below threshold, mark the import `LOW_CONFIDENCE`.

Bot replies:

`⚠️ Выписка обработана, но структура банка новая. Создан черновик профиля. Точность распознавания может быть ниже. Рекомендуем проверить отчёт.`

If `parse_success_rate < 70%` (configurable via settings), the import still becomes `COMPLETED` but receives `quality_status = MANUAL_REVIEW`, enters the admin review queue, and the bot replies:

`⚠️ Файл обработан, но значительная часть строк не распознана (ошибок: Y). Результаты сверки могут быть неполными. Мы проверим формат вашей выписки.`

If the file is structurally unreadable, the import becomes `FAILED` and the bot replies:

`❌ Не удалось распознать выписку. Попробуйте другой файл или другой формат.`

Important: do not fail the import just because some rows are malformed. Only fail fast when the file cannot be structurally interpreted.

After successful parsing (status `COMPLETED`), bot replies:

`Готово. Теперь можно запустить сверку.`

---

## Flow 4 — Run reconciliation

User clicks `🔄 Запустить сверку` or sends `/run_sync`.

System checks:

- the user has at least one WB import with status `COMPLETED`;
- the user has at least one bank import with status `COMPLETED`;
- both imports have overlapping periods (configurable date window);
- the bank import may be from the same month with a small date buffer.

If the prerequisites are not met, bot replies:

`Сначала загрузите оба файла — отчёт WB и выписку банка.`

If both are present but periods do not overlap:

`Периоды отчёта WB и выписки банка не совпадают. Загрузите файлы за один месяц.`

If both are present and compatible:

- create `reconciliation_run` with status `PENDING`;
- launch a background job;
- bot replies:

`Сверка запущена (ID: ...). Обычно занимает до минуты. Статус: /sync_status <run_id>.`

Background job:

1. generate candidates using hard filters:
   - direction must match;
   - currency must match;
   - amount must match exactly in the MVP;
   - date window default ±7 days and configurable via settings.
2. calculate scores:
   - amount score;
   - date score;
   - reference score;
   - description score;
   - counterparty score;
   - penalties for fees, refunds, reversals, suspicious purpose, internal transfers.
3. perform global matching on a graph of candidate pairs;
4. prevent double-use of WB or bank rows;
5. support split and combined matches only up to 3 rows per cluster;
6. mark ambiguous cases as `AMBIGUOUS`;
7. store evidence and reason codes for accepted and rejected candidates.

Important: reconciliation is not performed file-to-file; it is performed between two normalized sets of canonical transactions. The result statuses are: `MATCHED`, `UNMATCHED`, `AMBIGUOUS`, `SPLIT_MATCHED`, `COMBINED_MATCHED`. (`LOW_CONFIDENCE` is an import-level flag, not a match status.)

After completion:

- update run metrics;
- generate report;
- compute potential loss estimate;
- send user a final message.

Bot sends:

`✅ Сверка завершена. Совпадений: X. Не найдено: Y. Неоднозначно: Z. Оценка возможных потерь: <сумма> ₽. Скачать отчёт: [Скачать отчёт]`

If the bank import had `LOW_CONFIDENCE`, add a warning:

`⚠️ Выписка была распознана с низкой уверенностью. Результаты сверки могут быть неточны.`

If the run contains no suitable candidates, the run still completes and returns `UNMATCHED` results rather than failing the whole flow.

---

## Flow 5 — View and download report

User clicks `[Скачать отчёт]` or sends `/get_report <run_id>`.

System generates the report if it has not already been stored.

Primary format:

- Google Sheets-style online report where supported.

Fallback:

- ZIP archive with CSV files. The ZIP must contain:
  - `summary.csv`
  - `matched.csv`
  - `unmatched.csv`
  - `ambiguous.csv`
  - `wb_rows.csv`
  - `bank_rows.csv`
  - `evidence.csv`
  - `parsing_errors.csv`
  - `metrics.csv`

`SPLIT_MATCHED` and `COMBINED_MATCHED` results are included in `matched.csv` with an explicit match type column.

Bot replies:

`Ваш отчёт готов: [ссылка на ZIP-архив]. Он содержит сводку, совпадения, расхождения и детали оценки.`

If the report already exists, resend the link.

All report content, headers, labels, and summaries shown to the user must be in Russian.

---

## Flow 6 — History

User clicks `📜 История` or sends `/history`.

System fetches the last 10 reconciliation runs for the user.

Bot replies:

`📜 Последние сверки:`

Example entries:

1. `WB 01.03.2025, выписка Сбер — совпадений 95%, потери 1 230 ₽ [Скачать отчёт]`
2. `...`

Each entry includes a button or link for report download. The bank/profile name shown in entries comes from `statement_profiles.display_name`.

This flow must show the user’s most recent reconciliations.

---

## Flow 7 — Loss calculator

User sends `/loss_calculator`.

Bot asks:

`Какой ваш среднемесячный оборот на Wildberries (₽)? Например: 500 000`

User replies with a number.

System calculates:

- monthly loss = turnover × 4%;
- yearly loss = monthly loss × 12.

Bot replies:

`📉 Оценка возможных недоплат: ~<сумма> ₽ в месяц, ~<сумма> ₽ в год. Это статистическая оценка на основе 4% от оборота. Точная сумма будет после сверки.`

The calculator is optional and not required for continued use of the product.

---

## Flow 8 — Subscription management

User clicks `💰 Подписка` or sends `/subscribe`.

System shows current subscription state and expiry.

If the user is in TRIAL:

`Ваш статус: Пробный период (активен до ДД.ММ.ГГГГ). Подписка на 30 дней стоит 1 500 ₽. Оплатить: [Ссылка на оплату]`

If the user is ACTIVE:

`Ваш статус: Активна (до ДД.ММ.ГГГГ). Продлить подписку: [Ссылка на оплату]`

If the user is EXPIRED:

`Ваш доступ закончился. Чтобы продолжить, оформите подписку: [Ссылка на оплату]`

Payment flow:

- after successful payment, set status to `ACTIVE`;
- set `subscription_end_date = now + 30 days`;
- payment webhook must be validated;
- access state is checked before protected actions.

Bot sends:

`Оплата прошла успешно! Ваша подписка активна до ДД.ММ.ГГГГ. Спасибо!`

Reminder flow:

- 3 days before expiry for TRIAL or ACTIVE:

`Ваша подписка закончится через 3 дня. Продлите, чтобы не потерять доступ: /subscribe`

- if no reconciliation has been completed for 30 days while ACTIVE:

`Давно не сверяли выплаты? Загрузите свежие отчёты и проверьте, все ли средства поступили.`

---

## Flow 9 — Delete my data

User sends `/delete_my_data`.

Bot asks for confirmation with inline buttons:

`[Да, удалить]`  
`[Отмена]`

Message:

`Вы действительно хотите удалить все свои данные — файлы, импорты и сверки? Это действие необратимо.`

If the user clicks `Да, удалить` (canonical sequence, aligned with DB Draft v2.4):

- delete user files and report artifacts from storage (directly or via a `file_cleanup` job);
- hard-delete canonical transactions of the user's imports;
- hard-delete reconciliation runs (cascade removes candidates, matches, match items, evidence, and report records);
- soft-delete imports (set `deleted_at`);
- anonymize the user record (clear PII, set `deleted_at`);
- keep audit events with `user_id = NULL`;
- log the deletion event.

Bot replies:

`Все ваши данные удалены. Если захотите пользоваться сервисом снова, отправьте /start.`

If the user clicks `Отмена`, return to the main menu.

---

## Flow 10 — Admin commands

Available only to `TELEGRAM_ADMIN_IDS`.

Commands:

- `/view_profiles`
- `/activate_profile <profile_id>`
- `/deprecate_profile <profile_id>`
- `/view_errors`
- `/stats`
- `/retry_export <run_id>`

Behavior:

- view profiles without exposing raw sensitive rows;
- view recent parsing errors with limited debug fragments only (truncated, last 30 days);
- activate or deprecate profiles;
- retry report generation for failed runs;
- show metrics: registrations, consents, uploads, reconciliation runs, parse success/error rates, profile reuse/creation, low confidence, match rate, unmatched rate, ambiguous rate, split/combined rates, trial-to-paid conversion, repeat reconciliation.

Admin replies must be in Russian.

---

## Edge cases and error handling

- If the user tries to run reconciliation without both files having status `COMPLETED`:
  `Сначала загрузите оба файла — отчёт WB и выписку банка, и дождитесь завершения обработки.`

- If no eligible imports exist for auto-selection (no `COMPLETED` imports with overlapping periods):
  `Не найдено подходящих завершённых импортов для сверки. Загрузите отчёт WB и выписку банка.`

- If a file is larger than 20 MB:
  `Файл слишком большой. Максимум 20 МБ.`

- If the file format is unsupported:
  `Неподдерживаемый формат. Загрузите XLSX или CSV.`

- If some rows are malformed: continue import, store row-level errors, do not fail the whole file.

- If the bank import has low confidence: show a warning during reconciliation:
  `Выписка обработана с низкой уверенностью. Результаты сверки могут быть неточны.`

- If the import has `quality_status = MANUAL_REVIEW` (less than 70% of rows parsed): the import is `COMPLETED`, the user receives a strong warning, and the import appears in the admin review queue.

- If no candidates are found because amount, currency, or period do not match: still complete the run and return `UNMATCHED` results. Do not fail the entire reconciliation.

- If the report export fails: retry a small number of times, then fall back to ZIP with CSV.

---

## State transitions and asynchronous behavior

All long-running operations run as background jobs with persisted status and polling:

- file parsing;
- profile resolution;
- reconciliation;
- report generation.

Users can check progress with:

- `/status <import_id>` for imports;
- `/sync_status <run_id>` for reconciliation runs.

If the platform uses a single `/status <task_id>` command, it may map internally to both import and run statuses, but user-facing behavior must remain clear and consistent.

Bot should notify the user when a background job finishes.

---

## Localization note

Even though this document is in English, all strings shown to the user must be in Russian:

- onboarding;
- consent;
- menus;
- errors;
- report summaries;
- admin messages;
- subscription messages.

Use:

- `DD.MM.YYYY` for dates;
- spaces as thousand separators;
- comma as decimal separator where applicable.

**End of User Flow v2.3**
```