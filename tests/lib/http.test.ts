import { describe, it, expect } from 'vitest';
import { okResponse, errResponse } from '@/src/lib/http';

describe('okResponse', () => {
  it('returns success envelope', async () => {
    const res = okResponse({ foo: 'bar' });
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ foo: 'bar' });
    expect(body.error).toBeNull();
    expect(res.status).toBe(200);
  });
});

describe('errResponse', () => {
  it('returns error envelope', async () => {
    const res = errResponse('TEST_ERROR', 'Test message', 400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('TEST_ERROR');
    expect(body.error.message).toBe('Test message');
  });
});
