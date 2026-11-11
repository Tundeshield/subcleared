import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { api, setOrgId } from '../../lib/api';
import { auth } from '../../lib/auth';
import { COUNTRIES, countryDefaults } from '../../domain/locale';
import { useSession } from '../../lib/session';
import { Callout, Checkbox, Field, FormError, Spinner } from '../../ui';
import { AuthCard } from './PublicShell';

function Unconfigured() {
  return auth.mode === 'unconfigured' ? <div className="mb-6"><Callout tone="warn" title="Sign-in isn't available yet">This deployment hasn't been connected to its sign-in service. Please try again shortly.</Callout></div> : null;
}

export function Login() {
  const [params] = useSearchParams();
  const next = params.get('next') || '/app/overview';
  const { authUser, ready } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  if (ready && authUser) return <Navigate to={next.startsWith('/') ? next : '/app/overview'} replace />;
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { await auth.signIn(email.trim(), password); nav(next.startsWith('/') ? next : '/app/overview'); } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <AuthCard title="Sign in" subtitle="Welcome back." footer={<>New to SubCleared? <Link className="link" to="/signup">Create an account</Link></>}>
      <Unconfigured />
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email"><input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label={<span className="flex justify-between w-full">Password<Link to="/forgot-password" className="link text-xs font-normal">Forgot password?</Link></span>}>
          <input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <FormError error={error} />
        <button className="btn-primary w-full btn-lg" disabled={busy}>{busy && <Spinner />}Sign in</button>
      </form>
    </AuthCard>
  );
}

export function Signup() {
  const [params] = useSearchParams();
  const [name, setName] = useState('');
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { await auth.signUp(email.trim(), password, name.trim()); nav(params.get('next') ? `/verify-email?next=${encodeURIComponent(params.get('next')!)}` : '/verify-email'); } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <AuthCard title="Create your account" subtitle="Start a 14-day free trial. No card required." footer={<>Already have an account? <Link className="link" to="/login">Sign in</Link></>}>
      <Unconfigured />
      <form onSubmit={submit} className="space-y-4">
        <Field label="Your name"><input className="input" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Work email"><input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Password" hint="At least 8 characters."><input className="input" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <FormError error={error} />
        <button className="btn-primary w-full btn-lg" disabled={busy}>{busy && <Spinner />}Create account</button>
      </form>
    </AuthCard>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <AuthCard title="Reset your password" subtitle="We'll email you a link to choose a new password." footer={<Link className="link" to="/login">Back to sign in</Link>}>
      {sent ? <Callout tone="ok" title="Check your inbox">If an account exists for {email}, a reset link is on its way. The link expires after an hour.</Callout> : (
        <form className="space-y-4" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setError(null); try { await auth.requestReset(email.trim()); setSent(true); } catch (err: any) { setError(err.message); } finally { setBusy(false); } }}>
          <Field label="Email"><input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <FormError error={error} />
          <button className="btn-primary w-full btn-lg" disabled={busy}>{busy && <Spinner />}Send reset link</button>
        </form>
      )}
    </AuthCard>
  );
}

/** Handles Firebase email action links (verifyEmail / resetPassword). */
export function AuthAction() {
  const [params] = useSearchParams();
  const mode = params.get('mode');
  const code = params.get('oobCode') ?? '';
  const [state, setState] = useState<'working' | 'done' | 'error' | 'form'>(mode === 'resetPassword' ? 'form' : 'working');
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const { refresh } = useSession();
  useEffect(() => {
    if (mode !== 'verifyEmail') return;
    auth.applyVerification(code).then(async () => { await refresh(); setState('done'); }).catch((e) => { setError(e.message); setState('error'); });
  }, [mode, code, refresh]);
  if (mode === 'verifyEmail') {
    return (
      <AuthCard title={state === 'done' ? 'Email verified' : state === 'error' ? 'Verification failed' : 'Verifying…'}>
        {state === 'working' && <Spinner />}
        {state === 'done' && <><p className="text-muted">Thanks — your email address is confirmed.</p><Link to="/onboarding" className="btn-primary mt-6">Continue</Link></>}
        {state === 'error' && <><FormError error={error} /><Link to="/verify-email" className="btn-secondary mt-4">Send a new link</Link></>}
      </AuthCard>
    );
  }
  if (mode === 'resetPassword') {
    return (
      <AuthCard title="Choose a new password">
        {state === 'done' ? <><Callout tone="ok">Your password has been changed.</Callout><Link to="/login" className="btn-primary mt-6">Sign in</Link></> : (
          <form className="space-y-4" onSubmit={async (e) => { e.preventDefault(); setError(null); try { await auth.confirmReset(code, password); setState('done'); } catch (err: any) { setError(err.message); } }}>
            <Field label="New password" hint="At least 8 characters."><input className="input" type="password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /></Field>
            <FormError error={error} />
            <button className="btn-primary w-full btn-lg">Save password</button>
          </form>
        )}
      </AuthCard>
    );
  }
  return <AuthCard title="Invalid link"><p className="text-muted">This link isn't recognised.</p></AuthCard>;
}

export function VerifyNotice() {
  const { authUser, ready, refresh } = useSession();
  const [params] = useSearchParams();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nav = useNavigate();
  if (ready && !authUser) return <Navigate to="/login" replace />;
  if (authUser?.emailVerified) return <Navigate to={params.get('next') || '/onboarding'} replace />;
  return (
    <AuthCard title="Verify your email" subtitle={<>We sent a verification link to <span className="text-ink">{authUser?.email}</span>. Open it to continue.</>}
      footer={<button className="link" onClick={() => auth.signOut().then(() => nav('/login'))}>Use a different account</button>}>
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" onClick={async () => { setError(null); const u = await auth.reload(); await refresh(); if (u?.emailVerified) nav(params.get('next') || '/onboarding'); else setError("We haven't seen the verification yet. Open the link in the email, then try again."); }}>I've verified my email</button>
        <button className="btn-secondary" onClick={async () => { setError(null); try { await auth.resendVerification(); setMsg('A new link is on its way.'); } catch (e: any) { setError(e.message); } }}>Resend link</button>
      </div>
      {msg && <p className="text-sm text-accent mt-3">{msg}</p>}
      <div className="mt-3"><FormError error={error} /></div>
      {auth.mode === 'dev' && <p className="text-xs text-faint mt-6">Local development: verification emails appear in the <a className="underline" href="/dev/mailbox">dev mailbox</a>.</p>}
    </AuthCard>
  );
}



export function Onboarding() {
  const { authUser, ready, me, refresh } = useSession();
  const [orgName, setOrgName] = useState('');
  const [country, setCountry] = useState(() => { const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? ''; return COUNTRIES.find((c) => c.timezone === tz)?.name ?? (/^America\/(New_York|Chicago|Denver|Los_Angeles|Phoenix)/.test(tz) ? 'United States' : 'Other'); });
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [name, setName] = useState('');
  const [seed, setSeed] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  useEffect(() => { if (authUser?.name && !name) setName(authUser.name); }, [authUser, name]);
  if (!ready) return <div className="min-h-screen grid place-items-center"><Spinner /></div>;
  if (!authUser) return <Navigate to="/login?next=/onboarding" replace />;
  if (!authUser.emailVerified) return <Navigate to="/verify-email" replace />;
  if (me?.org) return <Navigate to="/app/overview" replace />;
  const zones: string[] = (Intl as any).supportedValuesOf ? (Intl as any).supportedValuesOf('timeZone') : [timezone, 'UTC', 'Europe/London', 'America/New_York', 'America/Chicago'];
  return (
    <AuthCard title="Set up your organisation" subtitle="This is your company's workspace. You can invite colleagues once it's created.">
      <form className="space-y-4" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError(null);
        try { const r = await api('org.register', { orgName, country, timezone, name, seedLibrary: seed }); setOrgId(r.orgId); await refresh(); nav('/app/overview'); } catch (err: any) { setError(err.message); } finally { setBusy(false); }
      }}>
        <Field label="Company name" required><input className="input" required value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="e.g. Harbourline Construction" /></Field>
        <Field label="Your name" required><input className="input" required value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Country" hint="Sets terminology, date format and currency. You can change these later."><select className="input" value={country} onChange={(e) => { setCountry(e.target.value); const d = countryDefaults(e.target.value); if (d.name !== 'Other' && zones.includes(d.timezone)) setTimezone(d.timezone); }}>{COUNTRIES.map((c) => <option key={c.name}>{c.name}</option>)}</select></Field>
          <Field label="Timezone" hint="Used for expiry dates and reminders."><select className="input" value={timezone} onChange={(e) => setTimezone(e.target.value)}>{zones.map((z) => <option key={z}>{z}</option>)}</select></Field>
        </div>
        <Checkbox checked={seed} onChange={setSeed} label="Add the starter requirement library" hint={`${country === 'United States' ? 'US-style' : country === 'United Kingdom' ? 'UK-style' : 'Internationally worded'} requirements and eight trade templates you can edit — starting points, not legal standards for your jurisdiction.`} />
        <FormError error={error} />
        <button className="btn-primary w-full btn-lg" disabled={busy}>{busy && <Spinner />}Create organisation</button>
      </form>
      {me && me.memberships.length > 0 && <p className="text-sm text-muted mt-4">Already a member elsewhere? <button className="link" onClick={() => refresh()}>Reload</button></p>}
    </AuthCard>
  );
}

export function AcceptInvite() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const { authUser, ready, refresh } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const next = `/accept-invite?token=${encodeURIComponent(token)}`;
  if (!ready) return <div className="min-h-screen grid place-items-center"><Spinner /></div>;
  if (!authUser) {
    return (
      <AuthCard title="You've been invited to SubCleared" subtitle="Sign in or create an account with the email address the invitation was sent to.">
        <div className="flex gap-2"><Link className="btn-primary" to={`/signup?next=${encodeURIComponent(next)}`}>Create account</Link><Link className="btn-secondary" to={`/login?next=${encodeURIComponent(next)}`}>Sign in</Link></div>
      </AuthCard>
    );
  }
  if (!authUser.emailVerified) return <Navigate to={`/verify-email?next=${encodeURIComponent(next)}`} replace />;
  return (
    <AuthCard title="Join organisation" subtitle={<>Signed in as <span className="text-ink">{authUser.email}</span>.</>}>
      <FormError error={error} />
      <button className="btn-primary btn-lg w-full mt-2" disabled={busy} onClick={async () => {
        setBusy(true); setError(null);
        try { const r = await api('invitations.accept', { token }); setOrgId(r.orgId); await refresh(); nav('/app/overview'); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
      }}>{busy && <Spinner />}Accept invitation</button>
    </AuthCard>
  );
}
