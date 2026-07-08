// Self-contained HTML one-pager for a reconciliation run: money-flow breakdown,
// WB vs bank detail, unidentified credits, and a claim section.
// Pure string output (inline CSS + SVG, no external resources, no JS).
// Collapsible tables (5 visible rows + fade + toggle) are handled by vanilla JS.

export interface ClaimRow {
  dateStr: string;
  amountKopeks: bigint;
  reference: string | null;
  description: string | null;
}

export interface ReportTxRow {
  dateStr: string;
  amountKopeks: bigint;
  direction: 'IN' | 'OUT';
  description: string | null;
  reference: string | null;
  counterparty: string | null;
}

export interface HtmlReportData {
  runId: string;
  dateStr: string;
  cabinetName?: string | null;  
  status: 'reconciled' | 'underpaid' | 'missing' | 'overpaid';
  grossPayoutKopeks: bigint;
  commissionsKopeks: bigint;
  expectedKopeks: bigint;
  receivedKopeks: bigint;
  lossKopeks: bigint;
  lossPercent: number | null;
  matchRate: number;
  wbRows: ReportTxRow[];
  wbRowsTotal: number;
  bankRows: ReportTxRow[];
  bankRowsTotal: number;
  unidentifiedRows: ReportTxRow[];
  unidentifiedRowsTotal: number;
  unidentifiedTotalKopeks: bigint;
  claimAmountKopeks: bigint;
  claimPeriod: string;
  claimRows: ClaimRow[];
  exportCsvCommand?: string | null;
}

function rub(kopeks: bigint): string {
  const neg = kopeks < BigInt(0);
  const a = neg ? -kopeks : kopeks;
  const whole = (a / BigInt(100)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
  const cents = (a % BigInt(100)).toString().padStart(2, '0');
  return `${neg ? '−' : ''}${whole},${cents}\u00A0₽`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const STATUS_META: Record<HtmlReportData['status'], { label: string; accent: string; note: string }> = {
  reconciled: { label: 'Расхождений не найдено', accent: '#1a7f5a', note: 'Сумма поступлений совпала с ожидаемой выплатой.' },
  overpaid: { label: 'Поступило больше ожидаемого', accent: '#1a7f5a', note: 'На счёт пришло больше, чем ожидалось по отчёту WB.' },
  underpaid: { label: 'Обнаружена недоплата', accent: '#e67e22', note: 'Поступило меньше ожидаемого. Проверьте расхождение.' },
  missing: { label: 'Выплата не найдена', accent: '#b3261e', note: 'Поступлений от Wildberries за период не обнаружено.' },
};

// ── Table helper (plain table without wrapper) ──
function buildTable(
  rows: ReportTxRow[],
  total: number,
  kind: 'wb' | 'bank' | 'unidentified' | 'claim',
): string {
  if (rows.length === 0) return `<p class="muted">Нет строк.</p>`;

  if (kind === 'wb') {
    const head = `<tr><th>Дата</th><th>Тип</th><th>Назначение</th><th class="num">Сумма</th></tr>`;
    const body = rows.map((r) => {
      const out = r.direction === 'OUT';
      return `<tr${out ? ' class="out"' : ''}><td>${esc(r.dateStr)}</td><td>${out ? 'Удержание' : 'Выплата'}</td><td>${esc(r.description ?? r.reference ?? '–')}</td><td class="num">${rub(r.amountKopeks)}</td></tr>`;
    }).join('\n');
    const more = total > rows.length ? `<p class="muted">Показаны первые ${rows.length} из ${total} строк.</p>` : '';
    return `<table><thead>${head}</thead><tbody>\n${body}\n</tbody></table>${more}`;
  }

  if (kind === 'bank') {
    const head = `<tr><th>Дата</th><th>Описание</th><th class="num">Сумма</th></tr>`;
    const body = rows.map((r) => `<tr><td>${esc(r.dateStr)}</td><td>${esc(r.description ?? r.reference ?? '–')}</td><td class="num">${rub(r.amountKopeks)}</td></tr>`).join('\n');
    const more = total > rows.length ? `<p class="muted">Показаны первые ${rows.length} из ${total} строк.</p>` : '';
    return `<table><thead>${head}</thead><tbody>\n${body}\n</tbody></table>${more}`;
  }

  if (kind === 'unidentified') {
    const head = `<tr><th>Дата</th><th>Отправитель</th><th>Назначение</th><th class="num">Сумма</th></tr>`;
    const body = rows.map((r) => `<tr><td>${esc(r.dateStr)}</td><td>${esc(r.counterparty ?? '–')}</td><td>${esc(r.description ?? r.reference ?? '–')}</td><td class="num">${rub(r.amountKopeks)}</td></tr>`).join('\n');
    const more = total > rows.length ? `<tr><td colspan="4" class="muted">…и ещё ${total - rows.length} стр.</td></tr>` : '';
    return `<table><thead>${head}</thead><tbody>\n${body}\n${more ? `<tfoot>${more}</tfoot>` : ''}\n</tbody></table>`;
  }

  if (kind === 'claim') {
    const head = `<tr><th>№</th><th>Дата</th><th class="num">Сумма</th><th>Документ / SRID</th><th>Назначение</th></tr>`;
    const body = rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.dateStr)}</td><td class="num">${rub(r.amountKopeks)}</td><td>${esc(r.reference ?? '–')}</td><td>${esc(r.description ?? '–')}</td></tr>`).join('\n');
    return `<table><thead>${head}</thead><tbody>\n${body}\n</tbody></table>`;
  }
  return '';
}

function wrapCollapsible(tableHtml: string, totalRows: number): string {
  // Only add wrapper and button if there are rows
  if (totalRows <= 5) {
    return `<div class="tscroll">${tableHtml}</div>`;
  }
  return `
    <div class="report-container" data-total-rows="${totalRows}">
      <div class="table-wrap collapsed">
        <div class="tscroll">${tableHtml}</div>
        <div class="fade-overlay"></div>
      </div>
      <button class="show-more-btn" style="display:none;">Показать полностью</button>
    </div>`;
}

const WHAT_TO_DO_HTML = `
    <h2>Что делать дальше</h2>
    <ol class="steps">
      <li>Откройте финансовый отчёт за период: кабинет <b>WB Partners → Финансы → Отчёты</b> («Еженедельный отчёт» и «Детализация»). Сверьте сумму к перечислению с поступлением на расчётный счёт – зачисление обычно приходит с задержкой 2–3 дня.</li>
      <li>Проверьте крупные удержания в детализации: реклама, штрафы, логистика, платная приёмка и платная услуга ускоренного вывода (комиссия ~4,3%). Часто расхождение объясняется именно ими.</li>
      <li>Если удержания не покрывают разницу – создайте обращение в поддержку через тикет в личном кабинете <b>WB Partners</b> (seller.wildberries.ru).</li>
      <li>Приложите к обращению: банковскую выписку по расчётному счёту за период, детализацию финансового отчёта WB и скриншот раздела <b>Финансы → Выплаты</b>. Укажите период и точную сумму расхождения.</li>
      <li>Если на счёт приходили платежи от других контрагентов, не примите их за выплату WB – сверьте отправителя по банковской выписке.</li>
    </ol>
    <a class="btn" href="https://seller.wildberries.ru" target="_blank" rel="noopener">Открыть кабинет WB Partners</a>
    <p class="disclaimer">Названия разделов в кабинете WB со временем меняются – ориентируйтесь на актуальную структуру портала на момент обращения.</p>`;

export function buildHtmlReport(data: HtmlReportData): string {
  const meta = STATUS_META[data.status];
  const exp = Number(data.expectedKopeks);
  const rec = Number(data.receivedKopeks);
  const scale = Math.max(exp, rec, 1);
  const expW = Math.round((exp / scale) * 100);
  const recW = Math.round((rec / scale) * 100);
  const lossW = Math.max(0, expW - recW);

  const isOverpaid = data.status === 'overpaid';
  const overpaymentKopeks = isOverpaid ? data.receivedKopeks - data.expectedKopeks : BigInt(0);
  const hasLoss = !isOverpaid && data.lossKopeks > BigInt(0);

  const hero = `
    <div class="hero">
      <div class="k">${isOverpaid ? 'Переплата' : (hasLoss ? 'Неподтверждённые выплаты' : 'Итог сверки')}</div>
      <div class="v">${isOverpaid ? rub(overpaymentKopeks) : (hasLoss ? rub(data.lossKopeks) : 'Расхождений нет')}</div>
      <div class="sub">${
        isOverpaid
          ? `Поступило больше ожидаемого на ${rub(overpaymentKopeks)}.`
          : (hasLoss
            ? `${data.lossPercent != null ? data.lossPercent.toFixed(1) + '% от ожидаемого · ' : ''}ожидалось ${rub(data.expectedKopeks)}, поступило ${rub(data.receivedKopeks)}`
            : `поступило ${rub(data.receivedKopeks)} из ${rub(data.expectedKopeks)} ожидаемых`)
      }</div>
    </div>`;

  const breakdown = `
    <h2>Как получена сумма</h2>
    <table class="flow"><tbody>
      <tr><td>Выплаты за продажи (за вычетом комиссии WB)</td><td class="num">${rub(data.grossPayoutKopeks)}</td></tr>
      <tr><td>− Возвраты</td><td class="num">−${rub(data.commissionsKopeks)}</td></tr>
      <tr class="sum"><td>Ожидалось к перечислению</td><td class="num">${rub(data.expectedKopeks)}</td></tr>
      <tr><td>Поступило на счёт</td><td class="num">${rub(data.receivedKopeks)}</td></tr>
      <tr class="gap"><td>${
        isOverpaid
          ? 'Переплата (в вашу пользу)'
          : `Расхождение${data.lossPercent != null ? ` (${data.lossPercent.toFixed(1)}%)` : ''}`
      }</td><td class="num">${rub(isOverpaid ? overpaymentKopeks : data.lossKopeks)}</td></tr>
    </tbody></table>`;

  const wbTableHtml = buildTable(data.wbRows, data.wbRowsTotal, 'wb');
  const bankTableHtml = buildTable(data.bankRows, data.bankRowsTotal, 'bank');
  const unidentifiedTableHtml = data.unidentifiedRowsTotal > 0
    ? buildTable(data.unidentifiedRows, data.unidentifiedRowsTotal, 'unidentified')
    : '';

  const detail = `
    <h2>Отчёт Wildberries – ${data.wbRowsTotal} стр.</h2>
    <p class="muted">Что WB отразил как выплаты и удержания за период.</p>
    ${wrapCollapsible(wbTableHtml, data.wbRowsTotal)}
    <h2>Поступления от Wildberries – ${data.bankRowsTotal} стр.</h2>
    <p class="muted">Кредиты, отнесённые к выплатам Wildberries.</p>
    ${wrapCollapsible(bankTableHtml, data.bankRowsTotal)}`;

  const unidentified =
    data.unidentifiedRowsTotal > 0
      ? `
    <h2>Неидентифицированные поступления – ${data.unidentifiedRowsTotal} стр.</h2>
    <p class="muted">Кредиты на счёт, не отнесённые к выплатам Wildberries. Возможны возвраты, компенсации или платежи от других контрагентов – проверьте вручную.</p>
    ${wrapCollapsible(unidentifiedTableHtml, data.unidentifiedRowsTotal)}`
      : '';

  let claimSection: string;
  if (hasLoss) {
    const tmpl = `Прошу предоставить детализацию выплаты за период ${data.claimPeriod}. По данным сверки с банковской выпиской ожидаемая к перечислению сумма составила ${rub(
      data.expectedKopeks,
    )}, фактически поступило ${rub(data.receivedKopeks)}. Расхождение – ${rub(
      data.claimAmountKopeks,
    )}. Прошу разъяснить причину расхождения и произвести доплату либо предоставить обоснование удержания.`;
    const claimTableHtml = data.claimRows.length > 0
      ? buildTable(data.claimRows.map((r, i) => ({
          dateStr: r.dateStr,
          amountKopeks: r.amountKopeks,
          direction: 'IN' as const,
          description: r.description,
          reference: r.reference,
          counterparty: null,
        })), data.claimRows.length, 'claim')
      : '';
    const wrappedClaimTable = data.claimRows.length > 0
      ? wrapCollapsible(claimTableHtml, data.claimRows.length)
      : '';
    claimSection = `
    <h2>Данные для претензии</h2>
    <div class="claim-amt">Сумма к доплате: <b>${rub(data.claimAmountKopeks)}</b></div>
    <div class="tmpl"><div class="tmpl-h">Шаблон обращения – проверьте перед отправкой:</div><div class="tmpl-b">${esc(
      tmpl,
    )}</div></div>
    ${wrappedClaimTable}
    <p class="disclaimer">Это шаблон, а не юридически выверенная претензия. Проверьте формулировки и цифры перед отправкой на маркетплейс.</p>`;
  } else {
    claimSection = `<h2>Данные для претензии</h2><p class="muted">${
      isOverpaid ? 'Переплата – претензия не требуется.' : 'Все выплаты подтверждены. Данные для претензии отсутствуют.'
    }</p>`;
  }

  const whatToDo = hasLoss ? WHAT_TO_DO_HTML : '';

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Отчёт по сверке – SverkaBot</title>
<style>
  :root { --accent:${meta.accent}; }
  * { box-sizing: border-box; }
  body { margin:0; background:#f5f5f7; color:#1b1b1f; font:16px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif; }
  .wrap { max-width:760px; margin:0 auto; padding:32px 20px 56px; }
  .card { background:#fff; border:1px solid #e6e6ea; border-radius:16px; padding:28px; }
  .head { display:flex; justify-content:space-between; align-items:baseline; flex-wrap:wrap; gap:8px; }
  h1 { font-size:20px; margin:0; letter-spacing:-0.01em; }
  .run { color:#6b6b72; font-size:13px; font-variant-numeric:tabular-nums; }
  .banner { margin:20px 0 8px; padding:14px 16px; border-radius:12px; background:${meta.accent}14; border:1px solid ${meta.accent}33; }
  .banner b { color:${meta.accent}; }
  .banner .note { color:#6b6b72; font-size:14px; margin-top:2px; }
  .hero { margin:18px 0 10px; padding:18px 20px; border-radius:14px; border:1px solid ${meta.accent}55; background:${meta.accent}0F; }
  .hero .k { color:#6b6b72; font-size:13px; }
  .hero .v { font-size:34px; font-weight:700; letter-spacing:-0.02em; font-variant-numeric:tabular-nums; color:var(--accent); line-height:1.1; margin-top:2px; }
  .hero .sub { color:#5c5c63; font-size:13px; margin-top:5px; }
  .bars { margin:22px 0 6px; }
  .barrow { display:flex; align-items:center; gap:12px; margin:10px 0; }
  .barrow .lbl { width:96px; color:#6b6b72; font-size:13px; }
  .track { flex:1; background:#f0f0f3; border-radius:8px; height:22px; overflow:hidden; display:flex; }
  .seg-rec { background:${meta.accent}; height:100%; }
  .seg-loss { background-color:var(--accent); background-image:repeating-linear-gradient(45deg,rgba(255,255,255,.35) 0 6px,transparent 6px 12px); height:100%; }
  .seg-exp { background:#c9c9d0; height:100%; }
  .barrow .amt { width:130px; text-align:right; font-size:14px; font-variant-numeric:tabular-nums; }
  h2 { font-size:16px; margin:28px 0 6px; }
  .muted { color:#6b6b72; font-size:14px; margin:0 0 10px; }
  table { width:100%; border-collapse:collapse; font-size:14px; margin-bottom:6px; }
  th,td { text-align:left; padding:8px 10px; border-bottom:1px solid #eeeef1; vertical-align:top; }
  th { color:#6b6b72; font-weight:600; font-size:12px; text-transform:uppercase; letter-spacing:0.03em; }
  th.num,td.num { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
  tr.out td { color:#8a8a90; }
  table.flow td { border-bottom:1px solid #f0f0f3; }
  table.flow tr.sum td { font-weight:650; border-top:2px solid #d9d9df; }
  table.flow tr.gap td { font-weight:700; color:var(--accent); }
  tbody tr.sum td { font-weight:650; border-top:2px solid #d9d9df; }
  .claim-amt { font-size:18px; margin:6px 0 4px; }
  .claim-amt b { color:var(--accent); font-size:20px; font-variant-numeric:tabular-nums; }
  .tmpl { border:1px solid #e6e6ea; border-radius:12px; padding:14px 16px; background:#fafafb; margin:12px 0; }
  .tmpl-h { font-size:12px; text-transform:uppercase; letter-spacing:0.03em; color:#6b6b72; margin-bottom:6px; }
  .tmpl-b { font-size:14px; white-space:pre-wrap; }
  .btn { display:inline-block; margin:10px 0 2px; padding:10px 16px; border-radius:10px; background:var(--accent); color:#fff; font-size:14px; font-weight:600; text-decoration:none; }
  .disclaimer { color:#6f6f77; font-size:12px; margin-top:8px; }
  .foot { color:#6f6f77; font-size:12px; margin-top:24px; }
  .tscroll { overflow-x:auto; -webkit-overflow-scrolling:touch; margin-bottom:6px; }
  ol.steps { margin:6px 0 4px; padding-left:20px; font-size:14px; }
  ol.steps li { margin:7px 0; }

  /* Collapsible tables */
  .report-container { margin-bottom: 12px; }
  .table-wrap { position: relative; overflow: hidden; transition: max-height 0.5s ease-in-out; }
  .table-wrap.collapsed { max-height: 250px; }
  .table-wrap.expanded { max-height: 2000px; }
  .fade-overlay {
    position: absolute; bottom: 0; left: 0; right: 0; height: 80px;
    background: linear-gradient(to bottom, rgba(255,255,255,0), #ffffff);
    pointer-events: none;
    transition: opacity 0.5s ease-in-out;
  }
  .table-wrap.expanded .fade-overlay { opacity: 0; }
  .show-more-btn {
    display: block; margin: 8px 0 0; padding: 8px 16px;
    background: #fff; border: 1px solid #d0d0d5; border-radius: 8px;
    color: #1b1b1f; font-size: 13px; cursor: pointer;
    transition: border-color 0.2s;
    text-align: left; width: 100%;
  }
  .show-more-btn:hover { border-color: #90909a; }
  .show-more-btn::before { content: '↓ '; font-size: 12px; }
  .show-more-btn.expanded::before { content: '↑ '; }

  /* Zebra striping for tables */
  tbody tr:nth-child(even) { background-color: #fafafb; }
  tbody tr:hover { background-color: #f0f0f3; }

  @media (max-width: 600px) {
    .wrap { padding:16px 12px 40px; }
    .card { padding:18px 14px; border-radius:12px; }
    h1 { font-size:18px; }
    .hero .v { font-size:28px; }
    .barrow .lbl { width:68px; font-size:12px; }
    .barrow .amt { width:auto; min-width:88px; font-size:13px; }
    table { font-size:13px; }
    th,td { padding:6px 7px; }
    .tmpl-b { font-size:13px; }
  }
  @media print {
    * { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    body { background:#fff; }
    .wrap { max-width:none; padding:0; }
    .card { border:none; border-radius:0; padding:0; }
    .hero { border-color:#999; background:#f4f4f4 !important; }
    .track { border:1px solid #ccc; }
    .seg-rec { background:#555 !important; background-image:none !important; }
    .seg-exp { background:#ccc !important; }
    .seg-loss { background:#fff !important; background-image:repeating-linear-gradient(45deg,#666 0 4px,#fff 4px 8px) !important; }
    .tscroll { overflow:visible; }
    .table-wrap.collapsed { max-height: none; }
    .fade-overlay { display: none; }
    .show-more-btn { display: none; }
    tr { page-break-inside:avoid; }
    thead { display:table-header-group; }
    h2 { page-break-after:avoid; }
  }
</style>
</head>
<body>
  <div class="wrap"><div class="card">
    <div class="head">
      <h1>Отчёт по сверке выплат Wildberries</h1>
      <span class="run">Сверка ${esc(data.runId.slice(0, 8))} · ${esc(data.dateStr)}${data.cabinetName ? ` · 🗂 ${esc(data.cabinetName)}` : ''}</span>
    </div>

    <div class="banner"><b>${meta.label}</b><div class="note">${meta.note}</div></div>

    ${hero}

    <div class="bars">
      <div class="barrow"><span class="lbl">Ожидалось</span>
        <div class="track"><div class="seg-exp" style="width:${expW}%"></div></div>
        <span class="amt">${rub(data.expectedKopeks)}</span></div>
      <div class="barrow"><span class="lbl">Поступило</span>
        <div class="track"><div class="seg-rec" style="width:${recW}%"></div><div class="seg-loss" style="width:${lossW}%"></div></div>
        <span class="amt">${rub(data.receivedKopeks)}</span></div>
    </div>
    ${hasLoss ? `<p class="muted">Штриховкой отмечен недостающий объём.</p>` : ''}

    ${breakdown}

    ${detail}

    ${unidentified}

    ${csvBlock}

    ${claimSection}

    ${whatToDo}

    <div class="foot">Сформировано SverkaBot · ${esc(data.dateStr)}</div>
  </div></div>
  <script>
    (function() {
      // Collapsible tables: show only 5 rows, fade, toggle button
      document.addEventListener('DOMContentLoaded', function() {
        const containers = document.querySelectorAll('.report-container');
        containers.forEach(function(container) {
          const totalRows = parseInt(container.dataset.totalRows, 10);
          const tableWrap = container.querySelector('.table-wrap');
          const btn = container.querySelector('.show-more-btn');
          if (!tableWrap || !btn || totalRows <= 5) return;

          // Show button and set initial text
          const hiddenCount = totalRows - 5;
          btn.style.display = 'block';
          btn.textContent = 'Показать полностью (скрыто ' + hiddenCount + ' строк)';

          // Toggle on click
          btn.addEventListener('click', function() {
            const isExpanded = tableWrap.classList.contains('expanded');
            if (isExpanded) {
              tableWrap.classList.remove('expanded');
              tableWrap.classList.add('collapsed');
              btn.classList.remove('expanded');
              btn.textContent = 'Показать полностью (скрыто ' + hiddenCount + ' строк)';
            } else {
              tableWrap.classList.add('expanded');
              tableWrap.classList.remove('collapsed');
              btn.classList.add('expanded');
              btn.textContent = 'Свернуть обратно';
            }
          });

          // Ensure collapsed state initially
          tableWrap.classList.add('collapsed');
        });
      });
    })();
  </script>
</body>
</html>`;
}
