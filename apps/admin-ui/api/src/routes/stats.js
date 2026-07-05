import { Router } from 'express';
import * as authentik from '../authentik.js';
import * as groupCache from '../lib/groupCache.js';
import * as audit from '../lib/audit.js';
import { getApps } from '../app-registry.js';
import { getProjects } from './projects.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const [userPage, groupList] = await Promise.all([
      authentik.listUsers(undefined, 'username', 1, 1, {}),
      groupCache.getGroupList(),
    ]);

    const totalUsers = userPage.pagination?.count ?? userPage.results?.length ?? 0;

    // Active vs disabled — Authentik supports filtering server-side, do two
    // cheap probes that just need the count from pagination.
    let activeUsers = totalUsers;
    let disabledUsers = 0;
    try {
      const disabledPage = await authentik.listUsers(undefined, 'username', 1, 1, {
        is_active: false,
      });
      disabledUsers = disabledPage.pagination?.count ?? 0;
      activeUsers = Math.max(totalUsers - disabledUsers, 0);
    } catch {
      // ignore — fall back to totals only
    }

    let neverLoggedIn = 0;
    try {
      // Use a small page and count results that have no last_login.
      const probe = await authentik.listUsers(undefined, 'last_login', 1, 200, {});
      neverLoggedIn = (probe.results || []).filter((u) => !u.last_login).length;
    } catch {
      // ignore
    }

    const projects = getProjects();
    const apps = getApps();

    let recentActivity = [];
    if (audit.isEnabled()) {
      try {
        recentActivity = await audit.recent(10);
      } catch (err) {
        req.log?.warn({ err: err.message }, 'recent audit fetch failed');
      }
    }

    res.json({
      users: {
        total: totalUsers,
        active: activeUsers,
        disabled: disabledUsers,
        never_logged_in: neverLoggedIn,
      },
      groups: { total: groupList.length },
      projects: { total: projects.length },
      apps: { admin_api: apps.length },
      audit_enabled: audit.isEnabled(),
      recent_activity: recentActivity,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
