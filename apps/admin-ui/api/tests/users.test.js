import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
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
  listGroups: vi.fn(async () => ({ results: [{ pk: 'gpk', name: 'admins' }] })),
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
  listUserDevices: vi.fn(async () => []),
  deleteDevice: vi.fn(),
  listUserSessions: vi.fn(async () => []),
  deleteSession: vi.fn(),
  DEVICE_KINDS: ['totp', 'static', 'webauthn', 'duo', 'sms', 'email', 'endpoint'],
  deviceKindFromModel: (m) => {
    if (!m) return null;
    const tail = String(m).split('.').pop() || '';
    const match = tail.match(/^([a-z]+)device$/);
    if (!match) return null;
    return ['totp', 'static', 'webauthn', 'duo', 'sms', 'email', 'endpoint'].includes(match[1])
      ? match[1]
      : null;
  },
}));

const authentik = await import('../src/authentik.js');
const { createApp } = await import('../src/app.js');

const ADMIN = {
  'x-authentik-username': 'tester',
  'x-authentik-name': 'Test User',
  'x-authentik-email': 'tester@example.com',
  'x-authentik-groups': 'admins',
};

beforeEach(() => {
  vi.clearAllMocks();
  authentik.findGroupByName.mockResolvedValue({ pk: 1, name: 'admins' });
  authentik.listGroups.mockResolvedValue({ results: [{ pk: 'gpk', name: 'admins' }] });
});

describe('GET /api/users', () => {
  it('returns normalized users with pagination metadata', async () => {
    authentik.listUsers.mockResolvedValue({
      results: [
        {
          pk: 42,
          username: 'alice',
          name: 'Alice',
          email: 'alice@example.com',
          is_active: true,
          groups: ['gpk'],
        },
      ],
      pagination: { count: 1 },
    });
    const res = await request(createApp({ logger: false }))
      .get('/api/users?search=al')
      .set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(1);
    expect(res.body.users[0].username).toBe('alice');
    expect(res.body.total).toBe(1);
    expect(res.body.page).toBe(1);
    expect(authentik.listUsers).toHaveBeenCalledWith('al', 'username', 1, 20, {});
  });
});

describe('GET /api/users/:id', () => {
  it('returns 500-ish error JSON when authentik throws', async () => {
    const err = new Error('Authentik 404');
    err.status = 404;
    authentik.getUser.mockRejectedValue(err);
    const res = await request(createApp({ logger: false }))
      .get('/api/users/9999')
      .set(ADMIN);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Authentik 404');
  });

  it('returns user on success', async () => {
    authentik.getUser.mockResolvedValue({
      pk: 1,
      username: 'bob',
      name: 'Bob',
      email: 'b@b',
      is_active: true,
      groups: [],
    });
    const res = await request(createApp({ logger: false }))
      .get('/api/users/1')
      .set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.username).toBe('bob');
  });
});

describe('PATCH /api/users/:id', () => {
  it('forwards body fields to authentik.updateUser', async () => {
    authentik.updateUser.mockResolvedValue({ pk: 1, username: 'bob', is_active: false });
    authentik.getUser.mockResolvedValue({ pk: 1, username: 'bob', is_active: false, groups: [] });
    const res = await request(createApp({ logger: false }))
      .patch('/api/users/1')
      .set(ADMIN)
      .send({ is_active: false, name: 'Bobby' });
    expect(res.status).toBe(200);
    expect(authentik.updateUser).toHaveBeenCalled();
    const call = authentik.updateUser.mock.calls[0];
    expect(call[0]).toBe(1);
    expect(call[1]).toMatchObject({ is_active: false, name: 'Bobby' });
  });
});

describe('POST /api/users/:id/impersonate', () => {
  it('returns 403 when ENABLE_IMPERSONATION is not set', async () => {
    delete process.env.ENABLE_IMPERSONATION;
    const res = await request(createApp({ logger: false }))
      .post('/api/users/1/impersonate')
      .set(ADMIN)
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/disabled/i);
  });

  it('returns impersonation URL when enabled', async () => {
    process.env.ENABLE_IMPERSONATION = 'true';
    process.env.AUTHENTIK_EXTERNAL_URL = 'https://auth.example.test';
    authentik.getUser.mockResolvedValue({
      pk: 7,
      username: 'victim',
      name: 'Victim User',
      is_active: true,
      groups: [],
    });
    const res = await request(createApp({ logger: false }))
      .post('/api/users/7/impersonate')
      .set(ADMIN)
      .send({ reason: 'debug ticket 123' });
    expect(res.status).toBe(200);
    expect(res.body.url).toBe('https://auth.example.test/-/impersonation/7/');
    expect(res.body.target).toEqual({ id: 7, username: 'victim', name: 'Victim User' });
    expect(authentik.getUser).toHaveBeenCalledWith(7);
  });

  it('returns 400 for non-numeric id', async () => {
    process.env.ENABLE_IMPERSONATION = 'true';
    const res = await request(createApp({ logger: false }))
      .post('/api/users/notanumber/impersonate')
      .set(ADMIN)
      .send({});
    expect(res.status).toBe(400);
  });
});

describe('GET /api/users/:id/devices', () => {
  it('normalizes meta_model_name into kind', async () => {
    authentik.listUserDevices.mockResolvedValue([
      {
        pk: 'd1',
        name: 'iPhone TOTP',
        meta_model_name: 'authentik_stages_authenticator_totp.totpdevice',
        type: 'authentik_stages_authenticator_totp.totpdevice',
        confirmed: true,
      },
      {
        pk: 'd2',
        name: 'YubiKey',
        meta_model_name: 'authentik_stages_authenticator_webauthn.webauthndevice',
        type: 'authentik_stages_authenticator_webauthn.webauthndevice',
        confirmed: true,
      },
    ]);
    const res = await request(createApp({ logger: false }))
      .get('/api/users/7/devices')
      .set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].kind).toBe('totp');
    expect(res.body[1].kind).toBe('webauthn');
    expect(authentik.listUserDevices).toHaveBeenCalledWith(7);
  });

  it('returns 400 for non-numeric id', async () => {
    const res = await request(createApp({ logger: false }))
      .get('/api/users/abc/devices')
      .set(ADMIN);
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/users/:id/devices/:kind/:pk', () => {
  it('rejects unknown device kinds', async () => {
    const res = await request(createApp({ logger: false }))
      .delete('/api/users/7/devices/bogus/abc')
      .set(ADMIN);
    expect(res.status).toBe(400);
    expect(authentik.deleteDevice).not.toHaveBeenCalled();
  });

  it('calls authentik.deleteDevice with kind + pk', async () => {
    authentik.deleteDevice.mockResolvedValue(undefined);
    const res = await request(createApp({ logger: false }))
      .delete('/api/users/7/devices/totp/123')
      .set(ADMIN);
    expect(res.status).toBe(204);
    expect(authentik.deleteDevice).toHaveBeenCalledWith('totp', '123');
  });
});

describe('GET /api/users/:id/sessions', () => {
  it('normalizes user-agent into a flat shape', async () => {
    authentik.listUserSessions.mockResolvedValue([
      {
        uuid: 'sess-1',
        current: true,
        last_ip: '10.0.0.1',
        last_used: '2026-01-01T00:00:00Z',
        expires: '2026-02-01T00:00:00Z',
        user_agent: {
          user_agent: { family: 'Chrome', major: '120' },
          os: { family: 'macOS' },
          device: { family: 'Mac' },
        },
        geo_ip: null,
      },
    ]);
    const res = await request(createApp({ logger: false }))
      .get('/api/users/7/sessions')
      .set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      uuid: 'sess-1',
      current: true,
      user_agent: 'Chrome 120',
      os: 'macOS',
      device: 'Mac',
    });
  });
});

describe('DELETE /api/users/:id/sessions/:uuid', () => {
  it('calls authentik.deleteSession', async () => {
    authentik.deleteSession.mockResolvedValue(undefined);
    const res = await request(createApp({ logger: false }))
      .delete('/api/users/7/sessions/abc-123')
      .set(ADMIN);
    expect(res.status).toBe(204);
    expect(authentik.deleteSession).toHaveBeenCalledWith('abc-123');
  });
});
