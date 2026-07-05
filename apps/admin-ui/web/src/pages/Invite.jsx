import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import GroupBadge from '../components/GroupBadge';
import { toast, toastError, copyToClipboard } from '../lib/toast';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Delivery options:
//   'email'   — generate a setup link AND email it to the user (recommended)
//   'manual'  — generate a setup link and show it to the admin to share manually
//   'none'    — create the account with no setup link (rarely needed; admin must
//               trigger a recovery link later from the user detail page)
const DELIVERY_OPTIONS = [
  {
    value: 'email',
    label: 'Email a setup link to the user',
    help: 'Recommended. Sends an email with a one-time link so the user can set their own password.',
  },
  {
    value: 'manual',
    label: 'Show me the link to share manually',
    help: 'Generates a one-time setup link and displays it here so you can copy and send it yourself.',
  },
  {
    value: 'none',
    label: "Don't generate a link now",
    help: 'Creates the account with no password. You can send a setup link later from the user\'s page.',
  },
];

function blankForm() {
  return { email: '', username: '', name: '', groups: [] };
}

export default function Invite() {
  const navigate = useNavigate();
  const [mode, setMode] = useState('single'); // 'single' | 'bulk'
  const [form, setForm] = useState(blankForm());
  const [bulkText, setBulkText] = useState('');
  const [bulkGroups, setBulkGroups] = useState([]);
  const [bulkGroupDropdown, setBulkGroupDropdown] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [delivery, setDelivery] = useState('email');
  const [allGroups, setAllGroups] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [bulkResults, setBulkResults] = useState(null);
  const [groupDropdown, setGroupDropdown] = useState('');

  useEffect(() => {
    api
      .get('/api/groups')
      .then((data) => setAllGroups(data || []))
      .catch(() => {});
  }, []);

  const handleChange = (field) => (e) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
    setError(null);
    setSuccess(null);
  };

  const addGroup = () => {
    if (!groupDropdown || form.groups.includes(groupDropdown)) return;
    setForm((prev) => ({ ...prev, groups: [...prev.groups, groupDropdown] }));
    setGroupDropdown('');
  };
  const removeGroup = (name) => {
    setForm((prev) => ({ ...prev, groups: prev.groups.filter((g) => g !== name) }));
  };

  const addBulkGroup = () => {
    if (!bulkGroupDropdown || bulkGroups.includes(bulkGroupDropdown)) return;
    setBulkGroups((prev) => [...prev, bulkGroupDropdown]);
    setBulkGroupDropdown('');
  };
  const removeBulkGroup = (name) => {
    setBulkGroups((prev) => prev.filter((g) => g !== name));
  };

  const availableGroups = allGroups
    .map((g) => g.name)
    .filter((g) => !form.groups.includes(g));
  const availableBulkGroups = allGroups
    .map((g) => g.name)
    .filter((g) => !bulkGroups.includes(g));

  const buildPayload = (data, groups) => ({
    email: data.email.trim(),
    username: data.username?.trim() || undefined,
    name: data.name?.trim() || undefined,
    groups,
    send_recovery: delivery !== 'none',
    send_email: delivery === 'email',
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.email.trim()) {
      setError('Email is required.');
      return;
    }
    if (!EMAIL_RE.test(form.email.trim())) {
      setError('Please enter a valid email address.');
      return;
    }
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await api.post('/api/users', buildPayload(form, form.groups));
      setSuccess(result);
      toast.success(`Invited ${result.user?.email || form.email.trim()}`);
      setForm(blankForm());
    } catch (err) {
      toastError(err);
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleBulkSubmit = async (e) => {
    e.preventDefault();
    const lines = bulkText
      .split(/[\n,;]+/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      setError('Enter at least one email address.');
      return;
    }
    const invalid = lines.filter((l) => !EMAIL_RE.test(l));
    if (invalid.length > 0) {
      setError(`Invalid email${invalid.length > 1 ? 's' : ''}: ${invalid.slice(0, 3).join(', ')}${invalid.length > 3 ? '…' : ''}`);
      return;
    }

    setSubmitting(true);
    setError(null);
    setBulkResults(null);

    const results = [];
    for (const email of lines) {
      try {
        const result = await api.post('/api/users', buildPayload({ email }, bulkGroups));
        results.push({ email, ok: true, ...result });
      } catch (err) {
        results.push({ email, ok: false, error: err.message });
      }
    }

    setBulkResults(results);
    const okCount = results.filter((r) => r.ok).length;
    if (okCount > 0) toast.success(`Invited ${okCount}/${results.length} user${results.length > 1 ? 's' : ''}`);
    if (okCount < results.length) toast.error(`${results.length - okCount} failed`);
    setBulkText('');
    setSubmitting(false);
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="font-heading text-2xl font-bold text-on-surface">Invite User</h1>
        <div className="inline-flex p-1 bg-surface-container-low rounded-xl">
          {[
            { value: 'single', label: 'Single', icon: 'person_add' },
            { value: 'bulk', label: 'Bulk', icon: 'group_add' },
          ].map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                setMode(opt.value);
                setError(null);
                setSuccess(null);
                setBulkResults(null);
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                mode === opt.value
                  ? 'bg-primary text-on-primary'
                  : 'text-on-surface-variant hover:bg-surface-container'
              }`}
            >
              <span className="material-symbols-outlined text-[15px]">{opt.icon}</span>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Single-invite success */}
      {mode === 'single' && success && (
        <div className="p-4 bg-primary-container/30 border border-primary/20 rounded-xl">
          <div className="flex items-center gap-2 mb-2">
            <span className="material-symbols-outlined text-primary-dim text-[20px]">check_circle</span>
            <p className="text-sm font-medium text-on-surface">
              User created
              {success.email_sent && ' — setup link emailed'}
              {success.email_sent === false && ' — email failed, copy link below'}
            </p>
          </div>
          {success.recovery_link && !success.email_sent ? (
            <div className="mt-2">
              <p className="text-xs text-on-surface-variant mb-1">Setup link (send this to the user):</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 p-3 bg-surface-container-low rounded-lg text-xs text-on-surface break-all select-all">
                  {success.recovery_link}
                </code>
                <button
                  type="button"
                  onClick={() => copyToClipboard(success.recovery_link, { successMessage: 'Setup link copied' })}
                  className="shrink-0 inline-flex items-center gap-1 px-3 py-2 text-xs font-medium bg-surface-container-low text-on-surface rounded-lg hover:bg-surface-container-high transition-colors"
                >
                  <span className="material-symbols-outlined text-[14px]">content_copy</span>
                  Copy
                </button>
              </div>
            </div>
          ) : success.temporary_password ? (
            <div className="mt-2">
              <p className="text-xs text-on-surface-variant mb-1">Temporary password (send this to the user):</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 p-3 bg-surface-container-low rounded-lg text-xs text-on-surface break-all select-all">
                  {success.temporary_password}
                </code>
                <button
                  type="button"
                  onClick={() => copyToClipboard(success.temporary_password, { successMessage: 'Password copied' })}
                  className="shrink-0 inline-flex items-center gap-1 px-3 py-2 text-xs font-medium bg-surface-container-low text-on-surface rounded-lg hover:bg-surface-container-high transition-colors"
                >
                  <span className="material-symbols-outlined text-[14px]">content_copy</span>
                  Copy
                </button>
              </div>
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            {success.user?.id && (
              <button
                type="button"
                onClick={() => navigate(`/users/${success.user.id}`)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-on-primary rounded-lg hover:bg-primary-dim transition-colors"
              >
                <span className="material-symbols-outlined text-[15px]">arrow_forward</span>
                View user
              </button>
            )}
            <button
              type="button"
              onClick={() => setSuccess(null)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-secondary text-on-secondary rounded-lg hover:bg-secondary-dim transition-colors"
            >
              <span className="material-symbols-outlined text-[15px]">person_add</span>
              Invite another
            </button>
          </div>
        </div>
      )}

      {/* Bulk results */}
      {mode === 'bulk' && bulkResults && (
        <div className="p-4 bg-primary-container/30 border border-primary/20 rounded-xl space-y-2">
          <p className="text-sm font-medium text-on-surface">
            Invited {bulkResults.filter((r) => r.ok).length} / {bulkResults.length}
          </p>
          <ul className="text-xs space-y-1 max-h-48 overflow-y-auto">
            {bulkResults.map((r) => (
              <li key={r.email} className="flex items-center gap-2">
                <span
                  className={`material-symbols-outlined text-[16px] ${
                    r.ok ? 'text-primary-dim' : 'text-error'
                  }`}
                >
                  {r.ok ? 'check_circle' : 'error'}
                </span>
                <span className="text-on-surface">{r.email}</span>
                {!r.ok && <span className="text-error">— {r.error}</span>}
                {r.ok && r.recovery_link && !r.email_sent && (
                  <button
                    type="button"
                    onClick={() => copyToClipboard(r.recovery_link, { successMessage: 'Link copied' })}
                    className="ml-auto text-primary-dim hover:underline"
                  >
                    copy link
                  </button>
                )}
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setBulkResults(null)}
            className="text-xs text-on-surface-variant hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Single-invite form */}
      {mode === 'single' && (
        <form onSubmit={handleSubmit} className="p-6 border border-outline-variant/40 rounded-xl bg-surface-container-lowest space-y-5">
          <div>
            <label className="text-sm font-medium text-on-surface mb-1.5 block">
              Email <span className="text-error">*</span>
            </label>
            <input
              type="email"
              value={form.email}
              onChange={handleChange('email')}
              placeholder="john@example.com"
              autoFocus
              className="w-full px-3 py-2.5 text-sm bg-surface-container-low border border-outline-variant/40 rounded-xl
                         text-on-surface placeholder:text-outline
                         focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors"
            />
            <p className="text-xs text-on-surface-variant mt-1.5">
              The user will receive a setup link and choose their own password. They can update their display name later in their profile.
            </p>
          </div>

          {/* Groups */}
          <div>
            <label className="text-sm font-medium text-on-surface mb-1.5 block">Groups</label>
            {form.groups.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {form.groups.map((g) => (
                  <GroupBadge key={g} name={g} onRemove={() => removeGroup(g)} />
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <select
                value={groupDropdown}
                onChange={(e) => setGroupDropdown(e.target.value)}
                className="flex-1 px-3 py-2.5 text-sm bg-surface-container-low border border-outline-variant/40 rounded-xl
                           text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
              >
                <option value="">Select a group…</option>
                {availableGroups.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={addGroup}
                disabled={!groupDropdown}
                className="px-4 py-2.5 text-sm font-medium bg-secondary text-on-secondary rounded-xl
                           hover:bg-secondary-dim disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Add
              </button>
            </div>
          </div>

          {/* Delivery */}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-on-surface mb-1.5">How should they get their setup link?</legend>
            {DELIVERY_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                  delivery === opt.value
                    ? 'border-primary/60 bg-primary-container/20'
                    : 'border-outline-variant/40 hover:bg-surface-container-low'
                }`}
              >
                <input
                  type="radio"
                  name="delivery"
                  value={opt.value}
                  checked={delivery === opt.value}
                  onChange={(e) => setDelivery(e.target.value)}
                  className="mt-0.5 w-4 h-4 text-primary focus:ring-primary/30"
                />
                <div className="flex-1">
                  <p className="text-sm font-medium text-on-surface">{opt.label}</p>
                  <p className="text-xs text-on-surface-variant mt-0.5">{opt.help}</p>
                </div>
              </label>
            ))}
          </fieldset>

          {/* Advanced */}
          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-on-surface-variant hover:text-on-surface transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">
                {showAdvanced ? 'expand_less' : 'expand_more'}
              </span>
              Advanced (optional)
            </button>
            {showAdvanced && (
              <div className="mt-3 space-y-4 pl-2 border-l-2 border-outline-variant/30">
                <div>
                  <label className="text-sm font-medium text-on-surface mb-1.5 block">Username</label>
                  <input
                    value={form.username}
                    onChange={handleChange('username')}
                    placeholder="auto-generated from email"
                    className="w-full px-3 py-2.5 text-sm bg-surface-container-low border border-outline-variant/40 rounded-xl
                               text-on-surface placeholder:text-outline
                               focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors"
                  />
                  <p className="text-xs text-on-surface-variant mt-1">
                    Leave blank to derive from the email address. Usernames cannot be changed later.
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium text-on-surface mb-1.5 block">Full name</label>
                  <input
                    value={form.name}
                    onChange={handleChange('name')}
                    placeholder="set by the user during signup"
                    className="w-full px-3 py-2.5 text-sm bg-surface-container-low border border-outline-variant/40 rounded-xl
                               text-on-surface placeholder:text-outline
                               focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors"
                  />
                  <p className="text-xs text-on-surface-variant mt-1">
                    Leave blank — the user can set their display name from their profile after signing in.
                  </p>
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-error-container/20 border border-error/20 rounded-xl">
              <span className="material-symbols-outlined text-error text-[18px]">error</span>
              <p className="text-sm text-error">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 text-sm font-medium bg-primary text-on-primary rounded-xl
                       hover:bg-primary-dim disabled:opacity-50 transition-colors"
          >
            {submitting ? 'Sending invite…' : 'Send invite'}
          </button>
        </form>
      )}

      {/* Bulk-invite form */}
      {mode === 'bulk' && (
        <form onSubmit={handleBulkSubmit} className="p-6 border border-outline-variant/40 rounded-xl bg-surface-container-lowest space-y-5">
          <div>
            <label className="text-sm font-medium text-on-surface mb-1.5 block">
              Email addresses <span className="text-error">*</span>
            </label>
            <textarea
              value={bulkText}
              onChange={(e) => {
                setBulkText(e.target.value);
                setError(null);
              }}
              rows={6}
              placeholder={'alice@example.com\nbob@example.com\ncarol@example.com'}
              className="w-full px-3 py-2.5 text-sm bg-surface-container-low border border-outline-variant/40 rounded-xl
                         text-on-surface placeholder:text-outline font-mono
                         focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors"
            />
            <p className="text-xs text-on-surface-variant mt-1.5">
              One email per line — or separate with commas/semicolons. Each user gets the same groups and delivery option below.
            </p>
          </div>

          <div>
            <label className="text-sm font-medium text-on-surface mb-1.5 block">Groups (applied to all)</label>
            {bulkGroups.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {bulkGroups.map((g) => (
                  <GroupBadge key={g} name={g} onRemove={() => removeBulkGroup(g)} />
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <select
                value={bulkGroupDropdown}
                onChange={(e) => setBulkGroupDropdown(e.target.value)}
                className="flex-1 px-3 py-2.5 text-sm bg-surface-container-low border border-outline-variant/40 rounded-xl
                           text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
              >
                <option value="">Select a group…</option>
                {availableBulkGroups.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={addBulkGroup}
                disabled={!bulkGroupDropdown}
                className="px-4 py-2.5 text-sm font-medium bg-secondary text-on-secondary rounded-xl
                           hover:bg-secondary-dim disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Add
              </button>
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-on-surface mb-1.5">How should they get their setup link?</legend>
            {DELIVERY_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                  delivery === opt.value
                    ? 'border-primary/60 bg-primary-container/20'
                    : 'border-outline-variant/40 hover:bg-surface-container-low'
                }`}
              >
                <input
                  type="radio"
                  name="delivery-bulk"
                  value={opt.value}
                  checked={delivery === opt.value}
                  onChange={(e) => setDelivery(e.target.value)}
                  className="mt-0.5 w-4 h-4 text-primary focus:ring-primary/30"
                />
                <div className="flex-1">
                  <p className="text-sm font-medium text-on-surface">{opt.label}</p>
                  <p className="text-xs text-on-surface-variant mt-0.5">{opt.help}</p>
                </div>
              </label>
            ))}
          </fieldset>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-error-container/20 border border-error/20 rounded-xl">
              <span className="material-symbols-outlined text-error text-[18px]">error</span>
              <p className="text-sm text-error">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 text-sm font-medium bg-primary text-on-primary rounded-xl
                       hover:bg-primary-dim disabled:opacity-50 transition-colors"
          >
            {submitting ? 'Sending invites…' : 'Send invites'}
          </button>
        </form>
      )}
    </div>
  );
}
