import { useState, useEffect } from 'react';
import api from '../api';

export default function AppPermEditor({ appSlug, appName, userSub }) {
  const [permissions, setPermissions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .get(`/api/permissions/${appSlug}/${userSub}`)
      .then((data) => {
        setPermissions(data);
        setDirty(false);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [appSlug, userSub]);

  const handleRoleChange = (role) => {
    setPermissions((prev) => ({ ...prev, role }));
    setDirty(true);
  };

  const handleToggle = (key) => {
    setPermissions((prev) => ({
      ...prev,
      permissions: {
        ...prev.permissions,
        [key]: !prev.permissions[key],
      },
    }));
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.put(`/api/permissions/${appSlug}/${userSub}`, permissions);
      setDirty(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-4 border border-outline-variant/40 rounded-xl">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-5 h-5 bg-surface-container rounded animate-pulse" />
          <div className="w-32 h-4 bg-surface-container rounded animate-pulse" />
        </div>
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-8 bg-surface-container rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error && !permissions) {
    return (
      <div className="p-4 border border-outline-variant/40 rounded-xl">
        <p className="text-sm font-medium text-on-surface mb-1">{appName}</p>
        <p className="text-sm text-error">{error}</p>
      </div>
    );
  }

  if (!permissions) return null;

  return (
    <div className="p-4 border border-outline-variant/40 rounded-xl">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-sm font-medium text-on-surface">{appName}</h4>
        {dirty && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1.5 text-xs font-medium bg-primary text-on-primary rounded-lg
                       hover:bg-primary-dim disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        )}
      </div>

      {error && <p className="text-xs text-error mb-3">{error}</p>}

      {/* Role selector */}
      {permissions.roles && (
        <div className="mb-4">
          <label className="text-xs font-medium text-on-surface-variant mb-1.5 block">Role</label>
          <select
            value={permissions.role || ''}
            onChange={(e) => handleRoleChange(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-surface-container-low border border-outline-variant/40 rounded-lg
                       text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
          >
            {permissions.roles.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Permission toggles */}
      {permissions.permissions && (
        <div className="space-y-2">
          {Object.entries(permissions.permissions).map(([key, value]) => {
            const description = permissions.descriptions?.[key];
            return (
              <label
                key={key}
                className="flex items-center justify-between py-1.5 cursor-pointer"
                title={description || undefined}
              >
                <span className="inline-flex items-center gap-1.5 text-sm text-on-surface">
                  {key.replace(/_/g, ' ')}
                  {description && (
                    <span
                      className="material-symbols-outlined text-on-surface-variant text-[14px]"
                      aria-label={description}
                    >
                      info
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => handleToggle(key)}
                  className={`relative w-9 h-5 rounded-full transition-colors ${
                    value ? 'bg-primary' : 'bg-outline-variant'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                      value ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
