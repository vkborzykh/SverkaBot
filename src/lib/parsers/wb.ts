// WB file parser stub.
// Implements section 6.1 of Tech Plan v4.2.

export interface ParseResult {
  rows: number;
  errors: number;
  parseSuccessRate: number;
}

export async function parseWBFile(
  _fileBuffer: Buffer,
  _importId: string,
): Promise<ParseResult> {
  throw new Error('Not implemented');
}
