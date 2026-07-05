import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '../api';
import Modal from '../components/Modal';
import Avatar from '../components/Avatar';
import { toast, toastError } from '../lib/toast';

const PROTECTED = new Set(['admins', 'authentik Admins']);

export default function GroupDetail() {
  const { name: rawName } = useParams();
  const name = decodeURIComponent(rawName);
  const navigate = useNavigate();

  const [group, setGroup] = useState(null);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Add member
  const [userSearch, setUserSearch] = useState('');
  const [userResults, setUserResults] = useState([]);
  const [adding, setAdding] = useState(false);

  // Rename / delete
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleteSaving, setDeleteSaving] = useState(false);

  const isProtected = PROTECTED.has(name);

  const fetchGroup = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const encoded = encodeURIComponent(name);
      const [g, m] = await Promise.all([
        api.get(`/api/groups/${encoded}`),
        api.get(`/api/groups/${encoded}/members`),
      ]);
      setGroup(g);
      setMembers(m || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [name]);

  useEffect(() => {
    fetchGroup();
  }, [fetchGroup]);

  // Debounced user search for "add member"
  useEffect(() => {
    const q = userSearch.trim();
    if (!q) {
      setUserResults([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const data = await api.get(
          `/api/users?search=${encodeURIComponent(q)}&page_size=10`
        );
        if (!cancelled) setUserResults(data.users || []);
      } catch {
        if (!cancelled) setUserResults([]);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [userSearch]);

  const memberIds = useMemo(() => new Set(members.map((m) => m.id)), [members]);
  const candidates = userResults.filter((u) => !memberIds.has(u.id));

  const handleAddMember = async (user) => {
    if (!group) return;
    setAdding(true);
    try {
      await api.post(`/api/groups/${group.id}/members/${user.id}`);
      toast.success(`Added ${user.name || user.username}`);
      setUserSearch('');
      setUserResults([]);
      await fetchGroup();
    } catch (err) {
      toastError(err);
    } finally {
      setAdding(false);
    }
  };

  const handleRemoveMember = async (member) => {
    if (!group) return;
    try {
      await api.delete(`/api/groups/${group.id}/members/${member.id}`);
      setMembers((prev) => prev.filter((m) => m.id !== member.id));
      toast.success(`Removed ${member.name || member.username}`);
    } catch (err) {
      toastError(err);
    }
  };

  const openRename = () => {
    setRenameValue(name);
    setRenameOpen(true);
  };

  const handleRename = async () => {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === name) {
      setRenameOpen(false);
      return;
    }
    setRenameSaving(true);
    try {
      await api.patch(`/api/groups/${group.id}`, { name: trimmed });
      toast.success(`Renamed to "${trimmed}"`);
      setRenameOpen(false);
      navigate(`/groups/${encodeURIComponent(trimmed)}`, { replace: true });
    } catch (err) {
      toastError(err);
    } finally {
      setRenameSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleteSaving(true);
    try {
      await api.delete(`/api/groups/${group.id}`);
      toast.success(`Group "${name}" deleted`);
      navigate('/groups');
    } catch (err) {
      toastError(err);
    } finally {
      setDeleteSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="w-32 h-6 bg-surface-container rounded animate-pulse" />
        <div className="h-32 bg-surface-container rounded-xl animate-pulse" />
      </div>
    );
  }

  if (error && !group) {
    return (
      <div className="space-y-4">
        <Link to="/groups" className="flex items-center gap-1 text-sm text-on-surface-variant hover:text-on-surface transition-colors">
          <span className="material-symbols-outlined text-[18px]">arrow_back</span>
          Back to Groups
        </Link>
        <div className="flex items-center gap-2 p-4 bg-error-container/20 border border-error/20 rounded-xl">
          <span className="material-symbols-outlined text-error text-[20px]">error</span>
          <p className="text-sm text-error">{error}</p>
        </div>
      </div>
    );
  }

  if (!group) return null;

  return (
    <div className="space-y-8">
      <Link
        to="/groups"
        className="flex items-center gap-1 text-sm text-on-surface-variant hover:text-on-surface transition-colors"
      >
        <span className="material-symbols-outlined text-[18px]">arrow_back</span>
        Back to Groups
      </Link>

      {/* Header card */}
      <div className="p-6 border border-outline-variant/40 rounded-xl bg-surface-container-lowest">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center">
            <span className="material-symbols-outlined text-[24px]">group</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="font-heading text-xl font-bold text-on-surface">{name}</h2>
              {isProtected && (
                <span
                  className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-surface-container-high text-on-surface-variant"
                  title="Protected group"
                >
                  PROTECTED
                </span>
              )}
              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={openRename}
                  disabled={isProtected}
                  className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-surface-container-high text-on-surface rounded-lg
                             hover:bg-surface-container-highest disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  title={isProtected ? 'Protected group cannot be renamed' : 'Rename group'}
                >
                  <span className="material-symbols-outlined text-[15px]">edit</span>
                  Rename
                </button>
                <button
                  onClick={() => {
                    setDeleteConfirm('');
                    setDeleteOpen(true);
                  }}
                  disabled={isProtected}
                  className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-error text-on-error rounded-lg
                             hover:bg-error-dim disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  title={isProtected ? 'Protected group cannot be deleted' : 'Delete group'}
                >
                  <span className="material-symbols-outlined text-[15px]">delete</span>
                  Delete
                </button>
              </div>
            </div>
            <p className="text-sm text-on-surface-variant mt-1">
              {members.length} {members.length === 1 ? 'member' : 'members'}
            </p>
          </div>
        </div>
      </div>

      {/* Add member */}
      <section>
        <h3 className="font-heading text-lg font-semibold text-on-surface mb-3">Add member</h3>
        <div className="p-4 border border-outline-variant/40 rounded-xl bg-surface-container-lowest space-y-3">
          <input
            value={userSearch}
            onChange={(e) => setUserSearch(e.target.value)}
            placeholder="Search users by name, username, or email…"
            className="w-full px-3 py-2 text-sm bg-surface-container-low border border-outline-variant/40 rounded-lg
                       text-on-surface placeholder:text-outline focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
          />
          {userSearch.trim() && (
            <div className="space-y-1">
              {candidates.length === 0 ? (
                <p className="text-sm text-on-surface-variant px-2 py-2">No matching users</p>
              ) : (
                candidates.map((u) => (
                  <div
                    key={u.id}
                    className="flex items-center justify-between gap-3 py-2 px-3 rounded-lg hover:bg-surface-container-low"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar name={u.name} email={u.email} size="sm" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-on-surface truncate">
                          {u.name || u.username}
                        </p>
                        <p className="text-xs text-on-surface-variant truncate">{u.email}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleAddMember(u)}
                      disabled={adding}
                      className="shrink-0 px-3 py-1 text-xs font-medium bg-primary text-on-primary rounded-lg
                                 hover:bg-primary-dim disabled:opacity-50 transition-colors"
                    >
                      Add
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </section>

      {/* Members list */}
      <section>
        <h3 className="font-heading text-lg font-semibold text-on-surface mb-3">Members</h3>
        <div className="border border-outline-variant/40 rounded-xl bg-surface-container-lowest overflow-hidden">
          {members.length === 0 ? (
            <p className="p-6 text-sm text-on-surface-variant text-center">No members in this group</p>
          ) : (
            <div className="divide-y divide-outline-variant/20">
              {members.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-container-low transition-colors"
                >
                  <Link
                    to={`/users/${m.id}`}
                    className="flex items-center gap-3 min-w-0 flex-1"
                  >
                    <Avatar name={m.name} email={m.email} size="sm" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-on-surface truncate">
                        {m.name || m.username}
                      </p>
                      <p className="text-xs text-on-surface-variant truncate">{m.email}</p>
                    </div>
                  </Link>
                  <button
                    onClick={() => handleRemoveMember(m)}
                    className="shrink-0 p-1.5 rounded-lg text-on-surface-variant hover:text-error hover:bg-error-container/20 transition-colors"
                    title="Remove member"
                  >
                    <span className="material-symbols-outlined text-[18px]">close</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Rename modal */}
      <Modal
        isOpen={renameOpen}
        onClose={() => setRenameOpen(false)}
        title="Rename Group"
        actions={
          <>
            <button
              onClick={() => setRenameOpen(false)}
              className="px-4 py-2 text-sm text-on-surface-variant hover:text-on-surface transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleRename}
              disabled={renameSaving || !renameValue.trim() || renameValue.trim() === name}
              className="px-4 py-2 text-sm font-medium bg-primary text-on-primary rounded-lg
                         hover:bg-primary-dim disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {renameSaving ? 'Saving…' : 'Save'}
            </button>
          </>
        }
      >
        <label className="text-xs font-medium text-on-surface-variant mb-1.5 block">New name</label>
        <input
          autoFocus
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleRename()}
          className="w-full px-3 py-2 text-sm bg-surface-container-low border border-outline-variant/40 rounded-lg
                     text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
        />
      </Modal>

      {/* Delete modal */}
      <Modal
        isOpen={deleteOpen}
        onClose={() => {
          setDeleteOpen(false);
          setDeleteConfirm('');
        }}
        title="Delete Group"
        actions={
          <>
            <button
              onClick={() => {
                setDeleteOpen(false);
                setDeleteConfirm('');
              }}
              className="px-4 py-2 text-sm text-on-surface-variant hover:text-on-surface transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={deleteConfirm !== name || deleteSaving}
              className="px-4 py-2 text-sm font-medium bg-error text-on-error rounded-lg
                         hover:bg-error-dim disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {deleteSaving ? 'Deleting…' : 'Delete'}
            </button>
          </>
        }
      >
        <p className="text-sm text-on-surface mb-4">
          This will permanently delete the group <strong>{name}</strong>. Users in this group will
          lose any access granted via it. This action cannot be undone.
        </p>
        <label className="text-xs font-medium text-on-surface-variant mb-1.5 block">
          Type <strong>{name}</strong> to confirm
        </label>
        <input
          value={deleteConfirm}
          onChange={(e) => setDeleteConfirm(e.target.value)}
          placeholder={name}
          className="w-full px-3 py-2 text-sm bg-surface-container-low border border-outline-variant/40 rounded-lg
                     text-on-surface focus:outline-none focus:border-error focus:ring-1 focus:ring-error/30"
        />
      </Modal>
    </div>
  );
}
