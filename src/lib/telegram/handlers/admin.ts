import type { Context } from 'telegraf';
import { sql } from 'drizzle-orm';
import { isNull } from 'drizzle-orm';
import { getDb } from '@/src/db/index';
import { statement_profiles } from '@/src/db/schema';
import { findProfileById, updateProfile } from '@/src/db/repositories/statement-profiles';
import { findRunById } from '@/src/db/repositories/reconciliation-runs';
import { findPrimaryReportByRunId } from '@/src/db/repositories/reports';
import { logAuditEvent } from '@/src/lib/audit/audit';
import { enqueue } from '@/src/lib/jobs/queue';
import { reports } from '@/src/db/schema';
import { eq, and } from 'drizzle-orm';
import { msg } from '../messages.ru';
import { isAdmin } from '../access';

export async function handleViewProfiles(ctx: Context): Promise<void> {
  if (!isAdmin(BigInt(ctx.from!.id))) { await ctx.reply(msg.adminNotAuthorized); return; }
  const db = getDb();
  const profiles = await db
    .select()
    .from(statement_profiles)
    .where(isNull(statement_profiles.deleted_at))
    .orderBy(statement_profiles.created_at)
    .limit(20);

  if (profiles.length === 0) {
    await ctx.reply(msg.adminNoProfiles);
    return;
  }

  const lines = profiles.map((p) =>
    msg.adminProfileRow(
      p.id,
      p.display_name ?? p.profile_key,
      p.status ?? '—',
      p.usage_count ?? 0,
      p.success_rate ?? '0',
    ),
  );

  await ctx.reply(`${msg.adminProfilesHeader}\n\n${lines.join('\n\n')}`);
}

export async function handleActivateProfile(ctx: Context): Promise<void> {
  if (!isAdmin(BigInt(ctx.from!.id))) { await ctx.reply(msg.adminNotAuthorized); return; }
  const text = (ctx.message && 'text' in ctx.message ? ctx.message.text : '') ?? '';
  const parts = text.trim().split(/\s+/);
  const profileId = parts[1];

  if (!profileId) {
    await ctx.reply(msg.adminProfileMissingId);
    return;
  }

  const profile = await findProfileById(profileId);
  if (!profile) {
    await ctx.reply(msg.adminProfileNotFound);
    return;
  }

  await updateProfile(profileId, { status: 'ACTIVE' });
  await logAuditEvent(null, 'profile_activated', {
    profile_id: profileId,
    previous_status: profile.status,
    source: 'telegram',
  });

  await ctx.reply(msg.adminProfileActivated(profileId));
}

export async function handleDeprecateProfile(ctx: Context): Promise<void> {
  if (!isAdmin(BigInt(ctx.from!.id))) { await ctx.reply(msg.adminNotAuthorized); return; }
  const text = (ctx.message && 'text' in ctx.message ? ctx.message.text : '') ?? '';
  const parts = text.trim().split(/\s+/);
  const profileId = parts[1];

  if (!profileId) {
    await ctx.reply(msg.adminProfileMissingId);
    return;
  }

  const profile = await findProfileById(profileId);
  if (!profile) {
    await ctx.reply(msg.adminProfileNotFound);
    return;
  }

  await updateProfile(profileId, { status: 'DEPRECATED' });
  await logAuditEvent(null, 'profile_deprecated', {
    profile_id: profileId,
    previous_status: profile.status,
    source: 'telegram',
  });

  await ctx.reply(msg.adminProfileDeprecated(profileId));
}

export async function handleViewErrors(ctx: Context): Promise<void> {
  if (!isAdmin(BigInt(ctx.from!.id))) { await ctx.reply(msg.adminNotAuthorized); return; }
  const db = getDb();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const errors = await db.execute(sql`
    SELECT import_id, row_number, error_code, error_message
    FROM parsing_errors
    WHERE created_at >= ${thirtyDaysAgo}
    ORDER BY created_at DESC
    LIMIT 20
  `);

  if (!errors || errors.length === 0) {
    await ctx.reply(msg.adminNoErrors);
    return;
  }

  const lines = errors.map((e: Record<string, unknown>) =>
    msg.adminErrorRow(
      String(e.import_id ?? ''),
      Number(e.row_number ?? 0),
      String(e.error_code ?? ''),
      String(e.error_message ?? '').slice(0, 80),
    ),
  );

  await ctx.reply(`${msg.adminErrorsHeader}\n\n${lines.join('\n')}`);
}

export async function handleStats(ctx: Context): Promise<void> {
  if (!isAdmin(BigInt(ctx.from!.id))) { await ctx.reply(msg.adminNotAuthorized); return; }
  const db = getDb();

  const result = await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM users WHERE deleted_at IS NULL) AS registrations,
      (SELECT count(*)::int FROM users WHERE consent_given_at IS NOT NULL AND deleted_at IS NULL) AS consents,
      (SELECT count(*)::int FROM imports WHERE deleted_at IS NULL) AS uploads,
      (SELECT count(*)::int FROM reconciliation_runs) AS reconciliations,
      COALESCE((SELECT AVG(parse_success_rate)::numeric(5,2) FROM imports WHERE status = 'COMPLETED' AND deleted_at IS NULL), 0) AS parse_success_rate_avg,
      COALESCE((SELECT AVG(match_rate)::numeric(5,2) FROM reconciliation_runs WHERE status = 'COMPLETED'), 0) AS match_rate_avg,
      COALESCE(
        (SELECT count(DISTINCT id)::float FROM users WHERE subscription_status = 'ACTIVE' AND deleted_at IS NULL)
        / NULLIF((SELECT count(DISTINCT id)::float FROM users WHERE deleted_at IS NULL), 0)
        * 100, 0
      )::numeric(5,2) AS conversion_rate
  `);

  const row = result[0] ?? {};

  const text = [
    msg.adminStatsHeader,
    '',
    `Воронка:`,
    `  Регистрации: ${row.registrations ?? 0}`,
    `  Согласия: ${row.consents ?? 0}`,
    `  Загрузки: ${row.uploads ?? 0}`,
    `  Сверки: ${row.reconciliations ?? 0}`,
    '',
    `Качество:`,
    `  Ср. точность парсинга: ${row.parse_success_rate_avg ?? 0}%`,
    `  Ср. совпадение сверки: ${row.match_rate_avg ?? 0}%`,
    '',
    `Монетизация:`,
    `  Конверсия в платную: ${row.conversion_rate ?? 0}%`,
  ].join('\n');

  await ctx.reply(text);
}

export async function handleRetryExport(ctx: Context): Promise<void> {
  if (!isAdmin(BigInt(ctx.from!.id))) { await ctx.reply(msg.adminNotAuthorized); return; }
  const text = (ctx.message && 'text' in ctx.message ? ctx.message.text : '') ?? '';
  const parts = text.trim().split(/\s+/);
  const runId = parts[1];

  if (!runId) {
    await ctx.reply(msg.adminRetryMissingId);
    return;
  }

  const run = await findRunById(runId);
  if (!run) {
    await ctx.reply(msg.adminRunNotFound);
    return;
  }

  // Mark previous primary report as non-primary
  const existingReport = await findPrimaryReportByRunId(runId);
  if (existingReport) {
    const db = getDb();
    await db
      .update(reports)
      .set({ is_primary: false })
      .where(and(eq(reports.id, existingReport.id)));
  }

  const jobId = await enqueue('report_export', runId, { run_id: runId, retry: true });
  await ctx.reply(msg.adminRetryQueued(runId, jobId));
}
