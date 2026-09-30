import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  CheckCircle2,
  Eye,
  KeyRound,
  Loader2,
  LogOut,
  Mail,
  Pause,
  Play,
  ShieldCheck,
  Info,
  LifeBuoy,
  Receipt,
  Sparkles,
  UserRound,
} from 'lucide-react';
import { AppShell } from '../components/app/AppShell';
import { useAuth } from '../lib/auth-context';
import { useAccount } from '../lib/account-context';
import { useToast } from '../components/app/toast-context';
import { ConfirmDialog } from '../components/app/ConfirmDialog';
import { supabase, describeError } from '../lib/supabase';
import { TAP_STATUS_HINTS, TAP_STATUS_LABELS, setTapStatus, tapUrl } from '../services/tap';
import { APP_NAME, APP_VERSION, BUILD_DATE, COMPANY } from '../lib/version';
import { EXPERIENCE_LABELS } from '../services/tap';

/**
 * Account settings.
 *
 * Every control here writes to the real backend: the profile fields update
 * `profiles`, the notification toggle is read by the database trigger that
 * writes shipping notifications, the privacy control moves the Tap's status,
 * and the password actions call Supabase Auth. Nothing on this page is a
 * preference that gets stored and then ignored.
 */
export default function Settings() {
  const navigate = useNavigate();
  const { user, signOut, passwordRecovery, clearPasswordRecovery } = useAuth();
  const { profile, tap, entitlements, editState, loading, refresh, setTap } = useAccount();
  const toast = useToast();

  const [form, setForm] = useState({ full_name: '', phone: '', company: '', job_title: '' });
  const [savingProfile, setSavingProfile] = useState(false);

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(false);

  const [sendingReset, setSendingReset] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  // Both of these adjust state from a value that arrives asynchronously, which
  // React handles during render rather than in an effect — an effect would
  // paint one frame of an empty form first.

  // Arriving from a reset email opens the form straight away, which is the only
  // moment the recovery session is valid.
  const [recoveryHandled, setRecoveryHandled] = useState(false);
  if (passwordRecovery && !recoveryHandled) {
    setRecoveryHandled(true);
    setShowPasswordForm(true);
  }

  const [formFor, setFormFor] = useState<string | null>(null);
  if (profile && formFor !== profile.id) {
    setFormFor(profile.id);
    setForm({
      full_name: profile.full_name ?? '',
      phone: profile.phone ?? '',
      company: profile.company ?? '',
      job_title: profile.job_title ?? '',
    });
  }

  async function saveProfile() {
    if (!user) return;
    setSavingProfile(true);
    try {
      const { error } = await supabase.from('profiles').upsert(
        {
          id: user.id,
          customer_id: user.id,
          email: user.email,
          full_name: form.full_name.trim() || null,
          phone: form.phone.trim() || null,
          company: form.company.trim() || null,
          job_title: form.job_title.trim() || null,
        },
        { onConflict: 'id' },
      );
      if (error) throw error;
      await refresh();
      toast.success('Saved', 'Your account details have been updated.');
    } catch (err) {
      toast.error(
        navigator.onLine === false ? "You're offline" : 'Could not save',
        navigator.onLine === false
          ? "Your changes haven't been saved. Reconnect and try again."
          : describeError(err),
      );
    } finally {
      setSavingProfile(false);
    }
  }

  async function updatePassword() {
    setPasswordError('');
    if (newPassword.length < 8) {
      setPasswordError('Use at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('The two passwords do not match.');
      return;
    }

    setSavingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setNewPassword('');
      setConfirmPassword('');
      setShowPasswordForm(false);
      clearPasswordRecovery();
      toast.success('Password updated', 'Use your new password the next time you sign in.');
    } catch (err) {
      setPasswordError(describeError(err, 'We could not update your password.'));
    } finally {
      setSavingPassword(false);
    }
  }

  async function sendPasswordReset() {
    if (!user?.email) return;
    setSendingReset(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
        redirectTo: `${window.location.origin}/shygontap/settings`,
      });
      if (error) throw error;
      toast.success('Reset email sent', `Check ${user.email} for a link to set a new password.`);
    } catch (err) {
      toast.error('Could not send reset email', describeError(err));
    } finally {
      setSendingReset(false);
    }
  }

  async function setPreference(key: 'notify_order_updates' | 'notify_tap_activity', value: boolean) {
    if (!user) return;
    setSavingPrefs(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ [key]: value })
        .eq('id', user.id);
      if (error) throw error;
      await refresh();
    } catch (err) {
      toast.error('Could not save preference', describeError(err));
    } finally {
      setSavingPrefs(false);
    }
  }

  async function toggleTapVisibility() {
    if (!user || !tap) return;
    const next = tap.status === 'active' ? 'paused' : 'active';
    if (next === 'active' && !tap.slug) {
      toast.error('Claim your Tap address first', 'A Tap needs a public address to go live.');
      return;
    }
    setStatusBusy(true);
    try {
      setTap(await setTapStatus(user.id, next));
      toast.success(
        next === 'active' ? 'Your Tap is live' : 'Tap paused',
        next === 'active'
          ? 'Anyone with your link can see it.'
          : 'Visitors see a "temporarily unavailable" message.',
      );
    } catch (err) {
      toast.error('Could not change visibility', describeError(err));
    } finally {
      setStatusBusy(false);
    }
  }

  async function doSignOut() {
    await signOut();
    navigate('/shygontap');
  }

  const status = tap?.status ?? 'draft';

  // Read off the entitlement the server granted, so the date shown is the one
  // the payment actually produced rather than anything the browser assumed.
  const passRow = entitlements.raw.find((row) => row.type === 'lifetime');
  const passGrantedOn = passRow?.granted_at
    ? new Date(passRow.granted_at).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : null;

  return (
    <AppShell
      eyebrow="Account"
      title="Settings"
      description="Your details, your security and what SHYGON Tap tells you about."
    >
      <div style={{ display: 'grid', gap: 18, maxWidth: 680 }}>
        {passwordRecovery && (
          <section className="panel panel-warning">
            <div className="panel-body" style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <KeyRound size={19} color="var(--ds-color-state-warning)" style={{ flex: '0 0 auto', marginTop: 2 }} />
              <div>
                <strong style={{ fontSize: 14 }}>Set your new password</strong>
                <p style={{ margin: '4px 0 0', color: 'var(--muted)', fontSize: 13 }}>
                  You arrived from a password reset email. Choose a new password below — this link
                  is only valid for a short time.
                </p>
              </div>
            </div>
          </section>
        )}

        {/* ------------------------------------------------------ profile */}
        <section className="panel">
          <div className="panel-head">
            <UserRound size={19} />
            <div>
              <h2>Your details</h2>
              <p>Used on your orders and to prefill delivery details.</p>
            </div>
          </div>
          <div className="panel-body">
            <label className="field">
              <span>Full name</span>
              <input
                className="input"
                value={form.full_name}
                disabled={loading}
                onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
                autoComplete="name"
              />
            </label>
            <label className="field">
              <span>Mobile number</span>
              <input
                className="input"
                value={form.phone}
                disabled={loading}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                autoComplete="tel"
                inputMode="tel"
                aria-describedby="settings-phone-hint"
              />
              <small id="settings-phone-hint" style={{ display: 'block', marginTop: 6, fontSize: 12, color: 'var(--ds-text-tertiary)' }}>
                One-time codes for activating or deactivating your card are sent to this number.
              </small>
            </label>
            <div className="field-row">
              <label className="field">
                <span>Company</span>
                <input
                  className="input"
                  value={form.company}
                  disabled={loading}
                  onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))}
                  autoComplete="organization"
                />
              </label>
              <label className="field">
                <span>Job title</span>
                <input
                  className="input"
                  value={form.job_title}
                  disabled={loading}
                  onChange={(e) => setForm((f) => ({ ...f, job_title: e.target.value }))}
                  autoComplete="organization-title"
                />
              </label>
            </div>
            <p className="field-hint" style={{ marginTop: -6, marginBottom: 14 }}>
              These are your account details. What the public sees lives on your{' '}
              <button
                type="button"
                className="text-button"
                style={{ display: 'inline', color: 'var(--blue)', fontWeight: 700 }}
                onClick={() => navigate('/shygontap/tap')}
              >
                Tap profile
              </button>
              .
            </p>
            <button className="btn btn-blue" onClick={() => void saveProfile()} disabled={savingProfile || loading}>
              {savingProfile ? <Loader2 size={15} className="spin" /> : <CheckCircle2 size={15} />}
              {savingProfile ? 'Saving…' : 'Save details'}
            </button>
          </div>
        </section>

        {/* ----------------------------------------------------- security */}
        <section className="panel">
          <div className="panel-head">
            <ShieldCheck size={19} />
            <div>
              <h2>Security</h2>
              <p>Signed in as {user?.email}</p>
            </div>
          </div>
          <div className="panel-body">
            {showPasswordForm ? (
              <>
                <label className="field">
                  <span>New password</span>
                  <input
                    className="input"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoComplete="new-password"
                    placeholder="At least 8 characters"
                  />
                </label>
                <label className="field">
                  <span>Confirm new password</span>
                  <input
                    className="input"
                    type="password"
                    value={confirmPassword}
                    aria-invalid={Boolean(passwordError)}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                  {passwordError && <p className="field-error">{passwordError}</p>}
                </label>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <button className="btn btn-blue" onClick={() => void updatePassword()} disabled={savingPassword}>
                    {savingPassword ? <Loader2 size={15} className="spin" /> : <KeyRound size={15} />}
                    {savingPassword ? 'Updating…' : 'Update password'}
                  </button>
                  <button
                    className="btn btn-ghost"
                    onClick={() => {
                      setShowPasswordForm(false);
                      setPasswordError('');
                    }}
                    disabled={savingPassword}
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-block"
                  style={{ justifyContent: 'flex-start' }}
                  onClick={() => setShowPasswordForm(true)}
                >
                  <KeyRound size={15} /> Change password
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-block"
                  style={{ justifyContent: 'flex-start' }}
                  onClick={() => void sendPasswordReset()}
                  disabled={sendingReset}
                >
                  {sendingReset ? <Loader2 size={15} className="spin" /> : <Mail size={15} />}
                  {sendingReset ? 'Sending…' : 'Email me a reset link instead'}
                </button>
              </div>
            )}
          </div>
        </section>

        {/* ------------------------------------------------ notifications */}
        <section className="panel">
          <div className="panel-head">
            <Bell size={19} />
            <div>
              <h2>Notifications</h2>
              <p>What we tell you about, in the app.</p>
            </div>
          </div>
          <div className="panel-body" style={{ display: 'grid', gap: 14 }}>
            <PreferenceRow
              title="Shipping and delivery updates"
              description="When your order is packed, shipped, out for delivery and delivered."
              checked={profile?.notify_order_updates ?? true}
              disabled={savingPrefs || loading}
              onChange={(value) => void setPreference('notify_order_updates', value)}
            />
            <PreferenceRow
              title="Tap activity"
              description="When your Tap is provisioned or activated."
              checked={profile?.notify_tap_activity ?? true}
              disabled={savingPrefs || loading}
              onChange={(value) => void setPreference('notify_tap_activity', value)}
            />
            <p className="field-hint" style={{ margin: 0 }}>
              Order confirmations and payment receipts are always sent — they are the record of what
              you were charged.
            </p>
          </div>
        </section>

        {/* ---------------------------------------------------- purchases */}
        <section className="panel">
          <div className="panel-head">
            <Receipt size={19} />
            <div>
              <h2>Your purchases</h2>
              <p>What you own on this account.</p>
            </div>
          </div>
          <div className="panel-body" style={{ display: 'grid', gap: 12 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                flexWrap: 'wrap',
                padding: 14,
                borderRadius: 14,
                border: '1px solid var(--line)',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <strong style={{ fontSize: 13.5 }}>Customization Pass</strong>
                <p style={{ margin: '4px 0 0', color: 'var(--muted)', fontSize: 12.5 }}>
                  {entitlements.pass
                    ? `Active${passGrantedOn ? ` since ${passGrantedOn}` : ''}. One-time purchase — there is nothing to renew or cancel.`
                    : `Without it you can change your Tap once every ${editState?.interval_days ?? 14} days.`}
                </p>
              </div>
              {entitlements.pass ? (
                <span className="pill pill-green">
                  <CheckCircle2 size={12} /> Owned
                </span>
              ) : (
                <button className="btn btn-ghost btn-sm" onClick={() => navigate('/shygontap/tiers')}>
                  <Sparkles size={14} /> Get the Pass
                </button>
              )}
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                flexWrap: 'wrap',
                padding: 14,
                borderRadius: 14,
                border: '1px solid var(--line)',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <strong style={{ fontSize: 13.5 }}>Digital experiences</strong>
                <p style={{ margin: '4px 0 0', color: 'var(--muted)', fontSize: 12.5 }}>
                  {entitlements.owned.map((id) => EXPERIENCE_LABELS[id]).join(' · ')}
                </p>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => navigate('/shygontap/tiers')}>
                Manage
              </button>
            </div>

            <p className="field-hint" style={{ margin: 0 }}>
              Every SHYGON Tap purchase is a one-time payment. Nothing on this account bills you
              again, so there is no subscription to cancel. Receipts are on the{' '}
              <button
                type="button"
                className="text-button"
                style={{ display: 'inline', color: 'var(--blue)', fontWeight: 700 }}
                onClick={() => navigate('/shygontap/orders')}
              >
                Orders
              </button>{' '}
              page.
            </p>
          </div>
        </section>

        {/* ------------------------------------------------------ privacy */}
        <section className="panel">
          <div className="panel-head">
            <Eye size={19} />
            <div>
              <h2>Privacy</h2>
              <p>Who can see your Tap.</p>
            </div>
          </div>
          <div className="panel-body">
            {tap ? (
              <>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ fontSize: 13.5 }}>
                      Tap status: {TAP_STATUS_LABELS[status]}
                    </strong>
                    <p style={{ margin: '4px 0 0', color: 'var(--muted)', fontSize: 12.5 }}>
                      {TAP_STATUS_HINTS[status]}
                    </p>
                  </div>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => void toggleTapVisibility()}
                    disabled={statusBusy}
                  >
                    {statusBusy ? (
                      <Loader2 size={14} className="spin" />
                    ) : status === 'active' ? (
                      <Pause size={14} />
                    ) : (
                      <Play size={14} />
                    )}
                    {status === 'active' ? 'Pause Tap' : 'Make Tap live'}
                  </button>
                </div>
                {tap.slug && (
                  <p className="field-hint" style={{ marginTop: 12 }}>
                    Public address: {tapUrl(tap.slug).replace(/^https?:\/\//, '')} — only the fields
                    you switched on are ever published.
                  </p>
                )}
              </>
            ) : (
              <p className="field-hint" style={{ margin: 0 }}>
                You do not have a Tap profile yet. It is created automatically after your first
                SHYGON Tap purchase.
              </p>
            )}
          </div>
        </section>

        {/* ------------------------------------------------------ support */}
        <section className="panel">
          <div className="panel-head">
            <LifeBuoy size={19} />
            <div>
              <h2>Help and support</h2>
              <p>Questions about your card, an order or an upgrade.</p>
            </div>
          </div>
          <div className="panel-body" style={{ display: 'grid', gap: 10 }}>
            <button
              type="button"
              className="btn btn-ghost btn-block"
              style={{ justifyContent: 'flex-start' }}
              onClick={() => navigate('/shygontap/support')}
            >
              <LifeBuoy size={15} /> Open a support ticket
            </button>
            <p className="field-hint" style={{ margin: 0 }}>
              Quote your order number if your question is about a delivery — it is on the Orders
              page.
            </p>
          </div>
        </section>

        {/* ------------------------------------------------ about version */}
        <section className="panel">
          <div className="panel-head">
            <Info size={19} />
            <div>
              <h2>About</h2>
            </div>
          </div>
          <div className="panel-body">
            <div
              style={{
                display: 'grid',
                gap: 10,
                padding: 16,
                borderRadius: 14,
                background: 'var(--ds-surface-raised)',
                border: '1px solid var(--line)',
              }}
            >
              <Row label="Product" value={APP_NAME} />
              <Row label="Version" value={APP_VERSION} />
              <Row label="Build" value={BUILD_DATE} />
              <Row label="Company" value={COMPANY} />
            </div>
            <p className="field-hint" style={{ marginTop: 12 }}>
              Quote the version number when you contact support — it tells us exactly which build
              you are on.
            </p>
          </div>
        </section>

        <button className="btn btn-danger btn-block" onClick={() => setConfirmSignOut(true)}>
          <LogOut size={16} /> Sign out
        </button>
      </div>

      <ConfirmDialog
        open={confirmSignOut}
        title="Sign out of SHYGON Tap?"
        description="You can sign back in any time with your email and password."
        confirmLabel="Sign out"
        onConfirm={() => void doSignOut()}
        onCancel={() => setConfirmSignOut(false)}
      />
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, fontSize: 13 }}>
      <span style={{ color: 'var(--muted)' }}>{label}</span>
      <strong style={{ overflowWrap: 'anywhere', textAlign: 'right' }}>{value}</strong>
    </div>
  );
}

function PreferenceRow({
  title,
  description,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        padding: 14,
        borderRadius: 14,
        border: '1px solid var(--line)',
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: 3, flex: '0 0 auto' }}
      />
      <span style={{ minWidth: 0 }}>
        <strong style={{ display: 'block', fontSize: 13.5 }}>{title}</strong>
        <span style={{ color: 'var(--muted)', fontSize: 12.5, lineHeight: 1.5 }}>{description}</span>
      </span>
    </label>
  );
}
