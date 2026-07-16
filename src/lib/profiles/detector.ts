// Statement Profile detection stub.
// Implements section 6.3 of Tech Plan v4.2.

export interface ProfileMatchResult {
  profileId: string | null;
  status: 'MATCHED' | 'DRAFT';
  confidence: number;
}

export async function detectProfile(
  _fileBuffer: Buffer,
): Promise<ProfileMatchResult> {
  throw new Error('Not implemented');
}

export async function createDraftProfile(
  _fileBuffer: Buffer,
  _detectedStructure: unknown,
): Promise<string> {
  throw new Error('Not implemented');
}
