import { Router } from 'express';
import * as authentik from '../authentik.js';
import { getApp } from '../app-registry.js';

const router = Router();

// List all Authentik applications
router.get('/', async (req, res, next) => {
  try {
    const data = await authentik.listApplications();
    const results = (data.results || []).map((app) => ({
      slug: app.slug,
      name: app.name,
      icon: app.meta_icon || 'apps',
      admin_api: !!getApp(app.slug),
    }));
    res.json(results);
  } catch (err) {
    next(err);
  }
});

// Get single application
router.get('/:slug', async (req, res, next) => {
  try {
    const app = await authentik.getApplication(req.params.slug);
    res.json({
      slug: app.slug,
      name: app.name,
      icon: app.meta_icon || 'apps',
      admin_api: !!getApp(app.slug),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
