import { useEffect, useMemo, useState } from 'react';
import ThemeToggle from '../components/ThemeToggle';
import { ArrowLeft, Eye, EyeOff, LockKeyhole, Mail, UserRound } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth-context';
import { cardArt, digitalPlans, products } from '../data/shygonTapData';
import type { MaterialId, TierId } from '../data/shygonTapData';
import { LEGAL_PAGES, privateMeta } from '../seo/meta';
import { LEGAL } from '../data/legal';
import { usePageMeta } from '../seo/usePageMeta';

const PENDING_KEY = 'shygon_pending_order';

/**
 * Sign in / sign up / forgot password, in one screen.
 *
 * A signed-in visitor who lands here (a stale bookmark, the back button) is
 * bounced onward immediately rather than shown a form they don't need. Where
 * they land: back to whichever protected page sent them here (`location.state.from`,
 * set by `ProtectedRoute`), the checkout if there's a pending selection, or the
 * dashboard otherwise.
 */
export default function Auth() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading: authLoading } = useAuth();

  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  // Sign-up consent: never pre-ticked, required, and recorded on the account.
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<'info' | 'error'>('info');

  usePageMeta(
    useMemo(
      () =>
        privateMeta(
          mode === 'login' ? 'Sign in' : mode === 'signup' ? 'Create your account' : 'Reset your password',
          '/shygontap/auth',
        ),
      [mode],
    ),
  );

  const destination = (): string => {
    const from = (location.state as { from?: string } | null)?.from;
    if (from && from !== '/shygontap/auth') return from;
    return '/shygontap/account';
  };

  useEffect(() => {
    if (!authLoading && user) navigate(destination(), { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage('');
    setMessageTone('info');

    try {
      if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/shygontap/settings`,
        });
        if (error) throw error;
        setMessage('If an account exists for that email, a reset link has been sent.');
        return;
      }

      if (mode === 'signup') {
        if (!name.trim()) throw new Error('Please enter your full name.');
        if (!agreed) {
          throw new Error('Please confirm you are 18 or older and agree to the Terms and Privacy Policy.');
        }
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: {
              full_name: name.trim(),
              // Evidence of consent: when, and to which version of the policies.
              terms_accepted_at: new Date().toISOString(),
              policies_version: LEGAL.lastUpdated,
            },
          },
        });
        if (error) throw error;
        if (!data.session) {
          setMessage('Account created. Check your email to verify your account, then sign in.');
          setMode('login');
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      }

      navigate(destination(), { replace: true });
    } catch (error) {
      setMessageTone('error');
      setMessage(error instanceof Error ? error.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  const pendingOrder = (() => {
    try {
      return JSON.parse(localStorage.getItem(PENDING_KEY) || 'null');
    } catch {
      return null;
    }
  })();
  const pendingProduct = pendingOrder ? products.find((item) => item.id === pendingOrder.productId) : null;
  const pendingPlan = pendingOrder ? digitalPlans.find((item) => item.id === pendingOrder.planId) : null;

  return (
    <main className="min-h-screen bg-[var(--ds-surface)] text-[var(--ds-text)] grid lg:grid-cols-2">
      <section className="hidden lg:flex bg-[var(--ds-surface-raised)] text-[var(--ds-text)] border-r border-[var(--ds-border)] p-12 items-center">
        <div className="w-full max-w-lg">
          <p className="text-[var(--ds-accent)] font-bold tracking-[0.25em] text-xs">SHYGON TAP</p>
          {/* Decorative panel, desktop only. The page's heading is the form's h1. */}
          <p className="text-6xl font-black leading-[0.95] mt-5">
            Your identity.
            <br />
            One tap away.
          </p>
          <p className="text-[var(--ds-text-tertiary)] text-lg mt-6">
            Buy a card once. Build your profile. Keep improving the digital experience.
          </p>
          {pendingOrder && pendingProduct && pendingPlan && (
            <div className="mt-10 rounded-3xl border border-[var(--ds-border)] bg-white/[0.04] p-5">
              <p className="text-xs font-bold tracking-[0.18em] text-[var(--ds-text-tertiary)] uppercase">Your saved selection</p>
              <div className="mt-4 flex items-center gap-4">
                <div className="w-24 h-20 rounded-2xl bg-white/10 p-2 flex items-center justify-center overflow-hidden">
                  <img
                    src={cardArt(pendingProduct, (pendingOrder.material as MaterialId) || 'metal', (pendingOrder.tier as TierId) || 'standard')}
                    alt={pendingProduct.name}
                    className="max-w-full max-h-full object-contain rounded-xl"
                  />
                </div>
                <div>
                  <p className="font-bold">{pendingProduct.name}</p>
                  <p className="text-sm text-[var(--ds-text-tertiary)] mt-1">
                    {pendingPlan.name} · ₹{pendingOrder.total}
                  </p>
                </div>
              </div>
              <p className="text-xs text-[var(--ds-text-tertiary)] mt-4">
                Your selection is saved while you sign in. You will return to your dashboard next.
              </p>
            </div>
          )}
        </div>
      </section>
      <section className="grid place-items-center px-6 py-10">
        <div className="w-full max-w-md">
          <div className="flex items-center justify-between gap-3 mb-10">
            <Link
              to="/shygontap"
              className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--ds-text-tertiary)]"
            >
              <ArrowLeft size={16} /> Back to Shygon Tap
            </Link>
            <ThemeToggle />
          </div>

          <div className="mb-7">
            <div className="text-3xl font-black">
              SHYGON <span className="text-[var(--ds-accent)]">TAP</span>
            </div>
            <h1 className="text-3xl font-black mt-8">
              {mode === 'login' ? 'Welcome back.' : mode === 'signup' ? 'Create your account.' : 'Reset your password.'}
            </h1>
            <p className="text-[var(--ds-text-tertiary)] mt-2">
              {mode === 'forgot' ? 'We will send a secure reset link.' : 'Your account keeps your card, profile and orders connected.'}
            </p>
          </div>

          <form onSubmit={submit} className="bg-white/[0.04] border border-[var(--ds-border)] rounded-3xl p-7 space-y-5">
            {mode === 'signup' && (
              <label className="block">
                <span className="text-sm font-semibold">Full name</span>
                <div className="relative mt-2">
                  <UserRound className="absolute left-4 top-3.5 text-[var(--ds-text-tertiary)]" size={18} />
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded-xl border border-[var(--ds-border-field)] bg-white/[0.045] text-[var(--ds-text)] placeholder:text-[var(--ds-text-tertiary)] py-3.5 pl-11 pr-4 outline-none focus:border-[var(--ds-border-selected)]"
                    placeholder="Your name"
                    autoComplete="name"
                    required
                  />
                </div>
              </label>
            )}
            <label className="block">
              <span className="text-sm font-semibold">Email</span>
              <div className="relative mt-2">
                <Mail className="absolute left-4 top-3.5 text-[var(--ds-text-tertiary)]" size={18} />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-xl border border-[var(--ds-border-field)] bg-white/[0.045] text-[var(--ds-text)] placeholder:text-[var(--ds-text-tertiary)] py-3.5 pl-11 pr-4 outline-none focus:border-[var(--ds-border-selected)]"
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                />
              </div>
            </label>
            {mode !== 'forgot' && (
              <label className="block">
                <span className="text-sm font-semibold">Password</span>
                <div className="relative mt-2">
                  <LockKeyhole className="absolute left-4 top-3.5 text-[var(--ds-text-tertiary)]" size={18} />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    minLength={6}
                    className="w-full rounded-xl border border-[var(--ds-border-field)] bg-white/[0.045] text-[var(--ds-text)] placeholder:text-[var(--ds-text-tertiary)] py-3.5 pl-11 pr-11 outline-none focus:border-[var(--ds-border-selected)]"
                    placeholder="Minimum 6 characters"
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-4 top-3.5 text-[var(--ds-text-tertiary)]"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </label>
            )}
            {mode === 'signup' && (
              <label className="flex items-start gap-3 text-sm leading-relaxed text-[var(--ds-text-secondary)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                  required
                  className="mt-1 h-5 w-5 shrink-0 accent-[var(--ds-accent)] cursor-pointer"
                />
                <span>
                  I am 18 or older and I agree to the{' '}
                  <a href={LEGAL_PAGES.terms.path} target="_blank" rel="noreferrer" className="font-semibold text-[var(--ds-text)] underline underline-offset-2">
                    Terms and Conditions<span className="sr-only"> (opens in a new tab)</span>
                  </a>{' '}
                  and{' '}
                  <a href={LEGAL_PAGES.privacy.path} target="_blank" rel="noreferrer" className="font-semibold text-[var(--ds-text)] underline underline-offset-2">
                    Privacy Policy<span className="sr-only"> (opens in a new tab)</span>
                  </a>
                  .
                </span>
              </label>
            )}
            {message && (
              <div
                role={messageTone === 'error' ? 'alert' : 'status'}
                className={`rounded-xl border p-4 text-sm ${
                  messageTone === 'error'
                    ? 'bg-[var(--ds-surface-raised)] border-[var(--ds-color-state-error)] text-[var(--ds-color-state-error)]'
                    : 'bg-[var(--ds-surface-raised)] border-[var(--ds-border)] text-[var(--ds-text-secondary)]'
                }`}
              >
                {message}
              </div>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-[var(--ds-action-bg)] text-[var(--ds-action-fg)] py-4 font-bold transition-colors hover:bg-[var(--ds-action-bg-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Please wait…' : mode === 'login' ? 'Log in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
            </button>
            {mode === 'login' && (
              <button type="button" onClick={() => setMode('forgot')} className="w-full text-sm font-semibold text-[var(--ds-accent)]">
                Forgot password?
              </button>
            )}
            {mode !== 'forgot' && (
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setMessage('');
                  }}
                  aria-pressed={mode === 'login'}
                  className={`flex-1 py-3 rounded-xl ${mode === 'login' ? 'bg-[var(--ds-accent-soft)] text-[var(--ds-accent)]' : 'text-[var(--ds-text-tertiary)]'}`}
                >
                  Login
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('signup');
                    setMessage('');
                  }}
                  aria-pressed={mode === 'signup'}
                  className={`flex-1 py-3 rounded-xl ${mode === 'signup' ? 'bg-[var(--ds-accent-soft)] text-[var(--ds-accent)]' : 'text-[var(--ds-text-tertiary)]'}`}
                >
                  Sign up
                </button>
              </div>
            )}
            {mode === 'forgot' && (
              <button type="button" onClick={() => setMode('login')} className="w-full text-sm font-semibold text-[var(--ds-text-tertiary)]">
                Back to login
              </button>
            )}
          </form>
        </div>
      </section>
    </main>
  );
}
