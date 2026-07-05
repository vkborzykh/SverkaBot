// Единая точка правды о тарифах. Главное правило:
// НИКОГДА не сравнивайте user.tariff === 'PRO' напрямую в обработчиках —
// используйте hasProFeatures(), иначе BUSINESS не получит функции Профи.

export type Tariff = 'START' | 'PRO' | 'BUSINESS';

export const TARIFF_PRICES_KOPEKS: Record<Tariff, number> = {
  START: 99_000, // 990 ₽
  PRO: 199_000, // 1 990 ₽
  BUSINESS: 499_000, // 4 990 ₽
};

// Обратная карта для валидации successful_payment (будет использована в router.ts)
export const TARIFF_BY_AMOUNT_KOPEKS: Record<number, Tariff> = {
  99_000: 'START',
  199_000: 'PRO',
  499_000: 'BUSINESS',
};

/** Функции уровня «Профи»: безлимит сверок, Google Sheets, «Динамика», приоритет.
 *  BUSINESS включает всё из PRO, поэтому проверка истинна для обоих. */
export function hasProFeatures(tariff: string | null | undefined): boolean {
  return tariff === 'PRO' || tariff === 'BUSINESS';
}

/** Функции уровня «Бизнес»: до 5 кабинетов, CSV-выгрузка, хранение 365 дней. */
export function hasBusinessFeatures(tariff: string | null | undefined): boolean {
  return tariff === 'BUSINESS';
}

/** Месячный лимит сверок. null = безлимит. */
export function monthlyLimitFor(tariff: string | null | undefined): number | null {
  if (hasProFeatures(tariff)) return null; // PRO и BUSINESS — безлимит
  // START и любой неизвестный/пустой тариф активной подписки — консервативный лимит
  return 4;
}

/** Срок хранения отчётов в днях, по тарифу. */
export function reportRetentionDaysFor(tariff: string | null | undefined): number {
  if (hasBusinessFeatures(tariff)) return 365;
  if (hasProFeatures(tariff)) return 180;
  return 90;
}

export function cabinetLimitFor(tariff: string | null | undefined): number {
  return hasBusinessFeatures(tariff) ? 5 : 1;
}
