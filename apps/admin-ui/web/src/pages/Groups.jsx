import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';
import Modal from '../components/Modal';
import { toast, toastError } from '../lib/toast';

const PROTECTED = new Set(['admins', 'authentik Admins']);

export default function Groups() {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [members, setMembers] = useState({});
  const [membersLoading, setMembersLoading] = useState({});
  const [renameTarget, setRenameTarget] = useState(null); // {id, name}
  const [renameValue, setRenameValue] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleteSaving, setDeleteSaving] = useState(false);

  const fetchGroups = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get('/api/groups');
      setGroups(data || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newGroupName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await api.post('/api/groups', { name: newGroupName.trim() });
      toast.success(`Group "${newGroupName.trim()}" created`);
      setNewGroupName('');
      await fetchGroups();
    } catch (err) {
      toastError(err);
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const toggleExpand = async (group) => {
    const gid = group.id || group.name;
    const name = group.name;
    if (expanded === name) {
      setExpanded(null);
      return;
    }
    setExpanded(name);
    if (!members[name]) {
      setMembersLoading((prev) => ({ ...prev, [name]: true }));
      try {
        const data = await api.get(`/api/groups/${encodeURIComponent(gid)}/members`);
        setMembers((prev) => ({ ...prev, [name]: data || [] }));
      } catch {
        setMembers((prev) => ({ ...prev, [name]: [] }));
      } finally {
        setMembersLoading((prev) => ({ ...prev, [name]: false }));
      }
    }
  };

  const handleRemoveMember = async (group, userId) => {
    const gid = group.id || group.name;
    const name = group.name;
    try {
      await api.delete(`/api/groups/${encodeURIComponent(gid)}/members/${userId}`);
      setMembers((prev) => ({
        ...prev,
        [name]: (prev[name] || []).filter((m) => m.id !== userId),
      }));
      toast.success('Member removed');
    } catch (err) {
      toastError(err);
      setError(err.message);
    }
  };

  const openRename = (group) => {
    setRenameTarget(group);
    setRenameValue(group.name);
  };

  const handleRename = async () => {
    if (!renameTarget) return;
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === renameTarget.name) {
      setRenameTarget(null);
      return;
    }
    setRenameSaving(true);
    try {
      const gid = renameTarget.id || renameTarget.name;
      await api.patch(`/api/groups/${encodeURIComponent(gid)}`, { name: trimmed });
      toast.success(`Renamed to "${trimmed}"`);
      setRenameTarget(null);
      setMembers((prev) => {
        if (!prev[renameTarget.name]) return prev;
        const { [renameTarget.name]: m, ...rest } = prev;
        return { ...rest, [trimmed]: m };
      });
      if (expanded === renameTarget.name) setExpanded(trimmed);
      await fetchGroups();
    } catch (err) {
      toastError(err);
    } finally {
      setRenameSaving(false);
    }
  };

  const openDelete = (group) => {
    setDeleteTarget(group);
    setDeleteConfirm('');
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteSaving(true);
    try {
      const gid = deleteTarget.id || deleteTarget.name;
      await api.delete(`/api/groups/${encodeURIComponent(gid)}`);
      toast.success(`Group "${deleteTarget.name}" deleted`);
      setDeleteTarget(null);
      setDeleteConfirm('');
      if (expanded === deleteTarget.name) setExpanded(null);
      await fetchGroups();
    } catch (err) {
      toastError(err);
    } finally {
      setDeleteSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <h1 className="font-heading text-2xl font-bold text-on-surface">Groups</h1>
        {!loading && (
          <span className="px-2.5 py-0.5 bg-secondary-container text-on-secondary-container text-xs font-medium rounded-full">
            {groups.length}
          </span>
        )}
      </div>

      {/* Create group form */}
      <form onSubmit={handleCreate} className="flex gap-2 max-w-md">
        <input
          value={newGroupName}
          onChange={(e) => setNewGroupName(e.target.value)}
          placeholder="New group name"
          className="flex-1 px-3 py-2.5 text-sm bg-surface-container-low border border-outline-variant/40 rounded-xl
                     text-on-surface placeholder:text-outline
                     focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors"
        />
        <button
          type="submit"
          disabled={!newGroupName.trim() || creating}
          className="px-5 py-2.5 text-sm font-medium bg-primary text-on-primary rounded-xl
                     hover:bg-primary-dim disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {creating ? 'Creating…' : 'Create'}
        </button>
      </form>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-4 bg-error-container/20 border border-error/20 rounded-xl">
          <span className="material-symbols-outlined text-error text-[20px]">error</span>
          <p className="text-sm text-error">{error}</p>
        </div>
      )}

      {/* Groups list */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-surface-container rounded-xl animate-pulse" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-on-surface-variant">
          <span className="material-symbols-outlined text-[48px] mb-3 text-outline">folder_off</span>
          <p className="text-base font-medium">No groups yet</p>
          <p className="text-sm mt-1">Create your first group above</p>
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map((group) => {
            const name = group.name;
            const memberCount = group.member_count;
            const isExpanded = expanded === name;
            const groupMembers = members[name] || [];
            const isLoadingMembers = membersLoading[name];
            const isProtected = PROTECTED.has(name);

            return (
              <div key={name} className="border border-outline-variant/40 rounded-xl bg-surface-container-lowest overflow-hidden">
                <div className="w-full flex items-center justify-between px-5 py-4 hover:bg-surface-container-low transition-colors">
                  <Link
                    to={`/groups/${encodeURIComponent(name)}`}
                    className="flex-1 flex items-center gap-3 text-left min-w-0"
                  >
                    <span className="material-symbols-outlined text-on-surface-variant text-[20px]">group</span>
                    <span className="text-sm font-medium text-on-surface truncate">{name}</span>
                    {memberCount != null && (
                      <span className="text-xs text-on-surface-variant whitespace-nowrap">
                        {memberCount} {memberCount === 1 ? 'member' : 'members'}
                      </span>
                    )}
                    {isProtected && (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-surface-container-high text-on-surface-variant" title="Protected group">
                        PROTECTED
                      </span>
                    )}
                  </Link>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => openRename(group)}
                      className="p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors"
                      title="Rename group"
                      disabled={isProtected}
                    >
                      <span className="material-symbols-outlined text-[18px]">edit</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => openDelete(group)}
                      className="p-1.5 rounded-lg text-on-surface-variant hover:text-error hover:bg-error-container/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      title={isProtected ? 'Protected group cannot be deleted' : 'Delete group'}
                      disabled={isProtected}
                    >
                      <span className="material-symbols-outlined text-[18px]">delete</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleExpand(group)}
                      className="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container-high transition-colors"
                      aria-label="Toggle members"
                    >
                      <span
                        className={`material-symbols-outlined text-[20px] transition-transform ${
                          isExpanded ? 'rotate-180' : ''
                        }`}
                      >
                        expand_more
                      </span>
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="px-5 pb-4 border-t border-outline-variant/20">
                    {isLoadingMembers ? (
                      <div className="py-4 space-y-2">
                        {[1, 2].map((i) => (
                          <div key={i} className="h-8 bg-surface-container rounded animate-pulse" />
                        ))}
                      </div>
                    ) : groupMembers.length === 0 ? (
                      <p className="py-4 text-sm text-on-surface-variant">No members in this group</p>
                    ) : (
                      <div className="py-2 space-y-1">
                        {groupMembers.map((member) => (
                          <div
                            key={member.id}
                            className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-surface-container-low transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-7 h-7 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center text-[10px] font-semibold">
                                {(member.name || member.username || '?').charAt(0).toUpperCase()}
                              </div>
                              <span className="text-sm text-on-surface">{member.name || member.username}</span>
                            </div>
                            <button
                              onClick={() => handleRemoveMember(group, member.id)}
                              className="p-1 rounded-lg text-on-surface-variant hover:text-error hover:bg-error-container/20 transition-colors"
                              title="Remove member"
                            >
                              <span className="material-symbols-outlined text-[18px]">close</span>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Rename modal */}
      <Modal
        isOpen={!!renameTarget}
        onClose={() => setRenameTarget(null)}
        title="Rename Group"
        actions={
          <>
            <button
              onClick={() => setRenameTarget(null)}
              className="px-4 py-2 text-sm text-on-surface-variant hover:text-on-surface transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleRename}
              disabled={renameSaving || !renameValue.trim() || renameValue.trim() === renameTarget?.name}
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
        isOpen={!!deleteTarget}
        onClose={() => {
          setDeleteTarget(null);
          setDeleteConfirm('');
        }}
        title="Delete Group"
        actions={
          <>
            <button
              onClick={() => {
                setDeleteTarget(null);
                setDeleteConfirm('');
              }}
              className="px-4 py-2 text-sm text-on-surface-variant hover:text-on-surface transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={deleteConfirm !== deleteTarget?.name || deleteSaving}
              className="px-4 py-2 text-sm font-medium bg-error text-on-error rounded-lg
                         hover:bg-error-dim disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {deleteSaving ? 'Deleting…' : 'Delete'}
            </button>
          </>
        }
      >
        <p className="text-sm text-on-surface mb-4">
          This will permanently delete the group <strong>{deleteTarget?.name}</strong>. Users in this group
          will lose any access granted via it. This action cannot be undone.
        </p>
        <label className="text-xs font-medium text-on-surface-variant mb-1.5 block">
          Type <strong>{deleteTarget?.name}</strong> to confirm
        </label>
        <input
          value={deleteConfirm}
          onChange={(e) => setDeleteConfirm(e.target.value)}
          placeholder={deleteTarget?.name}
          className="w-full px-3 py-2 text-sm bg-surface-container-low border border-outline-variant/40 rounded-lg
                     text-on-surface focus:outline-none focus:border-error focus:ring-1 focus:ring-error/30"
        />
      </Modal>
    </div>
  );
}
