import { findActiveProfiles } from '@/src/db/repositories/statement-profiles';
import type { HeaderDetectionResult } from '@/src/lib/parsing/headerDetection';

const MATCH_THRESHOLD = 0.7;

export interface ResolveResult {
  profileId: string | null;
  confidence: number;
  status: 'MATCHED' | 'DRAFT';
}

/**
 * Compare two column-mapping objects and return a 0-1 similarity score.
 * Comparison is by normalised string value of each mapped column name/index.
 */
function columnMapSimilarity(
  stored: Record<string, unknown>,
  detected: Record<string, unknown>,
): number {
  const keys = ['dateColumn', 'amountColumn', 'descriptionColumn', 'counterpartyColumn', 'referenceColumn'];
  const required = ['dateColumn', 'amountColumn'];

  let matches = 0;
  let total = 0;

  for (const key of keys) {
    const sv = String(stored[key] ?? '').trim().toLowerCase();
    const dv = String(detected[key] ?? '').trim().toLowerCase();
    const isRequired = required.includes(key);

    if (!sv && !dv) continue; // both absent – neutral
    total += isRequired ? 2 : 1;

    if (sv && dv && sv === dv) {
      matches += isRequired ? 2 : 1;
    } else if (sv && dv && (sv.includes(dv) || dv.includes(sv))) {
      matches += isRequired ? 1.5 : 0.7;
    }
  }

  return total > 0 ? Math.min(1, matches / total) : 0;
}

/**
 * Normalised string similarity (Sørensen-Dice coefficient on trigrams).
 * Cheap approximation for short header signatures.
 */
function signatureSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;

  const trigrams = (s: string): Set<string> => {
    const t = new Set<string>();
    const padded = `  ${s}  `;
    for (let i = 0; i < padded.length - 2; i++) t.add(padded.slice(i, i + 3));
    return t;
  };

  const ta = trigrams(a);
  const tb = trigrams(b);
  let inter = 0;
  Array.from(ta).forEach((t) => { if (tb.has(t)) inter++; });
  return (2 * inter) / (ta.size + tb.size);
}

export async function resolveProfile(
  detectionResult: HeaderDetectionResult,
  _fileSignature: string,
  _userId: string,
): Promise<ResolveResult> {
  const activeProfiles = await findActiveProfiles();
  if (activeProfiles.length === 0) {
    return { profileId: null, confidence: detectionResult.confidence, status: 'DRAFT' };
  }

  let bestScore = 0;
  let bestProfileId: string | null = null;
  let bestConfidence = 0;

  for (const profile of activeProfiles) {
    let score = 0;

    // 1. Signature similarity (most important signal)
    const sigScore = signatureSimilarity(
      profile.signature ?? '',
      detectionResult.signature,
    );
    score += sigScore * 0.55;

    // 2. Column mapping similarity
    const storedMapping = (profile.column_mapping ?? {}) as Record<string, unknown>;
    const detectedMapping = detectionResult.columnMapping as unknown as Record<string, unknown>;
    const mapScore = columnMapSimilarity(storedMapping, detectedMapping);
    score += mapScore * 0.25;

    // 3. Date format match
    if (profile.date_format && profile.date_format === detectionResult.dateFormat) {
      score += 0.05;
    }

    // 4. Amount format match
    if (profile.amount_format && profile.amount_format === detectionResult.amountFormat) {
      score += 0.05;
    }

    // 5. Quality boost: high success_rate and usage_count
    const sr = parseFloat(profile.success_rate ?? '0');
    const uc = profile.usage_count ?? 0;
    const qualityBoost = (sr / 100) * 0.05 + Math.min(uc, 100) / 100 * 0.05;
    score += qualityBoost;

    if (score > bestScore) {
      bestScore = score;
      bestProfileId = profile.id;
      // confidence is the weighted combination of signature match + header detection confidence
      bestConfidence = Math.min(1, sigScore * 0.6 + detectionResult.confidence * 0.4);
    }
  }

  if (bestScore >= MATCH_THRESHOLD && bestProfileId) {
    return { profileId: bestProfileId, confidence: bestConfidence, status: 'MATCHED' };
  }

  return { profileId: null, confidence: detectionResult.confidence, status: 'DRAFT' };
}
