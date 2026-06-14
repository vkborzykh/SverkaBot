import { validateFileSize, validateExtension, MAX_FILE_BYTES } from '@/src/lib/ingestion/validate';
import { sha256 } from '@/src/lib/ingestion/hash';
import { storeFile } from '@/src/lib/ingestion/storage';
import { findImportByHash, createImport } from '@/src/db/repositories/imports';
import { findUserByTelegramId } from '@/src/db/repositories/users';
import { enqueue } from '@/src/lib/jobs/queue';
import { checkAccess } from '@/src/lib/telegram/access';
import { msg } from '@/src/lib/telegram/messages.ru';
import { setSession, clearSession } from '@/src/lib/telegram/session';
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

  // Access check
  const user = await findUserByTelegramId(telegramId);
  if (!user) {
    await ctx.reply(msg.accessExpired);
    return;
  }
  const access = checkAccess(user);
  if (access !== 'full') {
    await ctx.reply(msg.accessExpired);
    return;
  }

  // Validate extension
  if (!validateExtension(doc.fileName, allowedExtensions)) {
    await ctx.reply(msg.errInvalidFormat);
    return;
  }

  // Validate size
  if (!validateFileSize(doc.fileSizeBytes)) {
    await ctx.reply(msg.errFileTooLarge);
    return;
  }

  // Download file
  let buffer: Buffer;
  try {
    buffer = await downloadTelegramFile(doc.fileId);
  } catch {
    await ctx.reply(msg.errInvalidFormat);
    return;
  }

  // Re-validate buffer size (Telegram's reported size might differ)
  if (!validateFileSize(buffer.byteLength)) {
    await ctx.reply(msg.errFileTooLarge);
    return;
  }

  const fileHash = sha256(buffer);

  // Deduplication
  const existing = await findImportByHash(user.id, sourceType, fileHash);
  if (existing) {
    await ctx.reply(msg.uploadDuplicateImport(existing.id));
    return;
  }

  // Determine extension
  const ext = doc.fileName.toLowerCase().endsWith('.csv') ? 'csv' : 'xlsx';

  // Store file
  const storagePath = await storeFile(user.id, fileHash, ext, buffer);

  // Create import record
  const newImport = await createImport({
    user_id: user.id,
    source_type: sourceType,
    storage_path: storagePath,
    original_filename: doc.fileName,
    file_hash: fileHash,
    file_size_bytes: BigInt(buffer.byteLength),
    status: 'RECEIVED',
  });

  // Enqueue parsing job
  const jobType = sourceType === 'WB' ? 'parse_wb' : 'parse_bank';
  await enqueue(jobType, newImport.id, { import_id: newImport.id });

  clearSession(telegramId);

  if (sourceType === 'WB') {
    await ctx.reply(msg.uploadWbReceived(newImport.id));
  } else {
    await ctx.reply(msg.uploadBankReceived);
  }
}

export async function handleUploadWbCommand(ctx: BotContext): Promise<void> {
  const from = ctx.from;
  if (!from) return;
  const telegramId = BigInt(from.id);

  const user = await findUserByTelegramId(telegramId);
  if (!user || checkAccess(user) !== 'full') {
    await ctx.reply(msg.accessExpired);
    return;
  }

  setSession(telegramId, 'awaiting_wb_file');
  await ctx.reply(msg.uploadWbPrompt);
}

export async function handleUploadBankCommand(ctx: BotContext): Promise<void> {
  const from = ctx.from;
  if (!from) return;
  const telegramId = BigInt(from.id);

  const user = await findUserByTelegramId(telegramId);
  if (!user || checkAccess(user) !== 'full') {
    await ctx.reply(msg.accessExpired);
    return;
  }

  setSession(telegramId, 'awaiting_bank_file');
  await ctx.reply(msg.uploadBankPrompt);
}

export async function handleWbFileReceived(
  ctx: BotContext,
  doc: DocumentInfo,
): Promise<void> {
  await handleFileUpload(ctx, doc, 'WB', ['.xlsx']);
}

export async function handleBankFileReceived(
  ctx: BotContext,
  doc: DocumentInfo,
): Promise<void> {
  await handleFileUpload(ctx, doc, 'BANK', ['.xlsx', '.csv']);
}

export { MAX_FILE_BYTES };
