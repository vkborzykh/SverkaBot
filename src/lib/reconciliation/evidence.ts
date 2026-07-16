import {
  createEvidence,
  type NewReconciliationEvidence,
} from '@/src/db/repositories/reconciliation-evidence';

export interface EvidenceInput {
  matchId: string;
  components: Record<string, number>;
  penalties: string[];
  finalScore: number;
}

export async function storeEvidence(input: EvidenceInput): Promise<void> {
  const row: NewReconciliationEvidence = {
    match_id: input.matchId,
    amount_score: String(
      (input.components.amount_score ?? 0).toFixed(4),
    ),
    date_score: String(
      (input.components.date_score ?? 0).toFixed(4),
    ),
    reference_score: String(
      (input.components.reference_score ?? 0).toFixed(4),
    ),
    description_score: String(
      (input.components.description_score ?? 0).toFixed(4),
    ),
    counterparty_score: String(
      (input.components.counterparty_score ?? 0).toFixed(4),
    ),
    penalties: input.penalties,
  };

  await createEvidence(row);
}
