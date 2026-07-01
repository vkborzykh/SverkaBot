// ... (весь предыдущий код до блока уведомления остаётся без изменений)

  // ── Уведомление (без автозапуска) ──
  if (user?.telegram_id) {
    try {
      const sessionPayload = await import('@/src/lib/telegram/session').then(m => m.getSessionPayload(user.telegram_id!));
      const isReconciliationActive = sessionPayload && 'wb_import_id' in (sessionPayload ?? {});

      // Проверка периода, если уже есть готовая выписка
      if (isReconciliationActive && periodStart && periodEnd && sessionPayload?.bank_import_id) {
        const bankImp = await findImportById(sessionPayload.bank_import_id as string);
        if (bankImp && bankImp.period_start && bankImp.period_end) {
          const { periodsCover } = await import('@/src/lib/reconciliation/startRun');
          if (!periodsCover(periodStart, periodEnd, bankImp.period_start, bankImp.period_end, 31)) {
            await sendWithKeyboard(user.telegram_id, '⚠️ Период банковской выписки не покрывает период отчёта WB. Проверьте файлы.', replaceWbInlineKeyboard);
            return;
          }
        }
      }

      if (isReconciliationActive) {
        await sendWithKeyboard(user.telegram_id, msg.uploadWbCompleted, wbCompletedKeyboard);
      } else {
        await notifyUser(user.telegram_id, msg.uploadWbCompleted);
      }
    } catch (err) {
      console.error('[parseWb] Notification error:', err);
    }
  }

  console.timeEnd('[parseWb] total');
}
