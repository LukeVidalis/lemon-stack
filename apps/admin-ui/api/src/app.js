import express from 'express';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';

import meRoutes from './routes/me.js';
import userRoutes from './routes/users.js';
import appRoutes from './routes/apps.js';
import groupRoutes from './routes/groups.js';
import permissionRoutes from './routes/permissions.js';
import projectRoutes from './routes/projects.js';
import internalRoutes from './routes/internal.js';
import auditRoutes from './routes/audit.js';
import statsRoutes from './routes/stats.js';
import { requireAdmin } from './middleware/auth.js';
import { httpLogger } from './middleware/logging.js';
import * as authentik from './authentik.js';

// Build the express app. Exported so tests can mount routes without binding
// a port. Side-effect free aside from in-memory readiness cache.
export function createApp({ logger = true } = {}) {
  const app = express();

  // Caddy runs on the same host (loopback only), so trust only the local hop.
  app.set('trust proxy', 'loopback');

  if (logger) app.use(httpLogger);
  app.use(compression());

  // UI is same-origin via Caddy. Only allow the admin host explicitly.
  const ALLOWED_ORIGIN = process.env.ADMIN_ORIGIN || 'https://admin.{{DOMAIN}}';
  app.use(cors({ origin: ALLOWED_ORIGIN, credentials: true }));

  app.use(express.json({ limit: '64kb' }));

  // Coarse rate limit. Admin traffic is low; this just stops a runaway client
  // or compromised credential from flooding Authentik. Disabled in tests so a
  // single suite doesn't accidentally exhaust the bucket.
  if (process.env.NODE_ENV !== 'test') {
    const limiter = rateLimit({
      windowMs: 60_000,
      max: 300,
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req) => req.path === '/api/health' || req.path === '/api/ready',
    });
    app.use(limiter);
  }

  // ── Public / non-admin endpoints ────────────────────────
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Readiness: cheap Authentik probe, cached so we don't hammer it.
  let readyCache = { ok: false, at: 0 };
  const READY_TTL_MS = 5_000;
  app.get('/api/ready', async (_req, res) => {
    const now = Date.now();
    if (now - readyCache.at < READY_TTL_MS) {
      return res.status(readyCache.ok ? 200 : 503).json({ ready: readyCache.ok });
    }
    try {
      await authentik.findGroupByName('admins');
      readyCache = { ok: true, at: now };
      return res.json({ ready: true });
    } catch (err) {
      readyCache = { ok: false, at: now };
      return res.status(503).json({ ready: false, error: err.message });
    }
  });

  // Internal HMAC-secret endpoint (used by other services). Has its own auth.
  app.use('/api/_internal', internalRoutes);

  // ── Admin-only routes (defense in depth behind Caddy+Authentik) ─────
  app.use('/api', requireAdmin);
  app.use('/api/me', meRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/apps', appRoutes);
  app.use('/api/groups', groupRoutes);
  app.use('/api/permissions', permissionRoutes);
  app.use('/api/projects', projectRoutes);
  app.use('/api/audit', auditRoutes);
  app.use('/api/stats', statsRoutes);

  // ── Error handling ─────────────────────────────────────
  app.use((err, req, res, _next) => {
    const status = err.status || 500;
    req.log?.error({ err, status }, 'request failed');
    // Strip upstream detail in production to avoid leaking Authentik payloads.
    const body = { error: err.message };
    if (process.env.NODE_ENV !== 'production' && err.detail) {
      body.detail = err.detail;
    }
    res.status(status).json(body);
  });

  return app;
}
