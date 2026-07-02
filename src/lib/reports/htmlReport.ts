// Self-contained HTML one-pager for a reconciliation run: money-flow breakdown,
// WB vs bank detail, unidentified credits, and a claim section.
// Pure string output (inline CSS + SVG, no external resources, no JS).

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
  status: 'reconciled' | 'underpaid' | 'missing' | 'overpaid';
  // Financial summary (from wb_net_payout evidence)
  grossPayoutKopeks: bigint;
  commissionsKopeks: bigint;
  expectedKopeks: bigint;
  receivedKopeks: bigint;
  lossKopeks: bigint;
  lossPercent: number | null;
  matchRate: number;
  // Detail tables
  wbRows: ReportTxRow[];
  wbRowsTotal: number;
  bankRows: ReportTxRow[];
  bankRowsTotal: number;
  // Section 3 — unidentified bank credits
  unidentifiedRows: ReportTxRow[];
  unidentifiedRowsTotal: number;
  unidentifiedTotalKopeks: bigint;
  // Claim
  claimAmountKopeks: bigint;
  claimPeriod: string;
  claimRows: ClaimRow[];
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
  underpaid: { label: 'Возможная недоплата', accent: '#e67e22', note: 'Поступило меньше ожидаемого. Проверьте расхождение.' },
  missing: { label: 'Выплата не найдена', accent: '#b3261e', note: 'Поступлений от Wildberries за период не обнаружено.' },
};

function txTable(rows: ReportTxRow[], total: number, kind: 'wb' | 'bank'): string {
  if (rows.length === 0) return `<p class="muted">Нет строк.</p>`;
  const head =
    kind === 'wb'
      ? `<tr><th>Дата</th><th>Тип</th><th>Назначение</th><th class="num">Сумма</th></tr>`
      : `<tr><th>Дата</th><th>Описание</th><th class="num">Сумма</th></tr>`;
  const body = rows
    .map((r) => {
      if (kind === 'wb') {
        const out = r.direction === 'OUT';
        return `<tr${out ? ' class="out"' : ''}><td>${esc(r.dateStr)}</td><td>${out ? 'Удержание' : 'Выплата'}</td><td>${esc(
          r.description ?? r.reference ?? '—',
        )}</td><td class="num">${rub(r.amountKopeks)}</td></tr>`;
      }
      return `<tr><td>${esc(r.dateStr)}</td><td>${esc(r.description ?? r.reference ?? '—')}</td><td class="num">${rub(
        r.amountKopeks,
      )}</td></tr>`;
    })
    .join('\n        ');
  const more = total > rows.length ? `<p class="muted">Показаны первые ${rows.length} из ${total} строк.</p>` : '';
  return `<table><thead>${head}</thead><tbody>\n        ${body}\n      </tbody></table>${more}`;
}

function unidentifiedTable(rows: ReportTxRow[], total: number, sum: bigint): string {
  const body = rows
    .map(
      (r) =>
        `<tr><td>${esc(r.dateStr)}</td><td>${esc(r.counterparty ?? '—')}</td><td>${esc(
          r.description ?? r.reference ?? '—',
        )}</td><td class="num">${rub(r.amountKopeks)}</td></tr>`,
    )
    .join('\n        ');
  const more =
    total > rows.length ? `<tr><td colspan="4" class="muted">…и ещё ${total - rows.length} стр.</td></tr>` : '';
  return `<table><thead><tr><th>Дата</th><th>Отправитель</th><th>Назначение</th><th class="num">Сумма</th></tr></thead>
      <tbody>\n        ${body}\n        ${more}
        <tr class="sum"><td colspan="3">Итого не отнесено к WB</td><td class="num">${rub(sum)}</td></tr>
      </tbody></table>`;
}

const WHAT_TO_DO_HTML = `
    <h2>Что делать дальше</h2>
    <ol class="steps">
      <li>Откройте финансовый отчёт за период: кабинет <b>WB Partners → Финансы → Отчёты</b> («Еженедельный отчёт» и «Детализация»). Сверьте сумму к перечислению с поступлением на расчётный счёт — зачисление обычно приходит с задержкой 2–3 дня.</li>
      <li>Проверьте крупные удержания в детализации: реклама, штрафы, логистика, платная приёмка и платная услуга ускоренного вывода (комиссия ~4,3%). Часто расхождение объясняется именно ими.</li>
      <li>Если удержания не покрывают разницу — создайте обращение в поддержку через тикет в личном кабинете <b>WB Partners</b> (seller.wildberries.ru).</li>
      <li>Приложите к обращению: банковскую выписку по расчётному счёту за период, детализацию финансового отчёта WB и скриншот раздела <b>Финансы → Выплаты</b>. Укажите период и точную сумму расхождения.</li>
      <li>Проверьте раздел «Неидентифицированные поступления» выше: возможно, часть денег пришла от других контрагентов или как возврат и не относится к выплате WB.</li>
    </ol>
    <p class="disclaimer">Названия разделов в кабинете WB со временем меняются — ориентируйтесь на актуальную структуру портала на момент обращения.</p>`;

export function buildHtmlReport(data: HtmlReportData): string {
  const meta = STATUS_META[data.status];
  const exp = Number(data.expectedKopeks);
  const rec = Number(data.receivedKopeks);
  const scale = Math.max(exp, rec, 1);
  const expW = Math.round((exp / scale) * 100);
  const recW = Math.round((rec / scale) * 100);
  const lossW = Math.max(0, expW - recW);
  const hasLoss = data.lossKopeks > BigInt(0);

  const breakdown = `
    <h2>Как получена сумма</h2>
    <table class="flow"><tbody>
      <tr><td>Валовые выплаты Wildberries</td><td class="num">${rub(data.grossPayoutKopeks)}</td></tr>
      <tr><td>− Удержания и комиссии WB</td><td class="num">−${rub(data.commissionsKopeks)}</td></tr>
      <tr class="sum"><td>Ожидалось к перечислению</td><td class="num">${rub(data.expectedKopeks)}</td></tr>
      <tr><td>Поступило на счёт</td><td class="num">${rub(data.receivedKopeks)}</td></tr>
      <tr class="gap"><td>Расхождение${data.lossPercent != null ? ` (${data.lossPercent.toFixed(1)}%)` : ''}</td><td class="num">${rub(data.lossKopeks)}</td></tr>
    </tbody></table>`;

  const detail = `
    <h2>Отчёт Wildberries — ${data.wbRowsTotal} стр.</h2>
    <p class="muted">Что WB отразил как выплаты и удержания за период.</p>
    ${txTable(data.wbRows, data.wbRowsTotal, 'wb')}
    <h2>Поступления на счёт — ${data.bankRowsTotal} стр.</h2>
    <p class="muted">Кредитовые операции из банковской выписки.</p>
    ${txTable(data.bankRows, data.bankRowsTotal, 'bank')}`;

  const unidentified =
    data.unidentifiedRowsTotal > 0
      ? `
    <h2>Неидентифицированные поступления — ${data.unidentifiedRowsTotal} стр.</h2>
    <p class="muted">Кредиты на счёт, не отнесённые к выплатам Wildberries. Возможны возвраты, компенсации или платежи от других контрагентов — проверьте вручную.</p>
    ${unidentifiedTable(data.unidentifiedRows, data.unidentifiedRowsTotal, data.unidentifiedTotalKopeks)}`
      : '';

  let claimSection: string;
  if (hasLoss) {
    const tmpl = `Прошу предоставить детализацию выплаты за период ${data.claimPeriod}. По данным сверки с банковской выпиской ожидаемая к перечислению сумма составила ${rub(
      data.expectedKopeks,
    )}, фактически поступило ${rub(data.receivedKopeks)}. Расхождение — ${rub(
      data.claimAmountKopeks,
    )}. Прошу разъяснить причину расхождения и произвести доплату либо предоставить обоснование удержания.`;
    const claimTable =
      data.claimRows.length > 0
        ? `<p class="muted">Выплаты Wildberries за период (приложите вместе с банковской выпиской):</p>
    <table><thead><tr><th>№</th><th>Дата</th><th class="num">Сумма</th><th>Документ / SRID</th><th>Назначение</th></tr></thead>
      <tbody>${data.claimRows
        .map(
          (r, i) =>
            `<tr><td>${i + 1}</td><td>${esc(r.dateStr)}</td><td class="num">${rub(r.amountKopeks)}</td><td>${esc(
              r.reference ?? '—',
            )}</td><td>${esc(r.description ?? '—')}</td></tr>`,
        )
        .join('')}</tbody></table>`
        : '';
    claimSection = `
    <h2>Данные для претензии</h2>
    <div class="claim-amt">Сумма к доплате: <b>${rub(data.claimAmountKopeks)}</b></div>
    <p class="muted">За период ${esc(data.claimPeriod)} ожидалось ${rub(data.expectedKopeks)}, поступило ${rub(
      data.receivedKopeks,
    )}.</p>
    <div class="tmpl"><div class="tmpl-h">Шаблон обращения — проверьте перед отправкой:</div><div class="tmpl-b">${esc(
      tmpl,
    )}</div></div>
    ${claimTable}
    <p class="disclaimer">Это шаблон, а не юридически выверенная претензия. Проверьте формулировки и цифры перед отправкой на маркетплейс.</p>`;
  } else {
    claimSection = `<h2>Данные для претензии</h2><p class="muted">Все выплаты подтверждены. Данные для претензии отсутствуют.</p>`;
  }

  const whatToDo = hasLoss ? WHAT_TO_DO_HTML : '';

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Отчёт по сверке — SverkaBot</title>
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
  .figs { display:flex; gap:14px; flex-wrap:wrap; margin:22px 0 8px; }
  .fig { flex:1 1 30%; min-width:150px; border:1px solid #e6e6ea; border-radius:12px; padding:14px 16px; }
  .fig .k { color:#6b6b72; font-size:13px; }
  .fig .v { font-size:22px; font-weight:650; letter-spacing:-0.02em; font-variant-numeric:tabular-nums; margin-top:2px; }
  .fig .pct { color:#b3261e; font-size:12px; margin-top:2px; }
  .fig.loss .v { color:${hasLoss ? '#b3261e' : '#1a7f5a'}; }
  .bars { margin:22px 0 6px; }
  .barrow { display:flex; align-items:center; gap:12px; margin:10px 0; }
  .barrow .lbl { width:96px; color:#6b6b72; font-size:13px; }
  .track { flex:1; background:#f0f0f3; border-radius:8px; height:22px; overflow:hidden; display:flex; }
  .seg-rec { background:${meta.accent}; height:100%; }
  .seg-loss { background:repeating-linear-gradient(45deg,#b3261e,#b3261e 6px,#cf4b43 6px,#cf4b43 12px); height:100%; }
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
  table.flow tr.gap td { font-weight:700; color:${hasLoss ? '#b3261e' : '#1a7f5a'}; }
  tbody tr.sum td { font-weight:650; border-top:2px solid #d9d9df; }
  .claim-amt { font-size:18px; margin:6px 0 4px; }
  .claim-amt b { color:#b3261e; font-size:22px; font-variant-numeric:tabular-nums; }
  .tmpl { border:1px solid #e6e6ea; border-radius:12px; padding:14px 16px; background:#fafafb; margin:12px 0; }
  .tmpl-h { font-size:12px; text-transform:uppercase; letter-spacing:0.03em; color:#6b6b72; margin-bottom:6px; }
  .tmpl-b { font-size:14px; white-space:pre-wrap; }
  .disclaimer { color:#9a9aa2; font-size:12px; margin-top:8px; }
  .foot { color:#9a9aa2; font-size:12px; margin-top:24px; }
  ol.steps { margin:6px 0 4px; padding-left:20px; font-size:14px; }
  ol.steps li { margin:7px 0; }
  @media print {
    body { background:#fff; }
    .wrap { max-width:none; padding:0; }
    .card { border:none; border-radius:0; padding:0; }
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
      <span class="run">Сверка ${esc(data.runId.slice(0, 8))} · ${esc(data.dateStr)}</span>
    </div>

    <div class="banner"><b>${meta.label}</b><div class="note">${meta.note}</div></div>

    <div class="figs">
      <div class="fig"><div class="k">Ожидалось к выплате</div><div class="v">${rub(data.expectedKopeks)}</div></div>
      <div class="fig"><div class="k">Поступило</div><div class="v">${rub(data.receivedKopeks)}</div></div>
      <div class="fig loss"><div class="k">Неподтверждённые выплаты</div><div class="v">${rub(
        hasLoss ? data.lossKopeks : BigInt(0),
      )}</div>${data.lossPercent != null ? `<div class="pct">${data.lossPercent.toFixed(1)}% от ожидаемого</div>` : ''}</div>
    </div>

    <div class="bars">
      <div class="barrow"><span class="lbl">Ожидалось</span>
        <div class="track"><div class="seg-exp" style="width:${expW}%"></div></div>
        <span class="amt">${rub(data.expectedKopeks)}</span></div>
      <div class="barrow"><span class="lbl">Поступило</span>
        <div class="track"><div class="seg-rec" style="width:${recW}%"></div><div class="seg-loss" style="width:${lossW}%"></div></div>
        <span class="amt">${rub(data.receivedKopeks)}</span></div>
    </div>
    <p class="muted">Процент совпадения: ${data.matchRate.toFixed(1)}%. Красной штриховкой показан недостающий объём.</p>

    ${breakdown}

    ${detail}

    ${unidentified}

    ${claimSection}

    ${whatToDo}

    <div class="foot">Сформировано автоматически SverkaBot. Оценка носит информационный характер; перед обращением на маркетплейс сверьте данные.</div>
  </div></div>
</body>
</html>`;
}
