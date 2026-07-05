import axios from 'axios';
import http from 'http';
import https from 'https';

const baseURL = process.env.AUTHENTIK_URL || 'http://localhost:9000';
const token = process.env.AUTHENTIK_API_TOKEN;

// Keep-alive agents so we don't re-handshake for every Authentik call.
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 50 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 50 });

const client = axios.create({
  baseURL,
  timeout: 10_000,
  httpAgent,
  httpsAgent,
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
});

// Single retry with linear backoff for transient failures on idempotent GETs.
// Network errors and 5xx only — never retry 4xx (which means our request was
// wrong) or non-GET methods (which may not be idempotent).
const RETRY_DELAY_MS = 250;
client.interceptors.response.use(undefined, async (err) => {
  const cfg = err.config;
  if (!cfg || cfg.__retried) throw err;
  if ((cfg.method || 'get').toLowerCase() !== 'get') throw err;
  const status = err.response?.status;
  const isTransient = !err.response || (status >= 500 && status < 600) || err.code === 'ECONNABORTED';
  if (!isTransient) throw err;
  cfg.__retried = true;
  await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
  return client.request(cfg);
});

// wrap() centralizes the try/catch + apiError() boilerplate that every
// Authentik call was duplicating. `message` may be a string or a function of
// the args passed to fn.
function wrap(message, fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      const msg = typeof message === 'function' ? message(...args) : message;
      throw apiError(msg, err);
    }
  };
}

// ── Users ──────────────────────────────────────────────

export const listUsers = wrap('Failed to list users', async (search, ordering = 'username', page = 1, pageSize = 20, extraParams = {}) => {
  const { data } = await client.get('/api/v3/core/users/', {
    params: { search, ordering, page, page_size: pageSize, ...extraParams },
  });
  return data;
});

export const listUsersByGroupPk = wrap(
  (groupPk) => `Failed to list users in group ${groupPk}`,
  async (groupPk, pageSize = 500) => {
    // Authentik supports filtering users by group PK. Fetch up to pageSize
    // members in one round-trip (groups rarely exceed this in practice).
    const { data } = await client.get('/api/v3/core/users/', {
      params: { groups_by_pk: groupPk, page_size: pageSize },
    });
    return data.results || [];
  }
);

export const getUser = wrap((id) => `Failed to get user ${id}`, async (id) => {
  const { data } = await client.get(`/api/v3/core/users/${id}/`);
  return data;
});

export const getUserByUuid = wrap(
  (uuid) => `Failed to get user by uuid ${uuid}`,
  async (uuid) => {
    const { data } = await client.get('/api/v3/core/users/', { params: { uuid } });
    return data?.results?.[0] ?? null;
  }
);

export const createUser = wrap('Failed to create user', async ({ username, name, email, groups }) => {
  const { data } = await client.post('/api/v3/core/users/', {
    username,
    name,
    email,
    groups: groups || [],
  });
  return data;
});

export const updateUser = wrap(
  (id) => `Failed to update user ${id}`,
  async (id, { name, email, is_active }) => {
    const payload = {};
    if (name !== undefined) payload.name = name;
    if (email !== undefined) payload.email = email;
    if (is_active !== undefined) payload.is_active = is_active;
    const { data } = await client.patch(`/api/v3/core/users/${id}/`, payload);
    return data;
  }
);

export const deleteUser = wrap((id) => `Failed to delete user ${id}`, async (id) => {
  await client.delete(`/api/v3/core/users/${id}/`);
});

export const setPassword = wrap(
  (id) => `Failed to set password for user ${id}`,
  async (id, password) => {
    await client.post(`/api/v3/core/users/${id}/set_password/`, { password });
  }
);

export const recoveryLink = wrap(
  (id) => `Failed to generate recovery link for user ${id}`,
  async (id) => {
    const { data } = await client.post(`/api/v3/core/users/${id}/recovery/`);
    // Replace internal URL with public-facing Authentik URL
    const externalUrl = process.env.AUTHENTIK_EXTERNAL_URL;
    if (externalUrl && data.link) {
      data.link = data.link.replace(baseURL, externalUrl);
    }
    return data;
  }
);

// ── Applications ───────────────────────────────────────

export const listApplications = wrap('Failed to list applications', async () => {
  const { data } = await client.get('/api/v3/core/applications/');
  return data;
});

export const getApplication = wrap(
  (slug) => `Failed to get application ${slug}`,
  async (slug) => {
    const { data } = await client.get(`/api/v3/core/applications/${slug}/`);
    return data;
  }
);

// ── Groups ─────────────────────────────────────────────

export const listGroups = wrap('Failed to list groups', async () => {
  const { data } = await client.get('/api/v3/core/groups/');
  return data;
});

export const findGroupByName = wrap(
  (name) => `Failed to find group ${name}`,
  async (name) => {
    const { data } = await client.get('/api/v3/core/groups/', { params: { name } });
    return (data.results || []).find((g) => g.name === name) || null;
  }
);

export async function ensureGroup(name) {
  const existing = await findGroupByName(name);
  if (existing) return existing;
  return await createGroup(name);
}

export const getGroup = wrap((id) => `Failed to get group ${id}`, async (id) => {
  const { data } = await client.get(`/api/v3/core/groups/${id}/`);
  return data;
});

export const createGroup = wrap('Failed to create group', async (name) => {
  const { data } = await client.post('/api/v3/core/groups/', { name });
  return data;
});

export const updateGroup = wrap(
  (id) => `Failed to update group ${id}`,
  async (id, { name, users }) => {
    const payload = {};
    if (name !== undefined) payload.name = name;
    if (users !== undefined) payload.users = users;
    const { data } = await client.patch(`/api/v3/core/groups/${id}/`, payload);
    return data;
  }
);

export const deleteGroup = wrap((id) => `Failed to delete group ${id}`, async (id) => {
  await client.delete(`/api/v3/core/groups/${id}/`);
});

export const setUserGroups = wrap(
  (userId) => `Failed to set groups for user ${userId}`,
  async (userId, groupPks) => {
    const { data } = await client.patch(`/api/v3/core/users/${userId}/`, { groups: groupPks });
    return data;
  }
);

export const addUserToGroup = wrap(
  (groupId, userId) => `Failed to add user ${userId} to group ${groupId}`,
  async (groupId, userId) => {
    await client.post(`/api/v3/core/groups/${groupId}/add_user/`, { pk: userId });
  }
);

export const removeUserFromGroup = wrap(
  (groupId, userId) => `Failed to remove user ${userId} from group ${groupId}`,
  async (groupId, userId) => {
    await client.post(`/api/v3/core/groups/${groupId}/remove_user/`, { pk: userId });
  }
);

// ── Policy Bindings ────────────────────────────────────

export const listPolicyBindings = wrap(
  (appSlug) => `Failed to list policy bindings for ${appSlug}`,
  async (appSlug) => {
    const app = await getApplication(appSlug);
    const { data } = await client.get('/api/v3/policies/bindings/', {
      params: { target: app.pk },
    });
    return data;
  }
);

// ── Proxy Providers & Applications ────────────────────

export const findProxyProvider = wrap(
  (name) => `Failed to find proxy provider ${name}`,
  async (name) => {
    const { data } = await client.get('/api/v3/providers/proxy/', { params: { name } });
    return (data.results || []).find((p) => p.name === name) || null;
  }
);

export const createProxyProvider = wrap(
  (slug) => `Failed to create proxy provider for ${slug}`,
  async (slug, { authorizationFlow, invalidationFlow, cookieDomain, externalHost }) => {
    const { data } = await client.post('/api/v3/providers/proxy/', {
      name: `${slug}-forward-auth`,
      mode: 'forward_domain',
      external_host: externalHost || `https://${slug}.{{DOMAIN}}`,
      authorization_flow: authorizationFlow,
      invalidation_flow: invalidationFlow,
      cookie_domain: cookieDomain,
    });
    return data;
  }
);

export const createApplication = wrap(
  (slug) => `Failed to create application ${slug}`,
  async (slug, providerPk) => {
    const { data } = await client.post('/api/v3/core/applications/', {
      name: slug,
      slug,
      provider: providerPk,
      meta_launch_url: `https://${slug}.{{DOMAIN}}`,
    });
    return data;
  }
);

export const getOutpost = wrap((pk) => `Failed to get outpost ${pk}`, async (pk) => {
  const { data } = await client.get(`/api/v3/outposts/instances/${pk}/`);
  return data;
});

export const updateOutpostProviders = wrap(
  (pk) => `Failed to update outpost ${pk}`,
  async (pk, providerPks) => {
    const { data } = await client.patch(`/api/v3/outposts/instances/${pk}/`, {
      providers: providerPks,
    });
    return data;
  }
);

// ── Policy Bindings ────────────────────────────────────

export const listPolicyBindingsForApp = wrap(
  (appPk) => `Failed to list bindings for app ${appPk}`,
  async (appPk) => {
    const { data } = await client.get('/api/v3/policies/bindings/', { params: { target: appPk } });
    return data.results || [];
  }
);

export async function ensureGroupBinding(appPk, groupPk) {
  try {
    const bindings = await listPolicyBindingsForApp(appPk);
    if (bindings.some((b) => b.group === groupPk)) return;
    await client.post('/api/v3/policies/bindings/', {
      target: appPk,
      group: groupPk,
      enabled: true,
      order: 0,
    });
  } catch (err) {
    throw apiError('Failed to ensure group binding', err);
  }
}

export const findExpressionPolicy = wrap(
  (name) => `Failed to find expression policy ${name}`,
  async (name) => {
    const { data } = await client.get('/api/v3/policies/expression/', { params: { name } });
    return (data.results || []).find((p) => p.name === name) || null;
  }
);

export const deletePolicyBinding = wrap(
  (pk) => `Failed to delete policy binding ${pk}`,
  async (pk) => {
    await client.delete(`/api/v3/policies/bindings/${pk}/`);
  }
);

export const deleteExpressionPolicy = wrap(
  (pk) => `Failed to delete expression policy ${pk}`,
  async (pk) => {
    await client.delete(`/api/v3/policies/expression/${pk}/`);
  }
);

// ── Authenticator Devices (MFA) ────────────────────────

// Authentik's device URLs are split by type. The /admin/all/ endpoint returns
// a heterogeneous list; we normalize `meta_model_name` (e.g. `authentik_stages_
// authenticator_totp.totpdevice`) down to the URL fragment (`totp`).
export const DEVICE_KINDS = ['totp', 'static', 'webauthn', 'duo', 'sms', 'email', 'endpoint'];

export function deviceKindFromModel(modelName) {
  if (!modelName || typeof modelName !== 'string') return null;
  const tail = modelName.split('.').pop() || '';
  const m = tail.match(/^([a-z]+)device$/);
  if (!m) return null;
  return DEVICE_KINDS.includes(m[1]) ? m[1] : null;
}

export const listUserDevices = wrap(
  (userId) => `Failed to list devices for user ${userId}`,
  async (userId) => {
    const { data } = await client.get('/api/v3/authenticators/admin/all/', {
      params: { user: userId },
    });
    return Array.isArray(data) ? data : [];
  }
);

export const deleteDevice = wrap(
  (kind, pk) => `Failed to delete ${kind} device ${pk}`,
  async (kind, pk) => {
    if (!DEVICE_KINDS.includes(kind)) {
      const err = new Error(`Unknown device kind: ${kind}`);
      err.status = 400;
      throw err;
    }
    await client.delete(`/api/v3/authenticators/admin/${kind}/${encodeURIComponent(pk)}/`);
  }
);

// ── Authenticated Sessions ─────────────────────────────

export const listUserSessions = wrap(
  (userId) => `Failed to list sessions for user ${userId}`,
  async (userId) => {
    const { data } = await client.get('/api/v3/core/authenticated_sessions/', {
      params: { user: userId, page_size: 100 },
    });
    return data?.results || [];
  }
);

export const deleteSession = wrap(
  (uuid) => `Failed to delete session ${uuid}`,
  async (uuid) => {
    await client.delete(`/api/v3/core/authenticated_sessions/${encodeURIComponent(uuid)}/`);
  }
);

// ── Helpers ────────────────────────────────────────────

function apiError(message, err) {
  const status = err.response?.status || 502;
  const responseData = err.response?.data;
  const detail = responseData?.detail || responseData || err.message;

  // Format Authentik field-level validation errors (e.g. { username: ['This field must be unique.'] })
  // into a readable message so it surfaces in the UI instead of the generic fallback.
  let userMessage = message;
  if (
    responseData &&
    typeof responseData === 'object' &&
    !Array.isArray(responseData) &&
    !responseData.detail
  ) {
    const fieldErrors = Object.entries(responseData)
      .flatMap(([field, errors]) =>
        Array.isArray(errors) ? errors.map((e) => `${field}: ${e}`) : [`${field}: ${errors}`]
      )
      .join('; ');
    if (fieldErrors) userMessage = fieldErrors;
  }

  const error = new Error(userMessage);
  error.status = status;
  error.detail = detail;
  return error;
}
