// Runs a promise as "background" work that survives the serverless response.
//
// On Vercel, returning from a route handler freezes the instance and any
// un-awaited promise is killed before it runs. `waitUntil` (from
// @vercel/functions) keeps the instance alive until the promise settles —
// bounded by the route's `maxDuration`. Works on every Vercel plan,
// including Hobby.
//
// The import is guarded so the module still loads in environments where
// @vercel/functions is unavailable (e.g. local `next dev`, unit tests),
// where an un-awaited promise simply runs to completion anyway.

let _waitUntil: ((p: Promise<unknown>) => void) | undefined;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ({ waitUntil: _waitUntil } = require('@vercel/functions'));
} catch {
  // Not running on Vercel — fall back to fire-and-forget.
}

export function runBackground(promise: Promise<unknown>): void {
  // Never let background work throw into the request lifecycle.
  const safe = promise.catch(() => {});
  if (_waitUntil) {
    try {
      _waitUntil(safe);
      return;
    } catch {
      // Outside a request context (rare) — fall through to fire-and-forget.
    }
  }
  void safe;
}
