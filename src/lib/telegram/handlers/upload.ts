import { validateFileSize, validateExtension, MAX_FILE_BYTES } from '@/src/lib/ingestion/validate';
import { sha256 } from '@/src/lib/ingestion/hash';
import { storeFile } from '@/src/lib/ingestion/storage';
import { findImportByHash, createImport } from '@/src/db/repositories/imports';
import { findUserByTelegramId } from '@/src/db/repositories/users';
import { enqueue } from '@/src/lib/jobs/queue';
import { checkAccess } from '@/src/lib/telegram/access';
import { msg } from '@/src/lib/telegram/messages.ru';
import { setSession, getSessionPayload } from '@/src/lib/telegram/session';
import { isAdmin } from '@/src/lib/telegram/handlers/admin';
import { validateFileContent } from '@/src/lib/ingestion/validateContent';
import type { BotContext } from '@/src/lib/telegram/router';

export interface DocumentInfo {
  fileId: string;
  fileName: string;
  fileSizeBytes: number;
}

async function downloadTelegramFile(fileId: string): Promise<Buffer> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set');

  const infoRes = await fetch(
    `https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`,
  );
  const infoJson = (await infoRes.json()) as { ok: boolean; result?: { file_path?: string } };
  if (!infoJson.ok || !infoJson.result?.file_path) {
    throw new Error('Failed to get file info from Telegram');
  }

  const fileRes = await fetch(
    `https://api.telegram.org/file/bot${token}/${infoJson.result.file_path}`,
  );
  const arrayBuf = await fileRes.arrayBuffer();
  return Buffer.from(arrayBuf);
}

async function handleFileUpload(
  ctx: BotContext,
  doc: DocumentInfo,
  sourceType: 'WB' | 'BANK',
  allowedExtensions: string[],
): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  const telegramId = BigInt(from.id);

  const user = await findUserByTelegramId(telegramId);
  if (!user) { await ctx.reply(msg.accessExpired); return; }
  if (checkAccess(user) !== 'full') { await ctx.reply(msg.accessExpired); return; }

  const sessionPayload = await getSessionPayload(telegramId) ?? {};

  const slotKey = sourceType === 'WB' ? 'wb_import_id' : 'bank_import_id';
  if (sessionPayload[slotKey]) {
    await ctx.reply(sourceType === 'WB' ? msg.wbAlreadyUploaded : msg.bankAlreadyUploaded);
    return;
  }

  if (!validateExtension(doc.fileName, allowedExtensions)) { await ctx.reply(msg.errInvalidFormat); return; }
  if (!validateFileSize(doc.fileSizeBytes)) { await ctx.reply(msg.errFileTooLarge); return; }

  let buffer: Buffer;
  try { buffer = await downloadTelegramFile(doc.fileId); } catch { await ctx.reply(msg.errInvalidFormat); return; }
  if (!validateFileSize(buffer.byteLength)) { await ctx.reply(msg.errFileTooLarge); return; }

  const ext = doc.fileName.toLowerCase().endsWith('.csv') ? 'csv' : 'xlsx';

  // Проверка содержимого (заголовки)
  const contentCheck = await validateFileContent(buffer, ext, sourceType);
  if (!contentCheck.valid) {
    await ctx.reply(contentCheck.reason!);
    return;
  }

  const fileHash = sha256(buffer);
  const existing = await findImportByHash(user.id, sourceType, fileHash);
  if (existing) { await ctx.reply(msg.uploadDuplicateImport(existing.id)); return; }

  try {
    const storagePath = await storeFile(user.id, fileHash, ext, buffer);
    const newImport = await createImport({
      user_id: user.id,
      source_type: sourceType,
      marketplace: sourceType === 'WB' ? 'WB' : null,
      storage_path: storagePath,
      original_filename: doc.fileName,
      file_hash: fileHash,
      file_size_bytes: BigInt(buffer.byteLength),
      status: 'RECEIVED',
    });

    const jobType = sourceType === 'WB' ? 'parse_wb' : 'parse_bank';
    await enqueue(jobType, newImport.id, { import_id: newImport.id });

    const updatedPayload = { ...sessionPayload, [slotKey]: newImport.id };
    await setSession(telegramId, 'reconciliation_active', updatedPayload);

    if (sourceType === 'WB') {
      await ctx.reply(msg.uploadWbReceived);
    } else {
      await ctx.reply(msg.uploadBankReceived);
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[upload] failed to store/enqueue:', err);
    const showDetail = isAdmin(telegramId) || process.env.DEBUG_UPLOAD_ERRORS === 'true';
    await ctx.reply(showDetail ? `${msg.uploadError}\n\n🔧 ${detail}` : msg.uploadError);
  }
}

export async function handleWbFileReceived(ctx: BotContext, doc: DocumentInfo): Promise<void> {
  await handleFileUpload(ctx, doc, 'WB', ['.xlsx']);
}

export async function handleBankFileReceived(ctx: BotContext, doc: DocumentInfo): Promise<void> {
  await handleFileUpload(ctx, doc, 'BANK', ['.xlsx', '.csv']);
}

export { MAX_FILE_BYTES };
