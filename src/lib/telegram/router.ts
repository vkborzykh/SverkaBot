  // ── Telegram Payments ──────────────────────────────────────────────────────

  if ('pre_checkout_query' in update && update.pre_checkout_query) {
    const pq = update.pre_checkout_query;
    // Всегда разрешаем оплату (можно добавить проверки при необходимости)
    await ctx.answerPreCheckoutQuery({
      pre_checkout_query_id: pq.id,
      ok: true,
    });
    return;
  }

  if ('message' in update && update.message && 'successful_payment' in update.message) {
    const sp = update.message.successful_payment;
    const telegramId = BigInt(update.message.chat.id);

    try {
      // Активируем подписку
      const user = await findUserByTelegramId(telegramId);
      if (user) {
        const { activateSubscription } = await import('@/src/lib/billing/subscription');
        const endDate = await activateSubscription(user.id, 30);
        const formatted = endDate.toLocaleDateString('ru-RU', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          timeZone: 'UTC',
        });

        // Записываем транзакцию
        const { createBillingTransaction } = await import('@/src/db/repositories/billing-transactions');
        await createBillingTransaction({
          user_id: user.id,
          amount_kopeks: BigInt(sp.total_amount),
          currency: sp.currency,
          status: 'SUCCESS',
          provider: 'telegram',
          provider_tx_id: sp.telegram_payment_charge_id,
          confirmation_url: null,
        });

        await ctx.reply(
          `Оплата прошла успешно! Ваша подписка активна до ${formatted}. Спасибо!`,
        );
      }
    } catch (err) {
      console.error('[successful_payment] error:', err);
      await ctx.reply('Произошла ошибка при активации подписки. Пожалуйста, обратитесь в поддержку.');
    }
    return;
  }
