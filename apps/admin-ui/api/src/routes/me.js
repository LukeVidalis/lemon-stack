import { Router } from 'express';

const router = Router();

router.get('/', (req, res) => {
  // Auth middleware has already populated req.actor from the verified
  // x-authentik-* headers; just echo it back.
  const a = req.actor || {};
  res.json({
    username: a.username || null,
    name: a.name || a.username || null,
    email: a.email || null,
    groups: a.groups || [],
    uid: a.uid || null,
    features: {
      impersonation: process.env.ENABLE_IMPERSONATION === 'true',
      audit: !!process.env.DATABASE_URL,
    },
  });
});

export default router;
