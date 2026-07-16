// Bank statement file parser stub.
// Implements section 6.1–6.4 of Tech Plan v4.2.

export interface ParseResult {
  rows: number;
  errors: number;
  parseSuccessRate: number;
  profileId: string | null;
  profileStatus: 'MATCHED' | 'DRAFT';
  profileConfidence: number | null;
}

export async function parseBankFile(
  _fileBuffer: Buffer,
  _importId: string,
  _profileId?: string,
): Promise<ParseResult> {
  throw new Error('Not implemented');
}
