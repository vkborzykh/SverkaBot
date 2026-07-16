// Единая точка правды о тарифах. Главное правило:
// НИКОГДА не сравнивайте user.tariff === 'PRO' напрямую в обработчиках —
// используйте hasProFeatures(), иначе BUSINESS не получит функции Профи.

export type Tariff = 'START' | 'PRO' | 'BUSINESS';

export const TARIFF_PRICES_KOPEKS: Record<Tariff, number> = {
  START: 99_000, // 990 ₽
  PRO: 199_000, // 1 990 ₽
  BUSINESS: 499_000, // 4 990 ₽
};

export const EXPORT_ADDON_PRICE_KOPEKS = 59_000; // 590 ₽/мес

// Обратная карта для валидации successful_payment (будет использована в router.ts)
export const TARIFF_BY_AMOUNT_KOPEKS: Record<number, Tariff> = {
  99_000: 'START',
  199_000: 'PRO',
  499_000: 'BUSINESS',
};

// Вспомогательная функция — true, если пробный период активен (не истёк)
function isTrialActive(status: string | null | undefined, trialExpiresAt: Date | null | undefined): boolean {
  if (status !== 'TRIAL' || !trialExpiresAt) return false;
  return new Date(trialExpiresAt) > new Date();
}

/** Функции уровня «Профи»: безлимит сверок, «Статистика», мультикабинет (до 2), приоритет.
 *  BUSINESS включает всё из PRO, поэтому проверка истинна для обоих.
 *  Во время активного пробного периода TRIAL также даёт полный доступ. */
export function hasProFeatures(
  tariff: string | null | undefined,
  subscriptionStatus?: string | null,
  trialExpiresAt?: Date | null,
): boolean {
  if (isTrialActive(subscriptionStatus, trialExpiresAt)) return true;
  return tariff === 'PRO' || tariff === 'BUSINESS';
}

/** Функции уровня «Бизнес»: до 5 кабинетов, экспорт, хранение 365 дней.
 *  Во время активного пробного периода TRIAL также даёт полный доступ. */
export function hasBusinessFeatures(
  tariff: string | null | undefined,
  subscriptionStatus?: string | null,
  trialExpiresAt?: Date | null,
): boolean {
  if (isTrialActive(subscriptionStatus, trialExpiresAt)) return true;
  return tariff === 'BUSINESS';
}

/** Доступ к экспорту: BUSINESS или (PRO / START) с оплаченным аддоном.
 *  Во время активного TRIAL экспорт также доступен. */
export function hasExportAccess(
  user: { tariff?: string | null; export_addon_active?: boolean | null; subscription_status?: string | null; trial_expires_at?: Date | null } | null | undefined,
): boolean {
  if (!user) return false;
  if (isTrialActive(user.subscription_status, user.trial_expires_at)) return true;
  if (user.tariff === 'BUSINESS') return true;
  return (user.tariff === 'PRO' || user.tariff === 'START') && user.export_addon_active === true;
}

/** Месячный лимит сверок. null = безлимит. */
export function monthlyLimitFor(
  tariff: string | null | undefined,
  subscriptionStatus?: string | null,
  trialExpiresAt?: Date | null,
): number | null {
  if (isTrialActive(subscriptionStatus, trialExpiresAt)) return 3; // пробный период — 3 сверки
  if (hasProFeatures(tariff)) return null; // PRO и BUSINESS — безлимит
  return 8; // START и любой неизвестный/пустой тариф активной подписки — 8 сверок
}

/** Срок хранения отчётов в днях, по тарифу. */
export function reportRetentionDaysFor(
  tariff: string | null | undefined,
  subscriptionStatus?: string | null,
  trialExpiresAt?: Date | null,
): number {
  if (isTrialActive(subscriptionStatus, trialExpiresAt)) return 365;
  if (hasBusinessFeatures(tariff)) return 365;
  if (hasProFeatures(tariff)) return 180;
  return 90;
}

/** Лимит кабинетов WB. Для неопределённого тарифа возвращаем 1.
 *  Во время активного TRIAL лимит — 5 кабинетов. */
export function cabinetLimitFor(
  tariff: string | null | undefined,
  subscriptionStatus?: string | null,
  trialExpiresAt?: Date | null,
): number {
  if (isTrialActive(subscriptionStatus, trialExpiresAt)) return 5;
  if (hasBusinessFeatures(tariff)) return 5;
  if (hasProFeatures(tariff)) return 2;
  return 1; // START и всё остальное — 1 кабинет
}
