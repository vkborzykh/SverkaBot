import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Server-side Supabase client using the service-role key. It bypasses RLS and
// has full access to Storage, so it MUST only ever be imported in server code
// (route handlers, jobs) and never bundled into anything sent to the browser.

let _client: SupabaseClient | undefined;

export function getSupabaseAdmin(): SupabaseClient {
  if (!_client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set');
    if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
    _client = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _client;
}

// Private bucket holding uploaded source files and generated report archives.
export const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? 'sverkabot';
