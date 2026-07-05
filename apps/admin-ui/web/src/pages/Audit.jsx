import { Fragment, useCallback, useEffect, useState } from 'react';
import api from '../api';

const PAGE_SIZE = 50;

function formatTime(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
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

export default function Audit() {
  const [data, setData] = useState({ entries: [], total: 0, page: 1, total_pages: 1, enabled: true });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ actor: '', action: '', target: '', success: '' });
  const [expanded, setExpanded] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
      if (filters.actor) params.set('actor', filters.actor);
      if (filters.action) params.set('action', filters.action);
      if (filters.target) params.set('target', filters.target);
      if (filters.success) params.set('success', filters.success);
      const res = await api.get(`/api/audit?${params}`);
      setData(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, filters]);

  useEffect(() => {
    load();
  }, [load]);

  function updateFilter(key, value) {
    setPage(1);
    setFilters((f) => ({ ...f, [key]: value }));
  }

  function clearFilters() {
    setPage(1);
    setFilters({ actor: '', action: '', target: '', success: '' });
  }

  if (data?.enabled === false) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-heading font-bold text-on-surface">Audit log</h1>
        <div className="bg-surface-container-lowest border border-outline-variant/40 rounded-2xl p-8 text-sm text-on-surface-variant">
          Audit logging is not configured. Set <code className="font-mono">DATABASE_URL</code> on the
          API container (it should point at <code className="font-mono">postgres-shared</code>) and
          restart.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-heading font-bold text-on-surface">Audit log</h1>
          <p className="text-sm text-on-surface-variant mt-1">
            {loading ? 'Loading…' : `${data.total} entries`}
          </p>
        </div>
        <button
          onClick={clearFilters}
          className="text-sm text-primary hover:underline flex items-center gap-1"
        >
          <span className="material-symbols-outlined text-[16px]">filter_alt_off</span>
          Clear filters
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <input
          value={filters.actor}
          onChange={(e) => updateFilter('actor', e.target.value)}
          placeholder="actor (exact)"
          className="px-3 py-2 rounded-xl bg-surface-container-lowest border border-outline-variant/40 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        <input
          value={filters.action}
          onChange={(e) => updateFilter('action', e.target.value)}
          placeholder="action (e.g. user.create)"
          className="px-3 py-2 rounded-xl bg-surface-container-lowest border border-outline-variant/40 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        <input
          value={filters.target}
          onChange={(e) => updateFilter('target', e.target.value)}
          placeholder="target"
          className="px-3 py-2 rounded-xl bg-surface-container-lowest border border-outline-variant/40 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        <select
          value={filters.success}
          onChange={(e) => updateFilter('success', e.target.value)}
          className="px-3 py-2 rounded-xl bg-surface-container-lowest border border-outline-variant/40 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <option value="">All statuses</option>
          <option value="true">Success</option>
          <option value="false">Failure</option>
        </select>
      </div>

      {error ? (
        <div className="bg-error-container text-on-error-container px-4 py-3 rounded-xl text-sm">
          {error}
        </div>
      ) : null}

      <div className="bg-surface-container-lowest border border-outline-variant/40 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-container-high text-on-surface-variant text-xs uppercase tracking-wide">
            <tr>
              <th className="px-4 py-3 text-left">When</th>
              <th className="px-4 py-3 text-left">Actor</th>
              <th className="px-4 py-3 text-left">Action</th>
              <th className="px-4 py-3 text-left">Target</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant/30">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-on-surface-variant">
                  Loading…
                </td>
              </tr>
            ) : !data.entries.length ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-on-surface-variant">
                  No entries match the current filters.
                </td>
              </tr>
            ) : (
              data.entries.map((e) => (
                <Fragment key={e.id}>
                  <tr className="hover:bg-surface-container/50">
                    <td className="px-4 py-2 text-on-surface-variant whitespace-nowrap" title={e.ts}>
                      {formatTime(e.ts)}
                    </td>
                    <td className="px-4 py-2 font-medium text-on-surface">{e.actor}</td>
                    <td className="px-4 py-2"><ActionBadge action={e.action} /></td>
                    <td className="px-4 py-2 text-on-surface-variant">{e.target || '—'}</td>
                    <td className="px-4 py-2">
                      {e.success ? (
                        <span className="text-tertiary inline-flex items-center gap-1">
                          <span className="material-symbols-outlined text-[16px]">check</span>
                          ok
                        </span>
                      ) : (
                        <span className="text-error inline-flex items-center gap-1">
                          <span className="material-symbols-outlined text-[16px]">error</span>
                          failed
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {e.detail ? (
                        <button
                          onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                          className="text-xs text-primary hover:underline"
                        >
                          {expanded === e.id ? 'Hide' : 'Detail'}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                  {expanded === e.id && e.detail ? (
                    <tr className="bg-surface-container/50">
                      <td colSpan={6} className="px-4 py-3">
                        <pre className="text-xs font-mono whitespace-pre-wrap text-on-surface-variant">
                          {JSON.stringify(e.detail, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>

      {data.total_pages > 1 ? (
        <div className="flex items-center justify-between text-sm">
          <span className="text-on-surface-variant">
            Page {data.page} of {data.total_pages}
          </span>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-3 py-1.5 rounded-lg border border-outline-variant/40 disabled:opacity-50 hover:bg-surface-container-high"
            >
              Previous
            </button>
            <button
              disabled={page >= data.total_pages}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1.5 rounded-lg border border-outline-variant/40 disabled:opacity-50 hover:bg-surface-container-high"
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
