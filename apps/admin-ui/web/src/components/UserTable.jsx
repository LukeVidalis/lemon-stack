import { useNavigate } from 'react-router-dom';
import GroupBadge from './GroupBadge';
import Avatar from './Avatar';
import { relativeTime } from '../lib/time';

function SkeletonRows({ count = 5 }) {
  return Array.from({ length: count }, (_, i) => (
    <tr key={i}>
      {Array.from({ length: 6 }, (_, j) => (
        <td key={j} className="px-4 py-3">
          <div className="h-4 bg-surface-container rounded animate-pulse" />
        </td>
      ))}
    </tr>
  ));
}

export default function UserTable({
  users,
  loading,
  page,
  totalPages,
  onPageChange,
  sortField,
  sortDir,
  onSort,
}) {
  const navigate = useNavigate();

  const headers = [
    { key: null, label: '' },
    { key: 'name', label: 'Name' },
    { key: 'email', label: 'Email' },
    { key: null, label: 'Groups' },
    { key: 'last_login', label: 'Last Login' },
    { key: null, label: '' },
  ];

  const handleSort = (key) => {
    if (!key) return;
    const dir = sortField === key && sortDir === 'asc' ? 'desc' : 'asc';
    onSort(key, dir);
  };

  if (!loading && (!users || users.length === 0)) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-on-surface-variant">
        <span className="material-symbols-outlined text-[48px] mb-3 text-outline">group_off</span>
        <p className="text-base font-medium">No users found</p>
        <p className="text-sm mt-1">Try adjusting your search or filters</p>
      </div>
    );
  }

  return (
    <div>
      <div className="overflow-x-auto border border-outline-variant/40 rounded-xl">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-outline-variant/40 bg-surface-container-low">
              {headers.map((h, i) => (
                <th
                  key={i}
                  onClick={() => handleSort(h.key)}
                  className={`px-4 py-3 text-left font-medium text-on-surface-variant ${
                    h.key ? 'cursor-pointer hover:text-on-surface select-none' : ''
                  }`}
                >
                  <span className="inline-flex items-center gap-1">
                    {h.label}
                    {h.key && sortField === h.key && (
                      <span className="material-symbols-outlined text-[16px]">
                        {sortDir === 'asc' ? 'arrow_upward' : 'arrow_downward'}
                      </span>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <SkeletonRows />
            ) : (
              users.map((user) => (
                <tr
                  key={user.id}
                  onClick={() => navigate(`/users/${user.id}`)}
                  className="border-b border-outline-variant/20 hover:bg-surface-container-low cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3">
                    <Avatar name={user.name} email={user.email} size="md" />
                  </td>
                  <td className="px-4 py-3 font-medium text-on-surface">
                    <span className="inline-flex items-center gap-2">
                      {user.name}
                      {user.is_active === false && (
                        <span
                          className="px-1.5 py-0.5 text-[10px] font-medium bg-error-container/40 text-error rounded"
                          title="User is disabled"
                        >
                          DISABLED
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-on-surface-variant">{user.email}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(user.groups || []).slice(0, 3).map((g) => (
                        <GroupBadge key={g} name={g} />
                      ))}
                      {(user.groups || []).length > 3 && (
                        <span className="text-xs text-on-surface-variant">
                          +{user.groups.length - 3}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-on-surface-variant whitespace-nowrap">
                    {relativeTime(user.last_login)}
                  </td>
                  <td className="px-4 py-3">
                    <span className="material-symbols-outlined text-on-surface-variant text-[18px]">
                      chevron_right
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-on-surface-variant">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
              className="px-3 py-1.5 text-sm rounded-lg border border-outline-variant/40 text-on-surface-variant
                         hover:bg-surface-container-high disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
              className="px-3 py-1.5 text-sm rounded-lg border border-outline-variant/40 text-on-surface-variant
                         hover:bg-surface-container-high disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
