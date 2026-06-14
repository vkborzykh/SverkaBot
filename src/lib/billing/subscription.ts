// Billing / subscription stubs.
// Implements section 9 of Tech Plan v4.2.

export async function activateSubscription(
  _userId: string,
  _durationDays: number,
): Promise<void> {
  throw new Error('Not implemented');
}

export async function expireSubscription(_userId: string): Promise<void> {
  throw new Error('Not implemented');
}
