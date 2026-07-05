import { describe, it, expect, beforeAll, vi } from 'vitest';

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  delete process.env.DATABASE_URL;
});

const audit = await import('../src/lib/audit.js');

describe('audit module (DATABASE_URL unset)', () => {
  it('reports disabled', () => {
    expect(audit.isEnabled()).toBe(false);
  });

  it('init() is a no-op and does not throw', async () => {
    await expect(audit.init()).resolves.toBeUndefined();
  });

  it('log() does not throw', () => {
    expect(() =>
      audit.log({ actor: 'x', action: 'test.action', target_type: 'user', target: 'y' })
    ).not.toThrow();
  });

  it('logFromReq() does not throw', () => {
    const req = { actor: { username: 'x' }, ip: '127.0.0.1', headers: {} };
    expect(() => audit.logFromReq(req, { action: 'a' })).not.toThrow();
  });

  it('query() returns empty result set', async () => {
    const res = await audit.query({});
    expect(res).toEqual({ entries: [], total: 0 });
  });

  it('recent() returns []', async () => {
    const res = await audit.recent(5);
    expect(res).toEqual([]);
  });
});
