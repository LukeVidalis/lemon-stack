import { Router } from 'express';
import * as authentik from '../authentik.js';
import * as groupCache from '../lib/groupCache.js';
import * as audit from '../lib/audit.js';

const router = Router();

router.get('/', async (_req, res, next) => {
  try {
    const list = await groupCache.getGroupList();
    res.json(
      list.map((g) => ({
        id: g.pk,
        name: g.name,
        member_count: g.users?.length || 0,
        is_superuser: g.is_superuser || false,
      }))
    );
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { name } = req.body;
    const data = await authentik.createGroup(name);
    groupCache.invalidate();
    res.status(201).json({ id: data.pk, name: data.name });
    audit.logFromReq(req, { action: 'group.create', target_type: 'group', target: data.name });
  } catch (err) {
    next(err);
  }
});

router.get('/:idOrName', async (req, res, next) => {
  try {
    const group = await resolveGroup(req.params.idOrName);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    res.json({ id: group.pk, name: group.name, member_count: group.users?.length || 0 });
  } catch (err) {
    next(err);
  }
});

// Bulk-fetch members in one call (was N+1).
router.get('/:idOrName/members', async (req, res, next) => {
  try {
    const group = await resolveGroup(req.params.idOrName);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    const users = await authentik.listUsersByGroupPk(group.pk);
    res.json(users.map((u) => ({ id: u.pk, username: u.username, name: u.name, email: u.email })));
  } catch (err) {
    next(err);
  }
});

router.patch('/:idOrName', async (req, res, next) => {
  try {
    const group = await resolveGroup(req.params.idOrName);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    const { name } = req.body;
    const data = await authentik.updateGroup(group.pk, { name });
    groupCache.invalidate();
    res.json({ id: data.pk, name: data.name });
    audit.logFromReq(req, {
      action: 'group.rename',
      target_type: 'group',
      target: data.name,
      detail: { from: group.name, to: data.name },
    });
  } catch (err) {
    next(err);
  }
});

router.delete('/:idOrName', async (req, res, next) => {
  try {
    const group = await resolveGroup(req.params.idOrName);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (group.name === 'admins' || group.name === 'authentik Admins') {
      return res.status(400).json({ error: `Refusing to delete protected group "${group.name}"` });
    }
    await authentik.deleteGroup(group.pk);
    groupCache.invalidate();
    res.status(204).end();
    audit.logFromReq(req, { action: 'group.delete', target_type: 'group', target: group.name });
  } catch (err) {
    next(err);
  }
});

router.post('/:idOrName/members/:userId', async (req, res, next) => {
  try {
    const group = await resolveGroup(req.params.idOrName);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    await authentik.addUserToGroup(group.pk, Number(req.params.userId));
    groupCache.invalidate();
    res.json({ ok: true });
    audit.logFromReq(req, {
      action: 'group.member.add',
      target_type: 'group',
      target: group.name,
      detail: { user_id: Number(req.params.userId) },
    });
  } catch (err) {
    next(err);
  }
});

router.delete('/:idOrName/members/:userId', async (req, res, next) => {
  try {
    const group = await resolveGroup(req.params.idOrName);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    await authentik.removeUserFromGroup(group.pk, Number(req.params.userId));
    groupCache.invalidate();
    res.json({ ok: true });
    audit.logFromReq(req, {
      action: 'group.member.remove',
      target_type: 'group',
      target: group.name,
      detail: { user_id: Number(req.params.userId) },
    });
  } catch (err) {
    next(err);
  }
});

async function resolveGroup(idOrName) {
  const decoded = decodeURIComponent(idOrName);
  const byName = await groupCache.getGroupByName(decoded);
  if (byName) return byName;
  try {
    return await authentik.getGroup(decoded);
  } catch {
    return null;
  }
}

export default router;
