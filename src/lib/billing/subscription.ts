import { updateUser, findUserById } from '@/src/db/repositories/users';

export async function activateSubscription(
  userId: string,
  durationDays: number,
): Promise<Date> {
  const user = await findUserById(userId);
  if (!user) throw new Error(`User not found: ${userId}`);

  const now = new Date();
  let baseDate = now;

  // If user already has active subscription, extend from current end date
  if (
    user.subscription_status === 'ACTIVE' &&
    user.subscription_end_date &&
    user.subscription_end_date > now
  ) {
    baseDate = user.subscription_end_date;
  }

  const endDate = new Date(baseDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

  await updateUser(userId, {
    subscription_status: 'ACTIVE',
    subscription_end_date: endDate,
  });

  return endDate;
}

export async function expireSubscription(userId: string): Promise<void> {
  await updateUser(userId, {
    subscription_status: 'EXPIRED',
  });
}
