// Self-contained HTML one-pager for a reconciliation run: expected vs received,
// potential loss, and the claim table. Pure string output (inline CSS + SVG, no
// external resources) so it works in the ZIP, in a browser, or behind a link —
// without any server-side rendering pipeline.

export interface ClaimRow {
  dateStr: string;
  amountKopeks: bigint;
  reference: string | null;
  description: string | null;
}

export interface HtmlReportData {
  runId: string;
  dateStr: string;
  status: 'reconciled' | 'underpaid' | 'missing' | 'overpaid';
  expectedKopeks: bigint;
  receivedKopeks: bigint;
  lossKopeks: bigint;
  matchRate: number;
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

export function buildHtmlReport(data: HtmlReportData): string {
  const meta = STATUS_META[data.status];
  const exp = Number(data.expectedKopeks);
  const rec = Number(data.receivedKopeks);
  const scale = Math.max(exp, rec, 1);
  const expW = Math.round((exp / scale) * 100);
  const recW = Math.round((rec / scale) * 100);
  const lossW = Math.max(0, expW - recW);

  const hasLoss = data.lossKopeks > BigInt(0);
  const showClaimTable = hasLoss && data.claimRows.length > 0;

  let claimSection: string;
  if (showClaimTable) {
    claimSection = `
    <h2>Данные для претензии</h2>
    <p class="muted">Выплаты Wildberries из отчёта за период — приложите к обращению на маркетплейс.</p>
    <table>
      <thead><tr><th>№</th><th>Дата</th><th>Сумма</th><th>Документ / SRID</th><th>Назначение</th></tr></thead>
      <tbody>
        ${data.claimRows
          .map(
            (r, i) =>
              `<tr><td>${i + 1}</td><td>${esc(r.dateStr)}</td><td class="num">${rub(
                r.amountKopeks,
              )}</td><td>${esc(r.reference ?? '—')}</td><td>${esc(r.description ?? '—')}</td></tr>`,
          )
          .join('\n        ')}
      </tbody>
    </table>`;
  } else {
    claimSection = `<p class="muted">Все выплаты подтверждены. Данные для претензии отсутствуют.</p>`;
  }

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
  table { width:100%; border-collapse:collapse; font-size:14px; }
  th,td { text-align:left; padding:8px 10px; border-bottom:1px solid #eeeef1; vertical-align:top; }
  th { color:#6b6b72; font-weight:600; font-size:12px; text-transform:uppercase; letter-spacing:0.03em; }
  td.num,.amt { font-variant-numeric:tabular-nums; }
  .foot { color:#9a9aa2; font-size:12px; margin-top:24px; }
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
      <div class="fig loss"><div class="k">Возможные потери</div><div class="v">${rub(
        data.lossKopeks > BigInt(0) ? data.lossKopeks : BigInt(0),
      )}</div></div>
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

    ${claimSection}

    <div class="foot">Сформировано автоматически SverkaBot. Оценка носит информационный характер; перед обращением на маркетплейс сверьте данные.</div>
  </div></div>
</body>
</html>`;
}
