// Report export stubs.
// Implements section 8 of Tech Plan v4.2.

export interface ReportArtifact {
  url: string;
  exportType: 'GOOGLE_SHEETS' | 'ZIP';
}

export async function generateReport(_runId: string): Promise<ReportArtifact> {
  throw new Error('Not implemented');
}

export async function exportToGoogleSheets(_runId: string): Promise<string> {
  throw new Error('Not implemented');
}

export async function exportToZip(_runId: string): Promise<string> {
  throw new Error('Not implemented');
}
