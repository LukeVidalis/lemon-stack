import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';

// Static nav targets — keep in sync with Layout's navItems.
const NAV_ITEMS = [
  { id: 'nav:dashboard', label: 'Dashboard', icon: 'dashboard', path: '/' },
  { id: 'nav:users', label: 'Users', icon: 'people', path: '/users' },
  { id: 'nav:groups', label: 'Groups', icon: 'group', path: '/groups' },
  { id: 'nav:invite', label: 'Invite User', icon: 'person_add', path: '/invite' },
  { id: 'nav:audit', label: 'Audit Log', icon: 'history', path: '/audit' },
];

export default function CommandPalette() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef(null);

  // Cmd/Ctrl-K toggles the palette.
  useEffect(() => {
    const onKey = (e) => {
      const isCmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k';
      if (isCmdK) {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === 'Escape' && open) {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Reset state + focus input each time we open.
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Load full groups list on first open (small + cached server-side).
  useEffect(() => {
    if (!open || groups.length) return;
    let cancelled = false;
    api
      .get('/api/groups')
      .then((data) => {
        if (!cancelled) setGroups(Array.isArray(data) ? data : []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, groups.length]);

  // Debounced user search.
  useEffect(() => {
    if (!open) return undefined;
    const q = query.trim();
    if (!q) {
      setUsers([]);
      return undefined;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const data = await api.get(`/api/users?search=${encodeURIComponent(q)}&page_size=8`);
        if (!cancelled) setUsers(data.users || []);
      } catch {
        if (!cancelled) setUsers([]);
      }
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, open]);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const navMatches = NAV_ITEMS.filter((n) => !q || n.label.toLowerCase().includes(q));
    const groupMatches = q
      ? groups
          .filter((g) => g.name.toLowerCase().includes(q))
          .slice(0, 6)
          .map((g) => ({
            id: `group:${g.id}`,
            label: g.name,
            hint: `${g.member_count || 0} members`,
            icon: 'group',
            path: `/groups/${encodeURIComponent(g.name)}`,
          }))
      : [];
    const userMatches = users.map((u) => ({
      id: `user:${u.id}`,
      label: u.name || u.username,
      hint: u.email,
      icon: 'person',
      path: `/users/${u.id}`,
    }));
    return [
      ...navMatches.map((n) => ({ ...n, kind: 'Navigation' })),
      ...groupMatches.map((g) => ({ ...g, kind: 'Groups' })),
      ...userMatches.map((u) => ({ ...u, kind: 'Users' })),
    ];
  }, [query, users, groups]);

  // Clamp selected to valid range whenever items change.
  useEffect(() => {
    if (selected >= items.length) setSelected(Math.max(0, items.length - 1));
  }, [items, selected]);

  const onPick = useCallback(
    (item) => {
      if (!item) return;
      setOpen(false);
      navigate(item.path);
    },
    [navigate]
  );

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((s) => Math.min(items.length - 1, s + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((s) => Math.max(0, s - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      onPick(items[selected]);
    }
  };

  if (!open) return null;

  // Group items by section for rendering.
  const sections = [];
  let lastKind = null;
  items.forEach((item, idx) => {
    if (item.kind !== lastKind) {
      sections.push({ kind: item.kind, items: [] });
      lastKind = item.kind;
    }
    sections[sections.length - 1].items.push({ item, idx });
  });

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[10vh]">
      <div
        className="absolute inset-0 bg-inverse-surface/50 backdrop-blur-sm"
        onClick={() => setOpen(false)}
      />
      <div className="relative w-full max-w-xl bg-surface-container-lowest rounded-xl shadow-2xl border border-outline-variant/40 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-outline-variant/40">
          <span className="material-symbols-outlined text-on-surface-variant text-[20px]">search</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search users, groups, or jump to a page…"
            className="flex-1 bg-transparent outline-none text-sm text-on-surface placeholder:text-outline"
          />
          <kbd className="text-[10px] font-medium px-1.5 py-0.5 rounded border border-outline-variant/60 text-on-surface-variant">
            esc
          </kbd>
        </div>
        <div className="max-h-[60vh] overflow-y-auto py-1">
          {items.length === 0 ? (
            <p className="px-4 py-6 text-sm text-on-surface-variant text-center">
              No results
            </p>
          ) : (
            sections.map((section) => (
              <div key={section.kind} className="py-1">
                <div className="px-3 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant">
                  {section.kind}
                </div>
                {section.items.map(({ item, idx }) => (
                  <button
                    key={item.id}
                    onMouseEnter={() => setSelected(idx)}
                    onClick={() => onPick(item)}
                    className={`w-full flex items-center gap-3 px-3 py-2 text-left text-sm transition-colors ${
                      idx === selected
                        ? 'bg-primary-container/60 text-on-primary-container'
                        : 'text-on-surface hover:bg-surface-container-low'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[18px] text-on-surface-variant">
                      {item.icon}
                    </span>
                    <span className="flex-1 min-w-0 truncate">{item.label}</span>
                    {item.hint && (
                      <span className="text-xs text-on-surface-variant truncate max-w-[40%]">
                        {item.hint}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-outline-variant/40 text-[10px] text-on-surface-variant">
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 rounded border border-outline-variant/60">↑</kbd>
            <kbd className="px-1.5 py-0.5 rounded border border-outline-variant/60">↓</kbd>
            navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 rounded border border-outline-variant/60">↵</kbd>
            select
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 rounded border border-outline-variant/60">⌘K</kbd>
            toggle
          </span>
        </div>
      </div>
    </div>
  );
}
