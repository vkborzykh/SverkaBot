import { findMatchableProfiles } from '@/src/db/repositories/statement-profiles';
import type { HeaderDetectionResult } from '@/src/lib/parsing/headerDetection';

const MATCH_THRESHOLD = 0.7;

export interface ResolveResult {
  profileId: string | null;
  confidence: number;
  status: 'MATCHED' | 'DRAFT';
}

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
    if (!sv && !dv) continue;
    total += isRequired ? 2 : 1;
    if (sv && dv && sv === dv) {
      matches += isRequired ? 2 : 1;
    } else if (sv && dv && (sv.includes(dv) || dv.includes(sv))) {
      matches += isRequired ? 1.5 : 0.7;
    }
  }
  return total > 0 ? Math.min(1, matches / total) : 0;
}

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
  console.time('[resolveProfile] total');

  // Ищем ВСЕ профили (не только ACTIVE), чтобы не плодить черновики
  const allProfiles = await findMatchableProfiles();

  if (allProfiles.length === 0) {
    console.timeEnd('[resolveProfile] total');
    return { profileId: null, confidence: detectionResult.confidence, status: 'DRAFT' };
  }

  console.time('[resolveProfile] matching loop');
  let bestScore = 0;
  let bestProfileId: string | null = null;
  let bestConfidence = 0;

  for (const profile of allProfiles) {
    let score = 0;

    const sigScore = signatureSimilarity(
      profile.signature ?? '',
      detectionResult.signature,
    );
    score += sigScore * 0.55;

    const storedMapping = (profile.column_mapping ?? {}) as Record<string, unknown>;
    const detectedMapping = detectionResult.columnMapping as unknown as Record<string, unknown>;
    const mapScore = columnMapSimilarity(storedMapping, detectedMapping);
    score += mapScore * 0.25;

    if (profile.date_format && profile.date_format === detectionResult.dateFormat) {
      score += 0.05;
    }
    if (profile.amount_format && profile.amount_format === detectionResult.amountFormat) {
      score += 0.05;
    }

    const sr = parseFloat(profile.success_rate ?? '0');
    const uc = profile.usage_count ?? 0;
    const qualityBoost = (sr / 100) * 0.05 + Math.min(uc, 100) / 100 * 0.05;
    score += qualityBoost;

    if (score > bestScore) {
      bestScore = score;
      bestProfileId = profile.id;
      bestConfidence = Math.min(1, sigScore * 0.6 + detectionResult.confidence * 0.4);
    }
  }
  console.timeEnd('[resolveProfile] matching loop');

  let result: ResolveResult;
  if (bestScore >= MATCH_THRESHOLD && bestProfileId) {
    result = { profileId: bestProfileId, confidence: bestConfidence, status: 'MATCHED' };
  } else {
    result = { profileId: null, confidence: detectionResult.confidence, status: 'DRAFT' };
  }
  console.timeEnd('[resolveProfile] total');
  return result;
}
