import { Router } from 'express';
import { timingSafeEqual } from 'crypto';
import { getUserByUuid, listApplications } from '../authentik.js';

const router = Router();

function checkSecret(req, res) {
  const expected = process.env.INTERNAL_SUMMARY_SECRET;
  if (!expected) {
    res.status(503).json({ error: 'INTERNAL_SUMMARY_SECRET is not configured.' });
    return false;
  }
  const supplied = req.headers['x-internal-secret'] || '';
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

router.get('/user-summary', async (req, res) => {
  if (!checkSecret(req, res)) return;

  const { uid } = req.query;
  if (!uid) return res.status(400).json({ error: 'uid query param required' });

  try {
    const [user, apps] = await Promise.all([
      getUserByUuid(uid).catch(() => null),
      listApplications().catch(() => []),
    ]);

    const userGroups = user?.groups_obj?.map(g => g.name) ?? [];
    const appCount = Array.isArray(apps) ? apps.length : 0;

    const metrics = [
      { label: 'Apps', value: appCount, tone: 'info' },
      { label: 'Groups', value: userGroups.length, tone: 'info' },
    ];

    const items = userGroups.slice(0, 5).map(g => ({
      label: g,
      sub: 'member',
      tone: 'info',
    }));

    const primary = userGroups.length > 0
      ? `Member of: ${userGroups.join(', ')}`
      : 'No groups assigned';

    return res.json({
      uid,
      title: 'Admin',
      primary,
      items,
      metrics,
      deepLink: 'https://admin.{{DOMAIN}}/',
    });
  } catch (err) {
    console.error('user-summary error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
