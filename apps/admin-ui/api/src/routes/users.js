import { Router } from 'express';
import axios from 'axios';
import crypto from 'crypto';
import * as authentik from '../authentik.js';
import * as resend from '../resend.js';
import { getApps } from '../app-registry.js';
import { getProjects } from './projects.js';
import * as groupCache from '../lib/groupCache.js';
import * as audit from '../lib/audit.js';

const router = Router();

function normalizeUser(user, groupMap) {
  const groups = (user.groups || []).map((pk) => groupMap[pk]?.name || pk);
  return {
    id: user.pk,
    username: user.username,
    name: user.name,
    email: user.email,
    uid: user.uid,
    groups,
    group_ids: user.groups || [],
    last_login: user.last_login,
    is_active: user.is_active,
    password_change_date: user.password_change_date || null,
  };
}

router.get('/', async (req, res, next) => {
  try {
    const {
      search,
      ordering = 'username',
      page = 1,
      page_size = 20,
      group,
      is_active,
      never_logged_in,
    } = req.query;

    const pageSize = Math.min(Number(page_size) || 20, 200);
    const extra = {};
    if (is_active === 'true') extra.is_active = true;
    if (is_active === 'false') extra.is_active = false;
    if (group) extra.groups_by_name = group;

    const data = await authentik.listUsers(search, ordering, Number(page), pageSize, extra);
    const groupMap = await groupCache.getGroupMap();
    let results = (data.results || []).map((u) => normalizeUser(u, groupMap));
    if (never_logged_in === 'true') results = results.filter((u) => !u.last_login);

    const pagination = data.pagination || {};
    const total = pagination.count ?? results.length;
    res.json({
      users: results,
      total,
      page: Number(page),
      page_size: pageSize,
      total_pages: Math.max(1, Math.ceil(total / pageSize)),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const data = await authentik.getUser(Number(req.params.id));
    const groupMap = await groupCache.getGroupMap();
    res.json(normalizeUser(data, groupMap));
  } catch (err) {
    next(err);
  }
});

function deriveUsername(email) {
  const local = String(email || '').split('@')[0] || 'user';
  const cleaned = local
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '.')
    .replace(/\.+/g, '.')
    .replace(/^[.\-_]+|[.\-_]+$/g, '');
  return cleaned || 'user';
}

async function createUserWithUniqueUsername({ baseUsername, name, email, groups }) {
  let candidate = baseUsername;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await authentik.createUser({ username: candidate, name, email, groups });
    } catch (err) {
      const status = err?.response?.status;
      const body = err?.response?.data;
      const usernameTaken =
        status === 400 &&
        body &&
        (body.username || (typeof body === 'string' && body.includes('username')));
      if (!usernameTaken) throw err;
      candidate = `${baseUsername}.${crypto.randomBytes(2).toString('hex')}`;
    }
  }
  throw new Error('Could not allocate a unique username');
}

router.post('/', async (req, res, next) => {
  try {
    const { username, name, email, groups: groupNames, send_recovery, send_email } = req.body;
    if (!email || !String(email).trim()) {
      return res.status(400).json({ error: 'Email is required' });
    }
    const generatePassword = send_recovery !== false;

    let groupPks = [];
    if (groupNames && groupNames.length > 0) {
      const groupMap = await groupCache.getGroupMap();
      const nameToGroup = Object.fromEntries(Object.values(groupMap).map((g) => [g.name, g]));
      groupPks = groupNames.map((n) => nameToGroup[n]?.pk).filter(Boolean);
    }

    let password;
    if (generatePassword) {
      password = crypto.randomBytes(16).toString('base64url');
    }

    const baseUsername = username?.trim() || deriveUsername(email);
    const resolvedName = name?.trim() || baseUsername;
    const user = await createUserWithUniqueUsername({
      baseUsername,
      name: resolvedName,
      email: String(email).trim(),
      groups: groupPks,
    });
    groupCache.invalidate();

    const groupMap = await groupCache.getGroupMap();
    const result = { user: normalizeUser(user, groupMap) };

    if (generatePassword) {
      await authentik.setPassword(user.pk, password);
      try {
        const recovery = await authentik.recoveryLink(user.pk);
        result.recovery_link = recovery.link;
      } catch {
        result.recovery_link = null;
        result.temporary_password = password;
      }
    }

    if (send_email && result.recovery_link) {
      try {
        await resend.sendInviteEmail({ to: email, name: name || username, recoveryLink: result.recovery_link });
        result.email_sent = true;
      } catch {
        result.email_sent = false;
      }
    }

    res.status(201).json(result);
    audit.logFromReq(req, {
      action: 'user.create',
      target_type: 'user',
      target: user.username,
      detail: { id: user.pk, email, groups: groupNames, send_email: !!send_email },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/recovery', async (req, res, next) => {
  try {
    const { send_email } = req.body || {};
    const userId = Number(req.params.id);
    const recovery = await authentik.recoveryLink(userId);
    const result = { recovery_link: recovery.link || null };

    if (send_email && result.recovery_link) {
      try {
        const user = await authentik.getUser(userId);
        await resend.sendInviteEmail({ to: user.email, name: user.name || user.username, recoveryLink: result.recovery_link });
        result.email_sent = true;
      } catch {
        result.email_sent = false;
      }
    }

    res.json(result);
    audit.logFromReq(req, {
      action: 'user.recovery_link',
      target_type: 'user',
      target: String(userId),
      detail: { send_email: !!send_email },
    });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const { name, email, is_active } = req.body;
    const data = await authentik.updateUser(Number(req.params.id), { name, email, is_active });
    const groupMap = await groupCache.getGroupMap();
    res.json(normalizeUser(data, groupMap));
    audit.logFromReq(req, {
      action: 'user.update',
      target_type: 'user',
      target: data.username || String(req.params.id),
      detail: { id: data.pk, changes: { name, email, is_active } },
    });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const userId = Number(req.params.id);
    const user = await authentik.getUser(userId);
    const userSub = user.uid;

    const apps = getApps();
    const secret = process.env.ADMIN_API_SECRET;
    const cleanupResults = await Promise.allSettled(
      apps.map((app) =>
        axios.delete(`${app.baseUrl}/admin/permissions/${userSub}`, {
          headers: { 'X-Admin-Secret': secret },
          timeout: 3000,
        })
      )
    );

    for (const [i, result] of cleanupResults.entries()) {
      if (result.status === 'rejected' && result.reason?.response?.status !== 404) {
        req.log?.warn({ app: apps[i].slug, err: result.reason.message }, 'permission cleanup failed');
      }
    }

    await authentik.deleteUser(userId);
    groupCache.invalidate();
    res.status(204).end();
    audit.logFromReq(req, {
      action: 'user.delete',
      target_type: 'user',
      target: user.username || String(userId),
      detail: { id: userId, email: user.email },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/access', async (req, res, next) => {
  try {
    const userId = Number(req.params.id);
    const user = await authentik.getUser(userId);
    const userGroupIds = new Set(user.groups || []);

    const groupMap = await groupCache.getGroupMap();
    const groupByName = new Map();
    for (const g of Object.values(groupMap)) groupByName.set(g.name, g);

    const adminsGroup = groupByName.get('admins');
    const isAdmin = adminsGroup ? userGroupIds.has(adminsGroup.pk) : false;

    const projects = getProjects();
    const accessList = projects.map((project) => {
      const group = groupByName.get(`access-${project.slug}`);
      const restricted = !!group;
      const has_access = isAdmin || (restricted && userGroupIds.has(group.pk));
      return { slug: project.slug, name: project.name, icon: 'apps', has_access, restricted };
    });

    res.json(accessList);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/access/:slug', async (req, res, next) => {
  try {
    const userId = Number(req.params.id);
    const { slug } = req.params;
    const group = await authentik.ensureGroup(`access-${slug}`);
    await authentik.addUserToGroup(group.pk, userId);
    try {
      const app = await authentik.getApplication(slug);
      await authentik.ensureGroupBinding(app.pk, group.pk);
    } catch {
      // App may not be provisioned yet — setup handles it on next sync.
    }
    groupCache.invalidate();
    res.json({ ok: true });
    audit.logFromReq(req, {
      action: 'user.access.grant',
      target_type: 'user',
      target: String(userId),
      detail: { app: slug },
    });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/access/:slug', async (req, res, next) => {
  try {
    const userId = Number(req.params.id);
    const { slug } = req.params;
    const group = await authentik.findGroupByName(`access-${slug}`);
    if (group) {
      await authentik.removeUserFromGroup(group.pk, userId);
      groupCache.invalidate();
    }
    res.json({ ok: true });
    audit.logFromReq(req, {
      action: 'user.access.revoke',
      target_type: 'user',
      target: String(userId),
      detail: { app: slug },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/groups', async (req, res, next) => {
  try {
    const userId = Number(req.params.id);
    const { group: groupName } = req.body;
    const group = await groupCache.getGroupByName(groupName);
    if (!group) return res.status(404).json({ error: `Group "${groupName}" not found` });
    await authentik.addUserToGroup(group.pk, userId);
    groupCache.invalidate();
    res.json({ ok: true });
    audit.logFromReq(req, {
      action: 'user.group.add',
      target_type: 'user',
      target: String(userId),
      detail: { group: groupName },
    });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/groups/:groupName', async (req, res, next) => {
  try {
    const userId = Number(req.params.id);
    const groupName = decodeURIComponent(req.params.groupName);
    const group = await groupCache.getGroupByName(groupName);
    if (!group) return res.status(404).json({ error: `Group "${groupName}" not found` });
    await authentik.removeUserFromGroup(group.pk, userId);
    groupCache.invalidate();
    res.json({ ok: true });
    audit.logFromReq(req, {
      action: 'user.group.remove',
      target_type: 'user',
      target: String(userId),
      detail: { group: groupName },
    });
  } catch (err) {
    next(err);
  }
});

// Impersonation — gated by ENABLE_IMPERSONATION=true.
//
// Returns the Authentik impersonation start URL. The admin's browser then
// navigates there; Authentik validates that the calling session is in the
// `admins` group and performs the session swap server-side. Stopping
// impersonation is handled by Authentik at /-/impersonation/end/.
//
// We deliberately do NOT proxy the impersonation call from this API — the
// session cookie would belong to our service account, not the admin's
// browser, so it'd be a no-op for the user.
router.post('/:id/impersonate', async (req, res, next) => {
  try {
    if (process.env.ENABLE_IMPERSONATION !== 'true') {
      return res.status(403).json({ error: 'Impersonation is disabled' });
    }
    const userId = Number(req.params.id);
    if (!Number.isFinite(userId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    // Resolve the user so we log a meaningful target and fail early on 404.
    const target = await authentik.getUser(userId);
    const reason = (req.body?.reason || '').toString().slice(0, 256);

    const externalBase = process.env.AUTHENTIK_EXTERNAL_URL || 'https://auth.{{DOMAIN}}';
    const url = `${externalBase.replace(/\/$/, '')}/-/impersonation/${userId}/`;

    res.json({ url, target: { id: userId, username: target.username, name: target.name } });

    audit.logFromReq(req, {
      action: 'user.impersonate.start',
      target_type: 'user',
      target: target.username || String(userId),
      detail: { id: userId, reason: reason || null },
    });
  } catch (err) {
    next(err);
  }
});

// ── Authenticator devices (MFA) ────────────────────────

router.get('/:id/devices', async (req, res, next) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isFinite(userId)) return res.status(400).json({ error: 'Invalid user id' });
    const devices = await authentik.listUserDevices(userId);
    const normalized = devices.map((d) => ({
      pk: d.pk,
      name: d.name,
      kind: authentik.deviceKindFromModel(d.meta_model_name || d.type),
      type: d.type,
      verbose_name: d.verbose_name,
      confirmed: d.confirmed,
      created: d.created,
      last_updated: d.last_updated,
      last_used: d.last_used,
    }));
    res.json(normalized);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/devices/:kind/:pk', async (req, res, next) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isFinite(userId)) return res.status(400).json({ error: 'Invalid user id' });
    const { kind, pk } = req.params;
    if (!authentik.DEVICE_KINDS.includes(kind)) {
      return res.status(400).json({ error: `Unknown device kind: ${kind}` });
    }
    await authentik.deleteDevice(kind, pk);
    res.status(204).end();
    audit.logFromReq(req, {
      action: 'user.device.delete',
      target_type: 'user',
      target: String(userId),
      detail: { kind, pk },
    });
  } catch (err) {
    next(err);
  }
});

// ── Authenticated sessions ─────────────────────────────

router.get('/:id/sessions', async (req, res, next) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isFinite(userId)) return res.status(400).json({ error: 'Invalid user id' });
    const sessions = await authentik.listUserSessions(userId);
    const normalized = sessions.map((s) => ({
      uuid: s.uuid,
      current: s.current,
      last_ip: s.last_ip,
      last_used: s.last_used,
      expires: s.expires,
      user_agent: s.user_agent?.user_agent
        ? `${s.user_agent.user_agent.family || ''} ${s.user_agent.user_agent.major || ''}`.trim()
        : s.last_user_agent || null,
      os: s.user_agent?.os?.family || null,
      device: s.user_agent?.device?.family || null,
      geo: s.geo_ip
        ? [s.geo_ip.city, s.geo_ip.country].filter(Boolean).join(', ')
        : null,
    }));
    res.json(normalized);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/sessions/:uuid', async (req, res, next) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isFinite(userId)) return res.status(400).json({ error: 'Invalid user id' });
    const { uuid } = req.params;
    await authentik.deleteSession(uuid);
    res.status(204).end();
    audit.logFromReq(req, {
      action: 'user.session.revoke',
      target_type: 'user',
      target: String(userId),
      detail: { uuid },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
