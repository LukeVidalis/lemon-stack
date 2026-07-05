import { useState } from 'react';
import api from '../api';

export default function AppAccessGrid({ apps, userId, onUpdate }) {
  const [loadingApp, setLoadingApp] = useState(null);

  const toggleAccess = async (app) => {
    setLoadingApp(app.slug);
    try {
      if (app.has_access) {
        await api.delete(`/api/users/${userId}/access/${app.slug}`);
      } else {
        await api.post(`/api/users/${userId}/access/${app.slug}`);
      }
      if (onUpdate) onUpdate();
    } catch (err) {
      console.error('Failed to toggle access:', err);
    } finally {
      setLoadingApp(null);
    }
  };

  if (!apps || apps.length === 0) {
    return (
      <div className="text-sm text-on-surface-variant py-4 text-center">
        No applications configured
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {apps.map((app) => {
        const isLoading = loadingApp === app.slug;
        return (
          <div
            key={app.slug}
            className={`flex items-center justify-between p-4 rounded-xl border transition-colors ${
              app.has_access
                ? 'border-primary/30 bg-primary-container/20'
                : 'border-outline-variant/40 bg-surface-container-low'
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className="material-symbols-outlined text-[24px] text-on-surface-variant shrink-0">
                {app.icon || 'apps'}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-on-surface truncate">{app.name}</p>
                {app.has_access && (
                  <div className="flex items-center gap-1 mt-0.5">
                    <span className="material-symbols-outlined text-[14px] text-primary-dim">check_circle</span>
                    <span className="text-xs text-primary-dim">Access granted</span>
                  </div>
                )}
              </div>
            </div>

            {/* Toggle switch */}
            <button
              onClick={() => toggleAccess(app)}
              disabled={isLoading}
              className={`relative w-11 h-6 rounded-full shrink-0 transition-colors ${
                app.has_access ? 'bg-primary' : 'bg-outline-variant'
              } ${isLoading ? 'opacity-50' : ''}`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                  app.has_access ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        );
      })}
    </div>
  );
}
