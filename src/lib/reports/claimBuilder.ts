import type { CanonicalTransaction } from '@/src/db/repositories/canonical-transactions';

function csvCell(v: string): string {
  if (/[",\n;]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function rub(kopeks: bigint | null | undefined): string {
  const k = kopeks ?? BigInt(0);
  const neg = k < BigInt(0);
  const a = neg ? -k : k;
  return `${neg ? '-' : ''}${a / BigInt(100)},${(a % BigInt(100)).toString().padStart(2, '0')}`;
}

function dmy(d: Date | string | null | undefined): string {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(dt.getDate())}.${p(dt.getMonth() + 1)}.${dt.getFullYear()}`;
}

// FR-11 "Claim data": dates, amounts and references of the payouts to claim.
export function buildClaimCSV(rows: CanonicalTransaction[]): string {
  const header = ['№', 'Дата', 'Сумма, ₽', 'Документ/SRID', 'Назначение'];
  const lines = [header.map(csvCell).join(';')];
  rows.forEach((r, i) => {
    lines.push(
      [
        String(i + 1),
        dmy(r.transaction_date),
        rub(r.amount_kopeks),
        r.reference ?? '',
        r.description ?? '',
      ]
        .map((c) => csvCell(String(c)))
        .join(';'),
    );
  });
  return lines.join('\n');
}
