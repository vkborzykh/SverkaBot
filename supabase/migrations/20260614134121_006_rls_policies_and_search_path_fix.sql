-- Fix 1: Lock down set_updated_at search_path to prevent mutable search_path vulnerability
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Fix 2: Add RLS policies for every table.
--
-- Architecture: all server-side operations use the service role key, which
-- bypasses RLS entirely in PostgreSQL. No direct authenticated/anon access is
-- intended. We add explicit DENY-ALL policies for authenticated and anon roles
-- so Supabase Advisor reports no "RLS enabled but no policy" warnings, while
-- keeping the tables fully locked to non-service-role connections.

-- ── users ─────────────────────────────────────────────────────────────────────
CREATE POLICY "users_deny_anon"         ON public.users FOR ALL TO anon        USING (false);
CREATE POLICY "users_deny_authenticated" ON public.users FOR ALL TO authenticated USING (false);

-- ── consents ──────────────────────────────────────────────────────────────────
CREATE POLICY "consents_deny_anon"          ON public.consents FOR ALL TO anon        USING (false);
CREATE POLICY "consents_deny_authenticated" ON public.consents FOR ALL TO authenticated USING (false);

-- ── statement_profiles ────────────────────────────────────────────────────────
CREATE POLICY "statement_profiles_deny_anon"          ON public.statement_profiles FOR ALL TO anon        USING (false);
CREATE POLICY "statement_profiles_deny_authenticated" ON public.statement_profiles FOR ALL TO authenticated USING (false);

-- ── imports ───────────────────────────────────────────────────────────────────
CREATE POLICY "imports_deny_anon"          ON public.imports FOR ALL TO anon        USING (false);
CREATE POLICY "imports_deny_authenticated" ON public.imports FOR ALL TO authenticated USING (false);

-- ── parsing_errors ────────────────────────────────────────────────────────────
CREATE POLICY "parsing_errors_deny_anon"          ON public.parsing_errors FOR ALL TO anon        USING (false);
CREATE POLICY "parsing_errors_deny_authenticated" ON public.parsing_errors FOR ALL TO authenticated USING (false);

-- ── canonical_transactions ────────────────────────────────────────────────────
CREATE POLICY "canonical_transactions_deny_anon"          ON public.canonical_transactions FOR ALL TO anon        USING (false);
CREATE POLICY "canonical_transactions_deny_authenticated" ON public.canonical_transactions FOR ALL TO authenticated USING (false);

-- ── reconciliation_runs ───────────────────────────────────────────────────────
CREATE POLICY "reconciliation_runs_deny_anon"          ON public.reconciliation_runs FOR ALL TO anon        USING (false);
CREATE POLICY "reconciliation_runs_deny_authenticated" ON public.reconciliation_runs FOR ALL TO authenticated USING (false);

-- ── reconciliation_candidates ─────────────────────────────────────────────────
CREATE POLICY "reconciliation_candidates_deny_anon"          ON public.reconciliation_candidates FOR ALL TO anon        USING (false);
CREATE POLICY "reconciliation_candidates_deny_authenticated" ON public.reconciliation_candidates FOR ALL TO authenticated USING (false);

-- ── reconciliation_matches ────────────────────────────────────────────────────
CREATE POLICY "reconciliation_matches_deny_anon"          ON public.reconciliation_matches FOR ALL TO anon        USING (false);
CREATE POLICY "reconciliation_matches_deny_authenticated" ON public.reconciliation_matches FOR ALL TO authenticated USING (false);

-- ── reconciliation_match_items ────────────────────────────────────────────────
CREATE POLICY "reconciliation_match_items_deny_anon"          ON public.reconciliation_match_items FOR ALL TO anon        USING (false);
CREATE POLICY "reconciliation_match_items_deny_authenticated" ON public.reconciliation_match_items FOR ALL TO authenticated USING (false);

-- ── reconciliation_evidence ───────────────────────────────────────────────────
CREATE POLICY "reconciliation_evidence_deny_anon"          ON public.reconciliation_evidence FOR ALL TO anon        USING (false);
CREATE POLICY "reconciliation_evidence_deny_authenticated" ON public.reconciliation_evidence FOR ALL TO authenticated USING (false);

-- ── reports ───────────────────────────────────────────────────────────────────
CREATE POLICY "reports_deny_anon"          ON public.reports FOR ALL TO anon        USING (false);
CREATE POLICY "reports_deny_authenticated" ON public.reports FOR ALL TO authenticated USING (false);

-- ── billing_transactions ──────────────────────────────────────────────────────
CREATE POLICY "billing_transactions_deny_anon"          ON public.billing_transactions FOR ALL TO anon        USING (false);
CREATE POLICY "billing_transactions_deny_authenticated" ON public.billing_transactions FOR ALL TO authenticated USING (false);

-- ── settings ──────────────────────────────────────────────────────────────────
CREATE POLICY "settings_deny_anon"          ON public.settings FOR ALL TO anon        USING (false);
CREATE POLICY "settings_deny_authenticated" ON public.settings FOR ALL TO authenticated USING (false);

-- ── audit_events ──────────────────────────────────────────────────────────────
CREATE POLICY "audit_events_deny_anon"          ON public.audit_events FOR ALL TO anon        USING (false);
CREATE POLICY "audit_events_deny_authenticated" ON public.audit_events FOR ALL TO authenticated USING (false);

-- ── jobs ──────────────────────────────────────────────────────────────────────
CREATE POLICY "jobs_deny_anon"          ON public.jobs FOR ALL TO anon        USING (false);
CREATE POLICY "jobs_deny_authenticated" ON public.jobs FOR ALL TO authenticated USING (false);
