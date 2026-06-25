import { getSupabaseAdmin, STORAGE_BUCKET } from '@/src/lib/supabase/client';

function isTest(): boolean {
  return process.env.NODE_ENV === 'test';
}

function contentTypeForExt(ext: string): string {
  if (ext === 'csv') return 'text/csv';
  if (ext === 'xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (ext === 'html') return 'text/html';
  return 'application/octet-stream';
}

// Скачивает отчёт из бакета sverkabot по пути storage_path
export async function downloadReport(path: string): Promise<Buffer> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(path);
  if (error) throw error;
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function storeFile(
  userId: string,
  fileHash: string,
  ext: string,
  buffer: Buffer,
): Promise<string> {
  const storagePath = `imports/${userId}/${fileHash}.${ext}`;
  if (isTest()) return storagePath;

  const { error } = await getSupabaseAdmin()
    .storage.from(STORAGE_BUCKET)
    .upload(storagePath, buffer, {
      contentType: contentTypeForExt(ext),
      upsert: true,
    });
  if (error) throw new Error(`Storage upload failed (${storagePath}): ${error.message}`);
  return storagePath;
}

export async function storeReport(
  runId: string,
  buffer: Buffer,
  mimeType: string = 'application/zip'
): Promise<string> {
  // Определяем расширение по MIME-типу
  const ext = mimeType === 'text/html' ? 'html' : 'zip';
  const storagePath = `reports/${runId}/report.${ext}`;
  if (isTest()) return storagePath;

  const { error } = await getSupabaseAdmin()
    .storage.from(STORAGE_BUCKET)
    .upload(storagePath, buffer, {
      contentType: mimeType,
      upsert: true,
    });
  if (error) throw new Error(`Storage upload failed (${storagePath}): ${error.message}`);
  return storagePath;
}

export async function loadFile(storagePath: string): Promise<Buffer> {
  if (isTest()) return Buffer.alloc(0);

  const { data, error } = await getSupabaseAdmin()
    .storage.from(STORAGE_BUCKET)
    .download(storagePath);
  if (error || !data) {
    throw new Error(`Storage download failed (${storagePath}): ${error?.message ?? 'no data'}`);
  }
  return Buffer.from(await data.arrayBuffer());
}

export async function deleteFile(storagePath: string): Promise<void> {
  if (isTest()) return;
  const { error } = await getSupabaseAdmin()
    .storage.from(STORAGE_BUCKET)
    .remove([storagePath]);
  if (error) throw new Error(`Storage delete failed (${storagePath}): ${error.message}`);
}

export async function deleteDirectory(prefix: string): Promise<void> {
  if (isTest()) return;
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).list(prefix);
  if (error) throw new Error(`Storage list failed (${prefix}): ${error.message}`);
  if (!data || data.length === 0) return;

  const paths = data.map((obj) => `${prefix}/${obj.name}`);
  const { error: rmError } = await supabase.storage.from(STORAGE_BUCKET).remove(paths);
  if (rmError) throw new Error(`Storage delete failed (${prefix}): ${rmError.message}`);
}
