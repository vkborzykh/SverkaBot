export const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB

export function validateFileSize(
  sizeBytes: number,
  maxBytes = MAX_FILE_BYTES,
): boolean {
  return sizeBytes <= maxBytes;
}

export function validateExtension(
  filename: string,
  allowedExtensions: string[],
): boolean {
  const lower = filename.toLowerCase();
  return allowedExtensions.some((ext) => lower.endsWith(ext));
}
