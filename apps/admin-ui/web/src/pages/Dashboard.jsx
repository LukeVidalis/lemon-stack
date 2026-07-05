import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';

function StatCard({ icon, label, value, hint, to, accent = 'primary' }) {
  const accentMap = {
    primary: 'bg-primary-container text-on-primary-container',
    secondary: 'bg-secondary-container text-on-secondary-container',
    tertiary: 'bg-tertiary-container text-on-tertiary-container',
    error: 'bg-error-container text-on-error-container',
  };
  const body = (
    <div className="bg-surface-container-lowest border border-outline-variant/40 rounded-2xl p-5 h-full flex items-start gap-4 transition-shadow hover:shadow-md">
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${accentMap[accent]}`}>
        <span className="material-symbols-outlined text-[22px]">{icon}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs uppercase tracking-wide text-on-surface-variant">{label}</p>
        <p className="text-2xl font-semibold text-on-surface mt-0.5">
          {value === null || value === undefined ? '—' : value}
        </p>
        {hint ? <p className="text-xs text-on-surface-variant mt-1">{hint}</p> : null}
      </div>
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

function formatTimeAgo(ts) {
  if (!ts) return '';
  const then = new Date(ts).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Math.max(0, Date.now() - then);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function ActionBadge({ action }) {
  const verb = action.split('.')[0];
  const palette =
    verb === 'user'
      ? 'bg-primary-container text-on-primary-container'
      : verb === 'group'
      ? 'bg-tertiary-container text-on-tertiary-container'
      : verb === 'app'
      ? 'bg-secondary-container text-on-secondary-container'
      : 'bg-surface-container-high text-on-surface-variant';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${palette}`}>
      {action}
    </span>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get('/api/stats')
      .then((data) => {
        if (!cancelled) {
          setStats(data);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-heading font-bold text-on-surface">Dashboard</h1>
        <p className="text-sm text-on-surface-variant mt-1">Overview of users, groups, and recent admin activity.</p>
      </div>

      {error ? (
        <div className="bg-error-container text-on-error-container px-4 py-3 rounded-xl text-sm">
          Failed to load stats: {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon="people"
          label="Total users"
          value={loading ? '…' : stats?.users?.total ?? 0}
          to="/users"
          accent="primary"
        />
        <StatCard
          icon="check_circle"
          label="Active"
          value={loading ? '…' : stats?.users?.active ?? 0}
          accent="tertiary"
        />
        <StatCard
          icon="block"
          label="Disabled"
          value={loading ? '…' : stats?.users?.disabled ?? 0}
          accent="error"
        />
        <StatCard
          icon="hourglass_empty"
          label="Never logged in"
          value={loading ? '…' : stats?.users?.never_logged_in ?? 0}
          hint="Sampled from first 200"
          accent="secondary"
        />
        <StatCard
          icon="group"
          label="Groups"
          value={loading ? '…' : stats?.groups?.total ?? 0}
          to="/groups"
          accent="tertiary"
        />
        <StatCard
          icon="apps"
          label="Projects"
          value={loading ? '…' : stats?.projects?.total ?? 0}
          accent="secondary"
        />
        <StatCard
          icon="extension"
          label="Apps with admin API"
          value={loading ? '…' : stats?.apps?.admin_api ?? 0}
          accent="primary"
        />
        <StatCard
          icon="history"
          label="Audit log"
          value={loading ? '…' : stats?.audit_enabled ? 'Enabled' : 'Disabled'}
          to={stats?.audit_enabled ? '/audit' : undefined}
          accent={stats?.audit_enabled ? 'tertiary' : 'error'}
        />
      </div>

      <section className="bg-surface-container-lowest border border-outline-variant/40 rounded-2xl">
        <header className="flex items-center justify-between px-5 py-4 border-b border-outline-variant/40">
          <div>
            <h2 className="text-lg font-semibold text-on-surface">Recent activity</h2>
            <p className="text-xs text-on-surface-variant">Last 10 audited admin actions.</p>
          </div>
          {stats?.audit_enabled ? (
            <Link
              to="/audit"
              className="text-sm text-primary hover:underline flex items-center gap-1"
            >
              View all
              <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
            </Link>
          ) : null}
        </header>

        <div className="divide-y divide-outline-variant/30">
          {loading ? (
            <div className="px-5 py-8 text-sm text-on-surface-variant">Loading…</div>
          ) : !stats?.audit_enabled ? (
            <div className="px-5 py-8 text-sm text-on-surface-variant">
              Audit logging is not configured. Set <code className="font-mono">DATABASE_URL</code> on the API and restart.
            </div>
          ) : !stats?.recent_activity?.length ? (
            <div className="px-5 py-8 text-sm text-on-surface-variant">No recent activity yet.</div>
          ) : (
            stats.recent_activity.map((e) => (
              <div key={e.id} className="px-5 py-3 flex items-center gap-4 text-sm">
                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: e.success ? '#22c55e' : '#ef4444' }} />
                <ActionBadge action={e.action} />
                <span className="text-on-surface truncate flex-1">
                  <span className="font-medium">{e.actor}</span>
                  {e.target ? <> → <span className="text-on-surface-variant">{e.target}</span></> : null}
                </span>
                <span className="text-xs text-on-surface-variant flex-shrink-0" title={e.ts}>
                  {formatTimeAgo(e.ts)}
                </span>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
