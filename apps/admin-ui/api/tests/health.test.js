import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  delete process.env.DATABASE_URL;
});

vi.mock('../src/authentik.js', () => ({
  findGroupByName: vi.fn(async () => ({ pk: 1, name: 'admins' })),
  listUsers: vi.fn(),
  listUsersByGroupPk: vi.fn(),
  getUser: vi.fn(),
  getUserByUuid: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  deleteUser: vi.fn(),
  setPassword: vi.fn(),
  recoveryLink: vi.fn(),
  listApplications: vi.fn(async () => ({ results: [] })),
  getApplication: vi.fn(),
  listGroups: vi.fn(async () => ({ results: [] })),
  ensureGroup: vi.fn(),
  getGroup: vi.fn(),
  createGroup: vi.fn(),
  updateGroup: vi.fn(),
  deleteGroup: vi.fn(),
  setUserGroups: vi.fn(),
  addUserToGroup: vi.fn(),
  removeUserFromGroup: vi.fn(),
  listPolicyBindings: vi.fn(),
  findProxyProvider: vi.fn(),
  createProxyProvider: vi.fn(),
  createApplication: vi.fn(),
  getOutpost: vi.fn(),
  updateOutpostProviders: vi.fn(),
  listPolicyBindingsForApp: vi.fn(async () => ({ results: [] })),
  ensureGroupBinding: vi.fn(),
  findExpressionPolicy: vi.fn(),
  deletePolicyBinding: vi.fn(),
  deleteExpressionPolicy: vi.fn(),
}));

const { createApp } = await import('../src/app.js');

function adminHeaders(overrides = {}) {
  return {
    'x-authentik-username': 'tester',
    'x-authentik-name': 'Test User',
    'x-authentik-email': 'tester@example.com',
    'x-authentik-groups': 'admins',
    ...overrides,
  };
}

describe('/api/health', () => {
  it('returns 200 with status ok (no auth required)', async () => {
    const res = await request(createApp({ logger: false })).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('/api/me', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await request(createApp({ logger: false })).get('/api/me');
    expect(res.status).toBe(401);
  });

  it('returns 403 when not in admins group', async () => {
    const res = await request(createApp({ logger: false }))
      .get('/api/me')
      .set(adminHeaders({ 'x-authentik-groups': 'users' }));
    expect(res.status).toBe(403);
  });

  it('returns identity and features for admins', async () => {
    const res = await request(createApp({ logger: false }))
      .get('/api/me')
      .set(adminHeaders());
    expect(res.status).toBe(200);
    expect(res.body.username).toBe('tester');
    expect(res.body.groups).toContain('admins');
    expect(res.body.features).toBeDefined();
    expect(typeof res.body.features.impersonation).toBe('boolean');
    expect(typeof res.body.features.audit).toBe('boolean');
    expect(res.body.features.audit).toBe(false);
  });
});
