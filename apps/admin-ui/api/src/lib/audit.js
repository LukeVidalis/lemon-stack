// Append-only audit log backed by postgres-shared.
//
// Graceful degradation: if DATABASE_URL is unset (e.g. local dev without
// postgres), every export becomes a no-op so routes still work. Failures
// during logging are swallowed and warned — auditing must never break an
// admin action that already succeeded against Authentik.

import pg from 'pg';

const { Pool } = pg;

let pool = null;
let initPromise = null;

function getPool() {
  if (pool) return pool;
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  pool = new Pool({
    connectionString: url,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  pool.on('error', (err) => {
    console.error('[audit] pool error:', err.message);
  });
  return pool;
}

async function ensureSchema() {
  const p = getPool();
  if (!p) return;
  await p.query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id          bigserial PRIMARY KEY,
      ts          timestamptz NOT NULL DEFAULT now(),
      actor       text        NOT NULL,
      action      text        NOT NULL,
      target_type text,
      target      text,
      success     boolean     NOT NULL DEFAULT true,
      detail      jsonb
    );
    CREATE INDEX IF NOT EXISTS audit_log_ts_idx     ON audit_log (ts DESC);
    CREATE INDEX IF NOT EXISTS audit_log_actor_idx  ON audit_log (actor);
    CREATE INDEX IF NOT EXISTS audit_log_action_idx ON audit_log (action);
    CREATE INDEX IF NOT EXISTS audit_log_target_idx ON audit_log (target);
  `);
}

export function init() {
  if (!getPool()) {
    console.warn('[audit] DATABASE_URL not set; audit logging disabled');
    return Promise.resolve();
  }
  if (!initPromise) {
    initPromise = ensureSchema().catch((err) => {
      console.error('[audit] schema init failed:', err.message);
      initPromise = null;
    });
  }
  return initPromise;
}

export function isEnabled() {
  return !!process.env.DATABASE_URL;
}

// Fire-and-forget. Never throws.
export function log({ actor, action, target_type, target, success = true, detail }) {
  const p = getPool();
  if (!p) return;
  // Best-effort wait for schema; if it failed we still attempt the insert and
  // the error is swallowed below.
  Promise.resolve(initPromise || init())
    .then(() =>
      p.query(
        `INSERT INTO audit_log (actor, action, target_type, target, success, detail)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          actor || 'unknown',
          action,
          target_type || null,
          target == null ? null : String(target),
          success,
          detail ? JSON.stringify(detail) : null,
        ]
      )
    )
    .catch((err) => {
      console.warn('[audit] insert failed:', err.message);
    });
}

// Convenience wrapper: pull actor from req.user (set by requireAdmin).
export function logFromReq(req, fields) {
  const actor =
    req.actor?.username ||
    req.actor?.email ||
    req.headers?.['x-authentik-username'] ||
    'unknown';
  log({ actor, ...fields });
}

export async function query({
  actor,
  action,
  target,
  success,
  since,
  until,
  limit = 50,
  offset = 0,
} = {}) {
  const p = getPool();
  if (!p) return { entries: [], total: 0 };

  const where = [];
  const params = [];
  function add(clause, value) {
    params.push(value);
    where.push(clause.replace('?', `$${params.length}`));
  }
  if (actor) add('actor = ?', actor);
  if (action) add('action = ?', action);
  if (target) add('target = ?', target);
  if (success === true || success === false) add('success = ?', success);
  if (since) add('ts >= ?', since);
  if (until) add('ts <= ?', until);

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const cappedLimit = Math.min(Math.max(Number(limit) || 50, 1), 500);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  const [rows, count] = await Promise.all([
    p.query(
      `SELECT id, ts, actor, action, target_type, target, success, detail
       FROM audit_log ${whereSql}
       ORDER BY ts DESC, id DESC
       LIMIT ${cappedLimit} OFFSET ${safeOffset}`,
      params
    ),
    p.query(`SELECT count(*)::int AS n FROM audit_log ${whereSql}`, params),
  ]);

  return { entries: rows.rows, total: count.rows[0].n };
}

export async function recent(limit = 10) {
  const p = getPool();
  if (!p) return [];
  const { rows } = await p.query(
    `SELECT id, ts, actor, action, target_type, target, success, detail
     FROM audit_log
     ORDER BY ts DESC, id DESC
     LIMIT $1`,
    [Math.min(Math.max(Number(limit) || 10, 1), 100)]
  );
  return rows;
}
