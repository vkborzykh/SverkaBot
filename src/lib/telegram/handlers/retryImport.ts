import type { Context } from 'telegraf';
import { findUserByTelegramId } from '@/src/db/repositories/users';
import { findImportById, updateImport } from '@/src/db/repositories/imports';
import { enqueue } from '@/src/lib/jobs/queue';
import { logAuditEvent } from '@/src/lib/audit/audit';
import { msg } from '../messages.ru';

export async function handleRetryImport(ctx: Context): Promise<void> {
  const from = ctx.from;
  if (!from) return;
  const text = (ctx.message && 'text' in ctx.message ? ctx.message.text : '') ?? '';
  const importId = text.trim().split(/\s+/)[1];
  if (!importId) { await ctx.reply(msg.retryMissingId); return; }

  const user = await findUserByTelegramId(BigInt(from.id));
  if (!user) { await ctx.reply(msg.accessExpired); return; }

  const imp = await findImportById(importId);
  if (!imp || imp.user_id !== user.id) { await ctx.reply(msg.retryNotFound); return; }

  if (imp.status === 'COMPLETED') { await ctx.reply(msg.retryAlreadyDone); return; }
  if (imp.status !== 'FAILED' && imp.status !== 'CANCELLED') { await ctx.reply(msg.retryNotAllowed); return; }
  if (!imp.storage_path) { await ctx.reply(msg.retryNoFile); return; }

  await updateImport(importId, { status: 'RECEIVED', error_count: 0, failure_reason: null });
  const jobType = imp.source_type === 'WB' ? 'parse_wb' : 'parse_bank';
  await enqueue(jobType, importId, { import_id: importId });
  await logAuditEvent(user.id, 'import_retried', { import_id: importId });
  await ctx.reply(msg.retryQueued(importId));
}
