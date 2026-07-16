import { createHash } from 'crypto';
import { createProfile } from '@/src/db/repositories/statement-profiles';
import type { HeaderDetectionResult } from '@/src/lib/parsing/headerDetection';

function shortHash(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 8);
}

export async function createDraftProfile(
  detectionResult: HeaderDetectionResult,
  fileSignature: string,
  userId: string,
  bankNameHint?: string,
): Promise<string> {
  const key = `draft_${Date.now()}_${shortHash(fileSignature)}`;
  const displayName = bankNameHint
    ? `Черновик: ${bankNameHint}`
    : 'Черновик: неизвестный банк';

  const profile = await createProfile({
    profile_key: key,
    display_name: displayName,
    bank_name_pattern: null,
    file_type: null,
    status: 'DRAFT',
    version: 1,
    signature: fileSignature,
    header_row_index: detectionResult.headerRowIndex,
    column_mapping: detectionResult.columnMapping as unknown as Record<string, unknown>,
    date_format: detectionResult.dateFormat,
    amount_format: detectionResult.amountFormat,
    usage_count: 0,
    success_rate: null,
    config_json: null,
    created_by: userId,
  });

  return profile.id;
}
