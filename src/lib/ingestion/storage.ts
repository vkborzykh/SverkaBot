import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

// In production this would be replaced with S3-compatible / Bolt Storage.
// For the MVP we write to a local uploads directory that maps to object storage.
// The storage_path returned is the canonical reference stored in DB.

const UPLOADS_DIR = process.env.UPLOADS_DIR ?? '/tmp/sverkbot-uploads';

export async function storeFile(
  userId: string,
  fileHash: string,
  ext: string,
  buffer: Buffer,
): Promise<string> {
  const storagePath = `imports/${userId}/${fileHash}.${ext}`;

  if (process.env.NODE_ENV !== 'test') {
    const dir = join(UPLOADS_DIR, 'imports', userId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${fileHash}.${ext}`), buffer);
  }

  return storagePath;
}

export async function storeReport(
  runId: string,
  buffer: Buffer,
): Promise<string> {
  const storagePath = `reports/${runId}/report.zip`;

  if (process.env.NODE_ENV !== 'test') {
    const dir = join(UPLOADS_DIR, 'reports', runId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'report.zip'), buffer);
  }

  return storagePath;
}

export function getStorageFilePath(storagePath: string): string {
  return join(UPLOADS_DIR, storagePath);
}
