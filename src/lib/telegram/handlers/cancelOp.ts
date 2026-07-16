import type { Context } from 'telegraf';
import { findUserByTelegramId } from '@/src/db/repositories/users';
import { findImportById, updateImport } from '@/src/db/repositories/imports';
import { findRunById, updateRun } from '@/src/db/repositories/reconciliation-runs';
import { logAuditEvent } from '@/src/lib/audit/audit';
import { msg } from '../messages.ru';

export async function handleCancel(ctx: Context): Promise<void> {
  const from = ctx.from;
  if (!from) return;
  const text = (ctx.message && 'text' in ctx.message ? ctx.message.text : '') ?? '';
  const id = text.trim().split(/\s+/)[1];
  if (!id) { await ctx.reply(msg.cancelMissingId); return; }

  const user = await findUserByTelegramId(BigInt(from.id));
  if (!user) { await ctx.reply(msg.accessExpired); return; }

  const imp = await findImportById(id);
  if (imp && imp.user_id === user.id) {
    if (imp.status === 'RECEIVED' || imp.status === 'PARSING') {
      await updateImport(id, { status: 'CANCELLED' });
      await logAuditEvent(user.id, 'import_cancelled', { import_id: id });
      await ctx.reply(msg.cancelImportDone);
    } else {
      await ctx.reply(msg.cancelNotAllowed);
    }
    return;
  }

  const run = await findRunById(id);
  if (run && run.user_id === user.id) {
    if (run.status === 'PENDING' || run.status === 'RUNNING') {
      await updateRun(id, { status: 'CANCELLED', completed_at: new Date() });
      await logAuditEvent(user.id, 'run_cancelled', { run_id: id });
      await ctx.reply(msg.cancelRunDone);
    } else {
      await ctx.reply(msg.cancelNotAllowed);
    }
    return;
  }

  await ctx.reply(msg.cancelNotFound);
}
