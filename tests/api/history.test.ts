import { describe, it, expect } from 'vitest';

// Placeholder — full API route integration tests will be added in subsequent phases.
describe('GET /api/history', () => {
  it('returns 401 without X-Internal-Token', async () => {
    const { GET } = await import('@/src/app/api/history/route');
    const req = new Request('http://localhost/api/history');
    const res = await GET(req as any);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });
});
