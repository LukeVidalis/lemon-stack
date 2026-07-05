import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api';
import AppAccessGrid from '../components/AppAccessGrid';
import AppPermEditor from '../components/AppPermEditor';
import GroupBadge from '../components/GroupBadge';
import Avatar from '../components/Avatar';
import Modal from '../components/Modal';
import { relativeTime } from '../lib/time';
import { toast, toastError, copyToClipboard } from '../lib/toast';

export default function UserDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [user, setUser] = useState(null);
  const [apps, setApps] = useState([]);
  const [allApps, setAllApps] = useState([]);
  const [allGroups, setAllGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Edit mode
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [saveLoading, setSaveLoading] = useState(false);

  // Delete modal
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Recovery link
  const [recoveryLink, setRecoveryLink] = useState(null);
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(null);
  const [emailLoading, setEmailLoading] = useState(false);

  // Enable/disable
  const [toggleLoading, setToggleLoading] = useState(false);

  // Impersonation (feature-flagged via /api/me → features.impersonation)
  const [impersonationEnabled, setImpersonationEnabled] = useState(false);
  const [impersonateOpen, setImpersonateOpen] = useState(false);
  const [impersonateReason, setImpersonateReason] = useState('');
  const [impersonateLoading, setImpersonateLoading] = useState(false);

  // Group add
  const [addGroup, setAddGroup] = useState('');

  // Authenticator devices (MFA)
  const [devices, setDevices] = useState([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [deviceBusy, setDeviceBusy] = useState(null);

  // Active sessions
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionBusy, setSessionBusy] = useState(null);

  const fetchUser = useCallback(async () => {
    try {
      const data = await api.get(`/api/users/${id}`);
      setUser(data);
      setEditName(data.name || '');
      setEditEmail(data.email || '');
    } catch (err) {
      setError(err.message);
    }
  }, [id]);

  const fetchAccess = useCallback(async () => {
    try {
      const data = await api.get(`/api/users/${id}/access`);
      setApps(data || []);
    } catch {
      // access endpoint may not exist yet
    }
  }, [id]);

  const fetchAllApps = useCallback(async () => {
    try {
      const data = await api.get('/api/apps');
      setAllApps((data || []).filter((a) => a.admin_api));
    } catch {
      // apps endpoint may not exist yet
    }
  }, []);

  const fetchAllGroups = useCallback(async () => {
    try {
      const data = await api.get('/api/groups');
      setAllGroups(data || []);
    } catch {
      // groups endpoint may not exist yet
    }
  }, []);

  const fetchDevices = useCallback(async () => {
    setDevicesLoading(true);
    try {
      const data = await api.get(`/api/users/${id}/devices`);
      setDevices(data || []);
    } catch {
      setDevices([]);
    } finally {
      setDevicesLoading(false);
    }
  }, [id]);

  const fetchSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const data = await api.get(`/api/users/${id}/sessions`);
      setSessions(data || []);
    } catch {
      setSessions([]);
    } finally {
      setSessionsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchUser(),
      fetchAccess(),
      fetchAllApps(),
      fetchAllGroups(),
      fetchDevices(),
      fetchSessions(),
    ]).finally(() => setLoading(false));
  }, [fetchUser, fetchAccess, fetchAllApps, fetchAllGroups, fetchDevices, fetchSessions]);

  useEffect(() => {
    let cancelled = false;
    api
      .get('/api/me')
      .then((me) => {
        if (!cancelled) setImpersonationEnabled(!!me?.features?.impersonation);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSaveEdit = async () => {
    setSaveLoading(true);
    try {
      await api.patch(`/api/users/${id}`, { name: editName, email: editEmail });
      await fetchUser();
      setEditing(false);
      toast.success('User updated');
    } catch (err) {
      toastError(err);
      setError(err.message);
    } finally {
      setSaveLoading(false);
    }
  };

  const handleToggleActive = async () => {
    if (!user) return;
    setToggleLoading(true);
    try {
      const next = !user.is_active;
      await api.patch(`/api/users/${id}`, { is_active: next });
      await fetchUser();
      toast.success(next ? 'User enabled' : 'User disabled');
    } catch (err) {
      toastError(err);
      setError(err.message);
    } finally {
      setToggleLoading(false);
    }
  };

  const handleImpersonate = async () => {
    setImpersonateLoading(true);
    try {
      const res = await api.post(`/api/users/${id}/impersonate`, {
        reason: impersonateReason.trim() || undefined,
      });
      if (!res?.url) throw new Error('No impersonation URL returned');
      toast.success(`Impersonating ${res.target?.username || 'user'}…`);
      window.location.href = res.url;
    } catch (err) {
      toastError(err);
      setImpersonateLoading(false);
    }
  };

  const handleDelete = async () => {
    setDeleteLoading(true);
    try {
      await api.delete(`/api/users/${id}`);
      toast.success('User deleted');
      navigate('/users');
    } catch (err) {
      toastError(err);
      setError(err.message);
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleGenerateRecovery = async () => {
    setRecoveryLoading(true);
    setRecoveryLink(null);
    setEmailSent(null);
    try {
      const data = await api.post(`/api/users/${id}/recovery`);
      setRecoveryLink(data.recovery_link);
      toast.success('Recovery link generated');
    } catch (err) {
      toastError(err);
      setError(err.message);
    } finally {
      setRecoveryLoading(false);
    }
  };

  const handleEmailRecovery = async () => {
    setEmailLoading(true);
    setEmailSent(null);
    try {
      const data = await api.post(`/api/users/${id}/recovery`, { send_email: true });
      setRecoveryLink(data.recovery_link);
      setEmailSent(data.email_sent);
      if (data.email_sent) toast.success(`Recovery link emailed to ${user.email}`);
      else toast.warning('Email failed — copy link manually');
    } catch (err) {
      toastError(err);
      setError(err.message);
    } finally {
      setEmailLoading(false);
    }
  };

  const handleRemoveGroup = async (groupName) => {
    try {
      await api.delete(`/api/users/${id}/groups/${encodeURIComponent(groupName)}`);
      await fetchUser();
      toast.success(`Removed from ${groupName}`);
    } catch (err) {
      toastError(err);
      setError(err.message);
    }
  };

  const handleAddGroup = async () => {
    if (!addGroup) return;
    try {
      await api.post(`/api/users/${id}/groups`, { group: addGroup });
      const name = addGroup;
      setAddGroup('');
      await fetchUser();
      toast.success(`Added to ${name}`);
    } catch (err) {
      toastError(err);
      setError(err.message);
    }
  };

  const handleDeleteDevice = async (device) => {
    if (!device?.kind) {
      toastError(new Error('This device type cannot be removed from here.'));
      return;
    }
    const label = device.name || device.verbose_name || device.kind;
    if (!window.confirm(`Remove authenticator "${label}"?`)) return;
    setDeviceBusy(device.pk);
    try {
      await api.delete(`/api/users/${id}/devices/${device.kind}/${encodeURIComponent(device.pk)}`);
      await fetchDevices();
      toast.success(`Removed ${label}`);
    } catch (err) {
      toastError(err);
    } finally {
      setDeviceBusy(null);
    }
  };

  const handleRevokeSession = async (session) => {
    if (!window.confirm('Revoke this session? The user will be signed out from that device.')) return;
    setSessionBusy(session.uuid);
    try {
      await api.delete(`/api/users/${id}/sessions/${encodeURIComponent(session.uuid)}`);
      await fetchSessions();
      toast.success('Session revoked');
    } catch (err) {
      toastError(err);
    } finally {
      setSessionBusy(null);
    }
  };

  const handleRevokeAllSessions = async () => {
    if (sessions.length === 0) return;
    if (!window.confirm(`Revoke all ${sessions.length} session(s)? The user will be signed out everywhere.`))
      return;
    setSessionBusy('all');
    try {
      const results = await Promise.allSettled(
        sessions.map((s) =>
          api.delete(`/api/users/${id}/sessions/${encodeURIComponent(s.uuid)}`)
        )
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      await fetchSessions();
      if (failed === 0) toast.success('All sessions revoked');
      else toast.warning(`Revoked ${results.length - failed}/${results.length} sessions`);
    } catch (err) {
      toastError(err);
    } finally {
      setSessionBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="w-32 h-6 bg-surface-container rounded animate-pulse" />
        <div className="h-48 bg-surface-container rounded-xl animate-pulse" />
      </div>
    );
  }

  if (error && !user) {
    return (
      <div className="space-y-4">
        <button onClick={() => navigate('/users')} className="flex items-center gap-1 text-sm text-on-surface-variant hover:text-on-surface transition-colors">
          <span className="material-symbols-outlined text-[18px]">arrow_back</span>
          Back to Users
        </button>
        <div className="flex items-center gap-2 p-4 bg-error-container/20 border border-error/20 rounded-xl">
          <span className="material-symbols-outlined text-error text-[20px]">error</span>
          <p className="text-sm text-error">{error}</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  const availableGroups = allGroups.filter(
    (g) => !(user.groups || []).includes(g.name)
  );

  return (
    <div className="space-y-8">
      {/* Back button */}
      <button
        onClick={() => navigate('/users')}
        className="flex items-center gap-1 text-sm text-on-surface-variant hover:text-on-surface transition-colors"
      >
        <span className="material-symbols-outlined text-[18px]">arrow_back</span>
        Back to Users
      </button>

      {/* User info card */}
      <div className="p-6 border border-outline-variant/40 rounded-xl bg-surface-container-lowest">
        <div className="flex items-start gap-5">
          <Avatar name={user.name || user.username} email={user.email} size="xl" />
          <div className="flex-1 min-w-0">
            {editing ? (
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-on-surface-variant mb-1 block">Name</label>
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-surface-container-low border border-outline-variant/40 rounded-lg
                               text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-on-surface-variant mb-1 block">Email</label>
                  <input
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-surface-container-low border border-outline-variant/40 rounded-lg
                               text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleSaveEdit}
                    disabled={saveLoading}
                    className="px-4 py-2 text-sm font-medium bg-primary text-on-primary rounded-lg
                               hover:bg-primary-dim disabled:opacity-50 transition-colors"
                  >
                    {saveLoading ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    onClick={() => {
                      setEditing(false);
                      setEditName(user.name || '');
                      setEditEmail(user.email || '');
                    }}
                    className="px-4 py-2 text-sm text-on-surface-variant hover:text-on-surface transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3 flex-wrap">
                  <h2 className="font-heading text-xl font-bold text-on-surface">{user.name}</h2>
                  {user.is_active === false && (
                    <span className="px-2 py-0.5 text-[10px] font-medium bg-error-container/40 text-error rounded">
                      DISABLED
                    </span>
                  )}
                  <button
                    onClick={() => setEditing(true)}
                    className="p-1 rounded-lg hover:bg-surface-container-high transition-colors"
                  >
                    <span className="material-symbols-outlined text-on-surface-variant text-[18px]">edit</span>
                  </button>
                  <div className="flex items-center gap-2 ml-auto">
                    <button
                      onClick={handleToggleActive}
                      disabled={toggleLoading}
                      className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-surface-container-high text-on-surface rounded-lg
                                 hover:bg-surface-container-highest disabled:opacity-50 transition-colors"
                      title={user.is_active ? 'Disable this user' : 'Enable this user'}
                    >
                      <span className="material-symbols-outlined text-[15px]">
                        {user.is_active ? 'block' : 'check_circle'}
                      </span>
                      {toggleLoading ? 'Saving…' : user.is_active ? 'Disable' : 'Enable'}
                    </button>
                    {impersonationEnabled && (
                      <button
                        onClick={() => {
                          setImpersonateReason('');
                          setImpersonateOpen(true);
                        }}
                        className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-tertiary-container text-on-tertiary-container rounded-lg
                                   hover:bg-tertiary-container/80 transition-colors"
                        title="Impersonate this user (audit-logged)"
                      >
                        <span className="material-symbols-outlined text-[15px]">swap_horiz</span>
                        Impersonate
                      </button>
                    )}
                    <button
                      onClick={handleGenerateRecovery}
                      disabled={recoveryLoading || emailLoading}
                      className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-secondary text-on-secondary rounded-lg
                                 hover:bg-secondary-dim disabled:opacity-50 transition-colors"
                    >
                      <span className="material-symbols-outlined text-[15px]">lock_reset</span>
                      {recoveryLoading ? 'Generating…' : 'Reset Password'}
                    </button>
                    <button
                      onClick={handleEmailRecovery}
                      disabled={recoveryLoading || emailLoading}
                      className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-secondary text-on-secondary rounded-lg
                                 hover:bg-secondary-dim disabled:opacity-50 transition-colors"
                    >
                      <span className="material-symbols-outlined text-[15px]">forward_to_inbox</span>
                      {emailLoading ? 'Sending…' : 'Reset & Email'}
                    </button>
                  </div>
                </div>
                {recoveryLink && (
                  <div className="mt-3 p-3 bg-primary-container/30 border border-primary/20 rounded-lg">
                    {emailSent === true && (
                      <p className="text-xs text-primary-dim mb-1">Recovery link emailed to {user.email}</p>
                    )}
                    {emailSent === false && (
                      <p className="text-xs text-error mb-1">Email failed — copy and send this manually:</p>
                    )}
                    {emailSent === null && (
                      <p className="text-xs text-on-surface-variant mb-1">Recovery link — send this to the user:</p>
                    )}
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-xs text-on-surface break-all select-all">{recoveryLink}</code>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(recoveryLink, { successMessage: 'Recovery link copied' })}
                        className="shrink-0 inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-surface-container-low text-on-surface rounded-lg hover:bg-surface-container-high transition-colors"
                        title="Copy recovery link"
                      >
                        <span className="material-symbols-outlined text-[14px]">content_copy</span>
                        Copy
                      </button>
                    </div>
                  </div>
                )}
                <p className="text-sm text-on-surface-variant mt-0.5">{user.email}</p>
                <div className="flex items-center gap-4 mt-2 text-xs text-on-surface-variant flex-wrap">
                  <span>@{user.username}</span>
                  <span>Last login: {relativeTime(user.last_login)}</span>
                  <span title={user.password_change_date || 'No record on file'}>
                    Password changed: {relativeTime(user.password_change_date)}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-error-container/20 border border-error/20 rounded-xl">
          <span className="material-symbols-outlined text-error text-[18px]">error</span>
          <p className="text-sm text-error">{error}</p>
        </div>
      )}

      {/* App Access section */}
      <section>
        <h3 className="font-heading text-lg font-semibold text-on-surface mb-4">App Access</h3>
        <AppAccessGrid apps={apps} userId={id} onUpdate={fetchAccess} />
      </section>

      {/* Groups section */}
      <section>
        <h3 className="font-heading text-lg font-semibold text-on-surface mb-4">Groups</h3>
        <div className="p-4 border border-outline-variant/40 rounded-xl bg-surface-container-lowest">
          <div className="flex flex-wrap gap-2 mb-4">
            {(user.groups || []).length === 0 ? (
              <p className="text-sm text-on-surface-variant">No groups assigned</p>
            ) : (
              (user.groups || []).map((g) => (
                <GroupBadge key={g} name={g} onRemove={() => handleRemoveGroup(g)} />
              ))
            )}
          </div>
          <div className="flex gap-2">
            <select
              value={addGroup}
              onChange={(e) => setAddGroup(e.target.value)}
              className="flex-1 px-3 py-2 text-sm bg-surface-container-low border border-outline-variant/40 rounded-lg
                         text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
            >
              <option value="">Add to group…</option>
              {availableGroups.map((g) => (
                <option key={g.name} value={g.name}>
                  {g.name}
                </option>
              ))}
            </select>
            <button
              onClick={handleAddGroup}
              disabled={!addGroup}
              className="px-4 py-2 text-sm font-medium bg-secondary text-on-secondary rounded-lg
                         hover:bg-secondary-dim disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Add
            </button>
          </div>
        </div>
      </section>

      {/* Authenticators (MFA) */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-heading text-lg font-semibold text-on-surface">Authenticators</h3>
          <span className="text-xs text-on-surface-variant">
            {devicesLoading ? 'Loading…' : `${devices.length} device${devices.length === 1 ? '' : 's'}`}
          </span>
        </div>
        <div className="border border-outline-variant/40 rounded-xl bg-surface-container-lowest divide-y divide-outline-variant/30">
          {devicesLoading ? (
            <div className="p-4 text-sm text-on-surface-variant">Loading…</div>
          ) : devices.length === 0 ? (
            <div className="p-4 text-sm text-on-surface-variant">
              No authenticators registered. The user can enrol from their Authentik profile.
            </div>
          ) : (
            devices.map((d) => (
              <div key={`${d.kind || 'unknown'}:${d.pk}`} className="flex items-center gap-3 p-3">
                <span className="material-symbols-outlined text-on-surface-variant text-[20px]">
                  {d.kind === 'webauthn' ? 'key' : d.kind === 'totp' ? 'mobile_friendly' : d.kind === 'static' ? 'pin' : 'security'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-on-surface flex items-center gap-2">
                    <span className="truncate">{d.name || d.verbose_name || d.kind || 'Device'}</span>
                    {d.confirmed === false && (
                      <span className="px-1.5 py-0.5 text-[10px] font-medium bg-warning-container/40 text-warning rounded">
                        UNCONFIRMED
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-on-surface-variant flex flex-wrap gap-x-3">
                    <span className="uppercase tracking-wide">{d.kind || 'unknown'}</span>
                    <span>Created {relativeTime(d.created)}</span>
                    {d.last_used && <span>Last used {relativeTime(d.last_used)}</span>}
                  </div>
                </div>
                <button
                  onClick={() => handleDeleteDevice(d)}
                  disabled={deviceBusy === d.pk || !d.kind}
                  title={d.kind ? 'Remove this authenticator' : 'Unsupported device type'}
                  className="px-3 py-1 text-xs font-medium bg-error-container/40 text-error rounded-lg
                             hover:bg-error-container/60 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {deviceBusy === d.pk ? 'Removing…' : 'Remove'}
                </button>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Active sessions */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-heading text-lg font-semibold text-on-surface">Active sessions</h3>
          <div className="flex items-center gap-3">
            <span className="text-xs text-on-surface-variant">
              {sessionsLoading ? 'Loading…' : `${sessions.length} session${sessions.length === 1 ? '' : 's'}`}
            </span>
            {sessions.length > 0 && (
              <button
                onClick={handleRevokeAllSessions}
                disabled={sessionBusy === 'all'}
                className="px-3 py-1 text-xs font-medium bg-error-container/40 text-error rounded-lg
                           hover:bg-error-container/60 disabled:opacity-40 transition-colors"
              >
                {sessionBusy === 'all' ? 'Revoking…' : 'Revoke all'}
              </button>
            )}
          </div>
        </div>
        <div className="border border-outline-variant/40 rounded-xl bg-surface-container-lowest divide-y divide-outline-variant/30">
          {sessionsLoading ? (
            <div className="p-4 text-sm text-on-surface-variant">Loading…</div>
          ) : sessions.length === 0 ? (
            <div className="p-4 text-sm text-on-surface-variant">No active sessions.</div>
          ) : (
            sessions.map((s) => (
              <div key={s.uuid} className="flex items-center gap-3 p-3">
                <span className="material-symbols-outlined text-on-surface-variant text-[20px]">
                  {s.device === 'iPhone' || s.os === 'iOS' || s.os === 'Android'
                    ? 'smartphone'
                    : 'computer'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-on-surface flex items-center gap-2">
                    <span className="truncate">
                      {[s.user_agent, s.os].filter(Boolean).join(' · ') || 'Unknown client'}
                    </span>
                    {s.current && (
                      <span className="px-1.5 py-0.5 text-[10px] font-medium bg-primary-container/40 text-primary rounded">
                        CURRENT
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-on-surface-variant flex flex-wrap gap-x-3">
                    {s.last_ip && <span>{s.last_ip}</span>}
                    {s.geo && <span>{s.geo}</span>}
                    {s.last_used && <span>Last seen {relativeTime(s.last_used)}</span>}
                    {s.expires && <span>Expires {relativeTime(s.expires)}</span>}
                  </div>
                </div>
                <button
                  onClick={() => handleRevokeSession(s)}
                  disabled={sessionBusy === s.uuid || sessionBusy === 'all'}
                  className="px-3 py-1 text-xs font-medium bg-error-container/40 text-error rounded-lg
                             hover:bg-error-container/60 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {sessionBusy === s.uuid ? 'Revoking…' : 'Revoke'}
                </button>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Per-app Permissions */}
      {allApps.length > 0 && (
        <section>
          <h3 className="font-heading text-lg font-semibold text-on-surface mb-4">App Permissions</h3>
          <div className="space-y-3">
            {allApps.map((app) => (
              <AppPermEditor
                key={app.slug}
                appSlug={app.slug}
                appName={app.name}
                userSub={user.uid}
              />
            ))}
          </div>
        </section>
      )}

      {/* Danger Zone */}
      <section>
        <h3 className="font-heading text-lg font-semibold text-error mb-4">Danger Zone</h3>
        <div className="p-4 border border-error/30 rounded-xl">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-on-surface">Delete this user</p>
              <p className="text-xs text-on-surface-variant mt-0.5">
                This action cannot be undone. All user data will be permanently removed.
              </p>
            </div>
            <button
              onClick={() => setDeleteOpen(true)}
              className="px-4 py-2 text-sm font-medium bg-error text-on-error rounded-lg
                         hover:bg-error-dim transition-colors shrink-0"
            >
              Delete User
            </button>
          </div>
        </div>
      </section>

      {/* Delete confirmation modal */}
      <Modal
        isOpen={deleteOpen}
        onClose={() => {
          setDeleteOpen(false);
          setDeleteConfirm('');
        }}
        title="Delete User"
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
              disabled={deleteConfirm !== user.username || deleteLoading}
              className="px-4 py-2 text-sm font-medium bg-error text-on-error rounded-lg
                         hover:bg-error-dim disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {deleteLoading ? 'Deleting…' : 'Delete'}
            </button>
          </>
        }
      >
        <p className="text-sm text-on-surface mb-4">
          This will permanently delete <strong>{user.name}</strong> and all associated data. This action
          cannot be undone.
        </p>
        <label className="text-xs font-medium text-on-surface-variant mb-1.5 block">
          Type <strong>{user.username}</strong> to confirm
        </label>
        <input
          value={deleteConfirm}
          onChange={(e) => setDeleteConfirm(e.target.value)}
          placeholder={user.username}
          className="w-full px-3 py-2 text-sm bg-surface-container-low border border-outline-variant/40 rounded-lg
                     text-on-surface focus:outline-none focus:border-error focus:ring-1 focus:ring-error/30"
        />
      </Modal>

      <Modal
        open={impersonateOpen}
        onClose={() => {
          if (!impersonateLoading) {
            setImpersonateOpen(false);
            setImpersonateReason('');
          }
        }}
        title="Impersonate user"
        actions={
          <>
            <button
              onClick={() => {
                setImpersonateOpen(false);
                setImpersonateReason('');
              }}
              disabled={impersonateLoading}
              className="px-4 py-2 text-sm text-on-surface-variant hover:text-on-surface transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleImpersonate}
              disabled={impersonateLoading}
              className="px-4 py-2 text-sm font-medium bg-tertiary text-on-tertiary rounded-lg
                         hover:bg-tertiary/90 disabled:opacity-40 transition-colors"
            >
              {impersonateLoading ? 'Starting…' : `Impersonate ${user.username}`}
            </button>
          </>
        }
      >
        <p className="text-sm text-on-surface mb-3">
          You will start a new session as <strong>{user.name || user.username}</strong>. Every page
          you visit will see <em>their</em> permissions, not yours. This action is recorded in the
          audit log.
        </p>
        <p className="text-xs text-on-surface-variant mb-4">
          To stop impersonating, visit <code className="font-mono">/-/impersonation/end/</code> on
          the auth server (or sign out and back in).
        </p>
        <label className="text-xs font-medium text-on-surface-variant mb-1.5 block">
          Reason <span className="text-on-surface-variant/60">(optional, logged)</span>
        </label>
        <input
          value={impersonateReason}
          onChange={(e) => setImpersonateReason(e.target.value)}
          placeholder="e.g. debugging access issue reported in #support"
          maxLength={256}
          className="w-full px-3 py-2 text-sm bg-surface-container-low border border-outline-variant/40 rounded-lg
                     text-on-surface focus:outline-none focus:border-tertiary focus:ring-1 focus:ring-tertiary/30"
        />
      </Modal>
    </div>
  );
}
