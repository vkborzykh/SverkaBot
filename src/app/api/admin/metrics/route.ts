import { NextRequest } from 'next/server';
import { requireAdminToken } from '@/src/lib/guards';
import { okResponse } from '@/src/lib/http';

export async function GET(req: NextRequest) {
  const guard = requireAdminToken(req);
  if (guard) return guard;

  // TODO: return aggregated funnel, import quality, reconciliation quality, and monetization metrics
  return okResponse({
    funnel: { registrations: 0, consents: 0, uploads: 0, reconciliations: 0 },
    import_quality: { parse_success_rate_avg: 0, low_confidence_rate: 0 },
    reconciliation_quality: { match_rate_avg: 0, ambiguous_rate: 0 },
    monetization: { trial_to_paid_conversion: 0, repeat_reconciliation_rate: 0 },
  });
}
