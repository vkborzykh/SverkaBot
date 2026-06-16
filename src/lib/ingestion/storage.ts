import { getSupabaseAdmin, STORAGE_BUCKET } from '@/src/lib/supabase/client';

// Files live in Supabase Storage (persistent across serverless invocations).
// Object keys are kept identical to the previous local-FS layout so existing
// `imports.storage_path` / `reports.storage_path` values remain valid:
//   imports/{userId}/{fileHash}.{ext}
//   reports/{runId}/report.zip

function isTest(): boolean {
  return process.env.NODE_ENV === 'test';
}

function contentTypeForExt(ext: string): string {
  if (ext === 'csv') return 'text/csv';
  if (ext === 'xlsx') {
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }
  return 'application/octet-stream';
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

export async function storeReport(runId: string, buffer: Buffer): Promise<string> {
  const storagePath = `reports/${runId}/report.zip`;
  if (isTest()) return storagePath;

  const { error } = await getSupabaseAdmin()
    .storage.from(STORAGE_BUCKET)
    .upload(storagePath, buffer, { contentType: 'application/zip', upsert: true });
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
  // remove() is idempotent: missing objects are not an error.
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
