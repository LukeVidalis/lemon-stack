import { useState, useEffect, useCallback } from 'react';
import api from '../api';
import SearchBar from '../components/SearchBar';
import UserTable from '../components/UserTable';

const PAGE_SIZE_OPTIONS = [20, 50, 100, 200];

export default function Users() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [sortField, setSortField] = useState('name');
  const [sortDir, setSortDir] = useState('asc');
  const [statusFilter, setStatusFilter] = useState('all'); // all | active | disabled | never_logged_in
  const [groupFilter, setGroupFilter] = useState('');
  const [groupOptions, setGroupOptions] = useState([]);

  useEffect(() => {
    let cancelled = false;
    api
      .get('/api/groups')
      .then((data) => {
        if (!cancelled) setGroupOptions(Array.isArray(data) ? data : []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const ordering = sortDir === 'desc' ? `-${sortField}` : sortField;
      const params = new URLSearchParams({
        page: String(page),
        page_size: String(pageSize),
        ordering,
      });
      if (search) params.set('search', search);
      if (statusFilter === 'active') params.set('is_active', 'true');
      if (statusFilter === 'disabled') params.set('is_active', 'false');
      if (statusFilter === 'never_logged_in') params.set('never_logged_in', 'true');
      if (groupFilter) params.set('group', groupFilter);

      const data = await api.get(`/api/users?${params}`);
      setUsers(data.users || []);
      setTotalPages(data.total_pages || 1);
      setTotalCount(data.total || 0);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, sortField, sortDir, statusFilter, groupFilter]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleSearch = useCallback((value) => {
    setSearch(value);
    setPage(1);
  }, []);

  const handleSort = useCallback((field, dir) => {
    setSortField(field);
    setSortDir(dir);
    setPage(1);
  }, []);

  const exportCsv = useCallback(async () => {
    try {
      const ordering = sortDir === 'desc' ? `-${sortField}` : sortField;
      const rows = [];
      let p = 1;
      while (true) {
        const params = new URLSearchParams({
          page: String(p),
          page_size: '200',
          ordering,
        });
        if (search) params.set('search', search);
        if (statusFilter === 'active') params.set('is_active', 'true');
        if (statusFilter === 'disabled') params.set('is_active', 'false');
        if (statusFilter === 'never_logged_in') params.set('never_logged_in', 'true');
        if (groupFilter) params.set('group', groupFilter);
        const data = await api.get(`/api/users?${params}`);
        rows.push(...(data.users || []));
        if (p >= (data.total_pages || 1)) break;
        p += 1;
      }
      const header = ['username', 'name', 'email', 'is_active', 'last_login', 'groups'];
      const escape = (v) => {
        const s = v == null ? '' : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const csv = [
        header.join(','),
        ...rows.map((u) =>
          [
            u.username,
            u.name,
            u.email,
            u.is_active,
            u.last_login || '',
            (u.groups || []).join('|'),
          ]
            .map(escape)
            .join(',')
        ),
      ].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `users-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    }
  }, [search, sortField, sortDir, statusFilter, groupFilter]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="font-heading text-2xl font-bold text-on-surface">Users</h1>
          {!loading && (
            <span className="px-2.5 py-0.5 bg-secondary-container text-on-secondary-container text-xs font-medium rounded-full">
              {totalCount}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={exportCsv}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-outline-variant hover:bg-surface-container disabled:opacity-50"
          disabled={loading || totalCount === 0}
          title="Export current filter as CSV"
        >
          <span className="material-symbols-outlined text-[18px]">download</span>
          Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[12rem] max-w-md">
          <SearchBar value={search} onChange={handleSearch} placeholder="Search users…" />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className="px-3 py-2 text-sm rounded-lg border border-outline-variant bg-surface text-on-surface"
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="disabled">Disabled</option>
          <option value="never_logged_in">Never logged in</option>
        </select>
        <select
          value={groupFilter}
          onChange={(e) => {
            setGroupFilter(e.target.value);
            setPage(1);
          }}
          className="px-3 py-2 text-sm rounded-lg border border-outline-variant bg-surface text-on-surface"
        >
          <option value="">All groups</option>
          {groupOptions.map((g) => (
            <option key={g.id} value={g.name}>
              {g.name}
            </option>
          ))}
        </select>
        <select
          value={pageSize}
          onChange={(e) => {
            setPageSize(Number(e.target.value));
            setPage(1);
          }}
          className="px-3 py-2 text-sm rounded-lg border border-outline-variant bg-surface text-on-surface"
          title="Page size"
        >
          {PAGE_SIZE_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n} / page
            </option>
          ))}
        </select>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-4 bg-error-container/20 border border-error/20 rounded-xl">
          <span className="material-symbols-outlined text-error text-[20px]">error</span>
          <p className="text-sm text-error">{error}</p>
        </div>
      )}

      {/* Table */}
      <UserTable
        users={users}
        loading={loading}
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        sortField={sortField}
        sortDir={sortDir}
        onSort={handleSort}
      />
    </div>
  );
}
