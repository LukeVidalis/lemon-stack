import { Router } from 'express';
import axios from 'axios';
import { getApp } from '../app-registry.js';
import * as audit from '../lib/audit.js';

const router = Router();
const secret = () => process.env.ADMIN_API_SECRET;

function requireApp(req, res) {
  const app = getApp(req.params.appSlug);
  if (!app) {
    res.status(404).json({
      error: `App "${req.params.appSlug}" is not registered in the admin API registry. Add it to src/config/apps.json.`,
    });
    return null;
  }
  return app;
}

function headers() {
  return { 'X-Admin-Secret': secret() };
}

// List all permissions for an app
router.get('/:appSlug', async (req, res, next) => {
  try {
    const app = requireApp(req, res);
    if (!app) return;

    const { data } = await axios.get(`${app.baseUrl}/admin/permissions`, {
      headers: headers(),
      timeout: 10000,
    });
    res.json(data);
  } catch (err) {
    next(proxyError(err, req.params.appSlug));
  }
});

// Get permissions for specific user
router.get('/:appSlug/:userSub', async (req, res, next) => {
  try {
    const app = requireApp(req, res);
    if (!app) return;

    const { data } = await axios.get(
      `${app.baseUrl}/admin/permissions/${req.params.userSub}`,
      { headers: headers(), timeout: 10000 }
    );
    res.json(data);
  } catch (err) {
    next(proxyError(err, req.params.appSlug));
  }
});

// Set permissions for user
router.put('/:appSlug/:userSub', async (req, res, next) => {
  try {
    const app = requireApp(req, res);
    if (!app) return;

    const { data } = await axios.put(
      `${app.baseUrl}/admin/permissions/${req.params.userSub}`,
      req.body,
      { headers: headers(), timeout: 10000 }
    );
    res.json(data);
    audit.logFromReq(req, {
      action: 'app.permissions.set',
      target_type: 'user',
      target: req.params.userSub,
      detail: { app: req.params.appSlug, permissions: req.body },
    });
  } catch (err) {
    next(proxyError(err, req.params.appSlug));
  }
});

// Remove permissions for user
router.delete('/:appSlug/:userSub', async (req, res, next) => {
  try {
    const app = requireApp(req, res);
    if (!app) return;

    await axios.delete(
      `${app.baseUrl}/admin/permissions/${req.params.userSub}`,
      { headers: headers(), timeout: 10000 }
    );
    res.status(204).end();
    audit.logFromReq(req, {
      action: 'app.permissions.clear',
      target_type: 'user',
      target: req.params.userSub,
      detail: { app: req.params.appSlug },
    });
  } catch (err) {
    next(proxyError(err, req.params.appSlug));
  }
});

function proxyError(err, appSlug) {
  const status = err.response?.status || 502;
  const detail = err.response?.data || err.message;
  const error = new Error(`Upstream error from app "${appSlug}"`);
  error.status = status;
  error.detail = detail;
  return error;
}

export default router;
