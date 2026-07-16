import { updateUser, findUserById } from '@/src/db/repositories/users';

export async function activateSubscription(
  userId: string,
  durationDays: number,
): Promise<Date> {
  const user = await findUserById(userId);
  if (!user) throw new Error(`User not found: ${userId}`);

  const now = new Date();
  // Если подписка уже активна и не истекла – продлеваем от её окончания.
  // Иначе начинаем новую с сегодняшнего дня.
  const baseDate =
    user.subscription_status === 'ACTIVE' &&
    user.subscription_end_date &&
    user.subscription_end_date > now
      ? user.subscription_end_date
      : now;

  const endDate = new Date(baseDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

  await updateUser(userId, {
    subscription_status: 'ACTIVE',
    subscription_end_date: endDate,
    trial_expires_at: null, // сбрасываем триал, если он был
  });

  return endDate;
}

export async function expireSubscription(userId: string): Promise<void> {
  await updateUser(userId, {
    subscription_status: 'EXPIRED',
  });
}
