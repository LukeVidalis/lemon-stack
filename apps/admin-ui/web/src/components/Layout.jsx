import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useUser } from '@{{GITHUB_ORG}}/auth-react';
import CommandPalette from './CommandPalette';

const navItems = [
  { to: '/', icon: 'dashboard', label: 'Dashboard' },
  { to: '/users', icon: 'people', label: 'Users' },
  { to: '/groups', icon: 'group', label: 'Groups' },
  { to: '/invite', icon: 'person_add', label: 'Invite User' },
  { to: '/audit', icon: 'history', label: 'Audit Log' },
];

export default function Layout() {
  const { user: me } = useUser();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex min-h-screen">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-inverse-surface/40 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed lg:static inset-y-0 left-0 z-40 w-[260px] bg-surface-container-lowest
          border-r border-outline-variant/40 flex flex-col transition-transform duration-200
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-6 h-16 border-b border-outline-variant/40">
          <span className="material-symbols-outlined text-primary text-[28px]">nutrition</span>
          <span className="font-heading font-bold text-lg text-on-surface">Lemon Admin</span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-3 px-3 space-y-1">
          {navItems.map(({ to, icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-primary-container text-on-primary-container'
                    : 'text-on-surface-variant hover:bg-surface-container-high'
                }`
              }
            >
              <span className="material-symbols-outlined text-[20px]">{icon}</span>
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Divider + Admin info */}
        <div className="border-t border-outline-variant/40 px-5 py-4">
          {me ? (
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center text-xs font-semibold">
                {(me.name || me.username || '?').charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-on-surface truncate">{me.name || me.username}</p>
                <p className="text-xs text-on-surface-variant truncate">{me.email}</p>
              </div>
              <a
                href="/outpost.goauthentik.io/sign_out"
                className="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container-high transition-colors"
                title="Log out"
              >
                <span className="material-symbols-outlined text-[18px]">logout</span>
              </a>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-surface-container animate-pulse" />
              <div className="space-y-1.5">
                <div className="w-20 h-3 bg-surface-container rounded animate-pulse" />
                <div className="w-28 h-2.5 bg-surface-container rounded animate-pulse" />
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile header */}
        <header className="lg:hidden flex items-center h-14 px-4 border-b border-outline-variant/40 bg-surface-container-lowest">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 -ml-2 rounded-xl hover:bg-surface-container-high transition-colors"
          >
            <span className="material-symbols-outlined text-on-surface">menu</span>
          </button>
          <span className="ml-3 font-heading font-bold text-on-surface">Lemon Admin</span>
        </header>

        <main className="flex-1 p-6 lg:p-8 max-w-6xl w-full mx-auto">
          <Outlet />
        </main>
      </div>
      <CommandPalette />
    </div>
  );
}
