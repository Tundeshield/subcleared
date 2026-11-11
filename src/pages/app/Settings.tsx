import { useEffect, useState } from 'react';
import { NavLink, useParams, useSearchParams } from 'react-router-dom';
import { formatDate, formatDateTime } from '../../domain/dates';
import { ROLE_DESCRIPTIONS, ROLE_LABELS, ROLE_PERMISSIONS } from '../../domain/permissions';
import type { Permission, Role } from '../../domain/types';
import { api, useApi, useMutation } from '../../lib/api';
import { exportCsv } from '../../lib/export';
import { useSession } from '../../lib/session';
import { Callout, Checkbox, Confirm, cx, Dialog, Empty, ErrorState, Field, FormError, humanize, PageHeader, Section, Segmented, Skeleton, Spinner, useToast } from '../../ui';

const SECTIONS = [
  ['organisation', 'Organisation'], ['users', 'Users and roles'], ['profile', 'Profile and notifications'], ['billing', 'Billing'], ['delivery', 'Delivery logs'], ['audit', 'Audit log'],
] as const;

export default function Settings() {
  const { section = 'organisation' } = useParams();
  const { can } = useSession();
  const visible = SECTIONS.filter(([k]) => (k === 'audit' ? can('audit.view') : k === 'delivery' ? can('settings.manage') : true));
  return (
    <div>
      <PageHeader title="Settings" />
      <div className="grid lg:grid-cols-[14rem_1fr] gap-6 items-start">
        <nav className="panel p-1.5 flex lg:flex-col overflow-x-auto" aria-label="Settings">
          {visible.map(([k, l]) => <NavLink key={k} to={`/app/settings/${k}`} className={({ isActive }) => cx('rounded px-3 py-2 text-sm whitespace-nowrap', isActive ? 'bg-raised text-ink font-medium' : 'text-muted hover:text-ink')}>{l}</NavLink>)}
        </nav>
        <div className="min-w-0">
          {section === 'organisation' && <OrgSettings />}
          {section === 'users' && <Users />}
          {section === 'profile' && <Profile />}
          {section === 'billing' && <Billing />}
          {section === 'delivery' && <Delivery />}
          {section === 'audit' && <Audit />}
        </div>
      </div>
    </div>
  );
}

function OrgSettings() {
  const { me, can, refresh } = useSession();
  const org = me!.org!;
  const [f, setF] = useState({ name: org.name, country: org.country, ...org.settings, reminderText: org.settings.reminderSchedule.join(', ') });
  const { run, busy, error } = useMutation('org.updateSettings');
  const toast = useToast();
  const editable = can('settings.manage');
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const zones: string[] = (Intl as any).supportedValuesOf ? (Intl as any).supportedValuesOf('timeZone') : [f.timezone];
  return (
    <div className="space-y-6">
      <Section title="Organisation"><div className="p-4 grid sm:grid-cols-2 gap-4">
        <Field label="Name"><input className="input" value={f.name} disabled={!editable} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Country"><input className="input" value={f.country} disabled={!editable} onChange={(e) => set('country', e.target.value)} /></Field>
        <Field label="Timezone" hint="Defines “today” for expiry checks and reminder timing."><select className="input" value={f.timezone} disabled={!editable} onChange={(e) => set('timezone', e.target.value)}>{zones.map((z) => <option key={z}>{z}</option>)}</select></Field>
      </div></Section>
      <Section title="Compliance rules"><div className="p-4 grid sm:grid-cols-2 gap-4">
        <Field label="Expiring-soon window (days)" hint="Approved documents expiring within this many days mark a subcontractor as needing attention."><input className="input" type="number" min={0} max={180} value={f.expiringSoonDays} disabled={!editable} onChange={(e) => set('expiringSoonDays', e.target.value)} /></Field>
        <Field label="Escalation period (days)" hint="Notify the project manager when a mandatory item is still missing after this long."><input className="input" type="number" min={1} max={120} value={f.escalationDays} disabled={!editable} onChange={(e) => set('escalationDays', e.target.value)} /></Field>
        <Field label="Reminder schedule (days before expiry)" hint="Comma separated. 0 = on the expiry date; negative = after expiry. Each reminder is sent once." className="sm:col-span-2"><input className="input font-mono" value={f.reminderText} disabled={!editable} onChange={(e) => set('reminderText', e.target.value)} /></Field>
        <Field label="Default link expiry (days)"><input className="input" type="number" min={1} max={30} value={f.defaultLinkExpiryDays} disabled={!editable} onChange={(e) => set('defaultLinkExpiryDays', e.target.value)} /></Field>
        <Field label="Minimum evidence retention (years)" hint="Superseded documents and decisions are kept at least this long."><input className="input" type="number" min={1} max={30} value={f.retentionYears} disabled={!editable} onChange={(e) => set('retentionYears', e.target.value)} /></Field>
        <div className="sm:col-span-2"><Checkbox checked={f.remindArchived} disabled={!editable} onChange={(v) => set('remindArchived', v)} label="Send reminders for archived or inactive records" hint="Off by default: no reminders for archived subcontractors or subcontractors with no live projects." /></div>
      </div></Section>
      {editable && <div className="flex justify-end gap-3 items-center"><FormError error={error} /><button className="btn-primary" disabled={busy} onClick={async () => {
        try {
          await run({ name: f.name, country: f.country, timezone: f.timezone, expiringSoonDays: Number(f.expiringSoonDays), escalationDays: Number(f.escalationDays), defaultLinkExpiryDays: Number(f.defaultLinkExpiryDays), retentionYears: Number(f.retentionYears), remindArchived: f.remindArchived, reminderSchedule: f.reminderText.split(',').map((x: string) => Number(x.trim())).filter((x: number) => !isNaN(x)) });
          await refresh(); toast('Settings saved');
        } catch { /* shown */ }
      }}>{busy && <Spinner />}Save settings</button></div>}
    </div>
  );
}

const ALL_PERMS = ROLE_PERMISSIONS.owner;

function Users() {
  const { can, me } = useSession();
  const { data, error, loading, reload } = useApi<any>('members.list');
  const [invite, setInvite] = useState(false);
  const [edit, setEdit] = useState<any>(null);
  const [deact, setDeact] = useState<any>(null);
  const update = useMutation('members.update');
  const revoke = useMutation('invitations.revoke');
  const toast = useToast();
  const manage = can('users.manage');
  if (loading && !data) return <div className="panel"><Skeleton /></div>;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  return (
    <div className="space-y-6">
      <Section title="Members" actions={manage && <button className="btn-primary btn-sm" onClick={() => setInvite(true)}>Invite user</button>}>
        <div className="overflow-x-auto"><table className="w-full min-w-[640px]">
          <thead><tr><th className="th">Name</th><th className="th">Role</th><th className="th">Status</th><th className="th">Joined</th><th className="th" /></tr></thead>
          <tbody>{data.members.map((m: any) => (
            <tr key={m.uid} className={cx(m.status !== 'active' && 'opacity-60')}>
              <td className="td"><div className="font-medium">{m.name || m.email}{m.uid === me!.user.uid && <span className="text-xs text-faint"> (you)</span>}</div><div className="text-xs text-muted">{m.email}</div></td>
              <td className="td">{ROLE_LABELS[m.role as Role]}{(m.extraPermissions?.length || m.revokedPermissions?.length) ? <div className="text-xs text-faint">Custom permissions</div> : null}</td>
              <td className="td">{humanize(m.status)}</td><td className="td text-muted">{formatDate(m.joinedAt)}</td>
              <td className="td text-right">{manage && m.uid !== me!.user.uid && <><button className="btn-ghost btn-sm" onClick={() => setEdit(m)}>Edit</button>
                {m.status === 'active' ? <button className="btn-ghost btn-sm text-bad" onClick={() => setDeact(m)}>Deactivate</button> : <button className="btn-ghost btn-sm" onClick={() => update.run({ uid: m.uid, status: 'active' }).then(() => toast('Reactivated'))}>Reactivate</button>}</>}</td>
            </tr>
          ))}</tbody>
        </table></div>
        <div className="px-4 pb-3"><FormError error={update.error} /></div>
      </Section>
      {manage && data.invitations.length > 0 && (
        <Section title="Pending invitations"><ul className="divide-y divide-line">{data.invitations.map((i: any) => (
          <li key={i.id} className="px-4 py-2.5 flex justify-between items-center text-sm"><span>{i.email} · <span className="text-muted">{ROLE_LABELS[i.role as Role]}</span> <span className="text-xs text-faint">expires {formatDate(i.expiresAt)}</span></span><button className="btn-ghost btn-sm text-bad" onClick={() => revoke.run({ invitationId: i.id }).then(() => toast('Invitation revoked'))}>Revoke</button></li>
        ))}</ul></Section>
      )}
      <Section title="Roles" description="Permissions are enforced on the server for every request."><div className="p-4 grid sm:grid-cols-2 gap-4">{(Object.keys(ROLE_LABELS) as Role[]).map((r) => <div key={r}><div className="font-medium text-sm">{ROLE_LABELS[r]}</div><p className="text-sm text-muted">{ROLE_DESCRIPTIONS[r]}</p></div>)}</div></Section>
      {invite && <InviteDialog onClose={() => setInvite(false)} />}
      {edit && <EditMember member={edit} onClose={() => setEdit(null)} />}
      <Confirm open={!!deact} onClose={() => setDeact(null)} danger title={`Deactivate ${deact?.name || deact?.email}?`} confirmLabel="Deactivate" busy={update.busy} onConfirm={async () => { await update.run({ uid: deact.uid, status: 'deactivated' }); setDeact(null); toast('Deactivated'); }}>
        They lose access immediately and are signed out. Their history stays in the audit trail.
      </Confirm>
    </div>
  );
}

function InviteDialog({ onClose }: { onClose: () => void }) {
  const { me } = useSession();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('compliance_manager');
  const [res, setRes] = useState<any>(null);
  const { run, busy, error } = useMutation('members.invite');
  const toast = useToast();
  return (
    <Dialog open onClose={onClose} title="Invite a user" footer={res ? <button className="btn-primary" onClick={onClose}>Done</button> : <><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy || !email} onClick={async () => { try { setRes(await run({ email, role })); } catch { /* shown */ } }}>{busy && <Spinner />}Send invitation</button></>}>
      {res ? <div className="space-y-3"><Callout tone={res.emailStatus === 'failed' ? 'warn' : 'ok'} title="Invitation created">{res.emailStatus === 'failed' ? `The email could not be sent (${res.emailError}). Share this link directly:` : `An invitation was sent to ${email}. It expires in 7 days.`}</Callout>
        {res.emailStatus === 'failed' && <div className="flex gap-2"><input className="input text-xs font-mono" readOnly value={res.inviteUrl} /><button className="btn-secondary btn-sm" onClick={() => navigator.clipboard.writeText(res.inviteUrl).then(() => toast('Copied'))}>Copy</button></div>}</div> : (
        <div className="space-y-4">
          <Field label="Email"><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Role" hint={ROLE_DESCRIPTIONS[role]}><select className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>{(Object.keys(ROLE_LABELS) as Role[]).filter((r) => r !== 'owner' || me!.member!.role === 'owner').map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select></Field>
          <FormError error={error} />
        </div>
      )}
    </Dialog>
  );
}

function EditMember({ member, onClose }: { member: any; onClose: () => void }) {
  const { me } = useSession();
  const [role, setRole] = useState<Role>(member.role);
  const [extra, setExtra] = useState<Permission[]>(member.extraPermissions ?? []);
  const [revoked, setRevoked] = useState<Permission[]>(member.revokedPermissions ?? []);
  const { run, busy, error } = useMutation('members.update');
  const toast = useToast();
  const base = new Set(ROLE_PERMISSIONS[role]);
  const effective = (p: Permission) => (base.has(p) && !revoked.includes(p)) || extra.includes(p);
  const toggle = (p: Permission, on: boolean) => {
    if (base.has(p)) setRevoked(on ? revoked.filter((x) => x !== p) : [...revoked, p]);
    else setExtra(on ? [...extra, p] : extra.filter((x) => x !== p));
  };
  return (
    <Dialog open onClose={onClose} title={`Edit ${member.name || member.email}`} width="max-w-2xl" footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy} onClick={async () => { await run({ uid: member.uid, role, extraPermissions: extra.filter((p) => !base.has(p)), revokedPermissions: revoked.filter((p) => base.has(p)) }); toast('Access updated'); onClose(); }}>{busy && <Spinner />}Save</button></>}>
      <div className="space-y-4">
        <Field label="Role"><select className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>{(Object.keys(ROLE_LABELS) as Role[]).filter((r) => r !== 'owner' || me!.member!.role === 'owner').map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select></Field>
        <fieldset><legend className="label">Permissions</legend><p className="hint -mt-1 mb-2">Adjust individual permissions on top of the role. Changes are recorded in the audit log.</p>
          <div className="grid sm:grid-cols-2 gap-2">{ALL_PERMS.map((p) => <Checkbox key={p} checked={effective(p)} onChange={(v) => toggle(p, v)} label={humanize(p)} hint={base.has(p) ? 'Included in role' : 'Extra'} />)}</div>
        </fieldset>
        <FormError error={error} />
      </div>
    </Dialog>
  );
}

const NOTIFS: [string, string][] = [
  ['awaiting_review', 'Document submitted / awaiting review'], ['document_approved', 'Document approved'], ['document_rejected', 'Document rejected'], ['info_requested', 'More information requested'],
  ['expiring', 'Document approaching expiry'], ['expired', 'Document expired'], ['became_non_compliant', 'Subcontractor became non-compliant'], ['escalation', 'Escalations'], ['project_threshold', 'Project readiness below threshold'],
];

function Profile() {
  const { me, refresh } = useSession();
  const [name, setName] = useState(me!.user.name);
  const [prefs, setPrefs] = useState<Record<string, { inApp: boolean; email: boolean }>>({});
  const save = useMutation('notifications.prefs');
  const profile = useMutation('me.update');
  const toast = useToast();
  useEffect(() => { const p: any = {}; const np: any = me!.member!.notificationPrefs ?? {}; for (const [k] of NOTIFS) p[k] = { inApp: np[k]?.inApp ?? true, email: np[k]?.email ?? false }; setPrefs(p); }, [me]);
  return (
    <div className="space-y-6">
      <Section title="Profile"><div className="p-4 flex flex-wrap gap-3 items-end">
        <Field label="Name" className="flex-1 min-w-[16rem]"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <button className="btn-secondary" disabled={profile.busy || !name.trim()} onClick={async () => { await profile.run({ name }); await refresh(); toast('Profile saved'); }}>Save</button>
        <div className="w-full text-sm text-muted">{me!.user.email}</div>
      </div></Section>
      <Section title="Notification preferences" description="Choose how you hear about each kind of event. In-app notifications appear under Notifications.">
        <div className="overflow-x-auto"><table className="w-full"><thead><tr><th className="th">Event</th><th className="th">In app</th><th className="th">Email</th></tr></thead>
          <tbody>{NOTIFS.map(([k, l]) => (
            <tr key={k}><td className="td">{l}</td>
              <td className="td"><Checkbox checked={prefs[k]?.inApp ?? true} onChange={(v) => setPrefs({ ...prefs, [k]: { ...prefs[k], inApp: v } })} label={<span className="sr-only">In app</span>} /></td>
              <td className="td"><Checkbox checked={prefs[k]?.email ?? false} onChange={(v) => setPrefs({ ...prefs, [k]: { ...prefs[k], email: v } })} label={<span className="sr-only">Email</span>} /></td></tr>
          ))}</tbody></table></div>
        <div className="p-4 flex justify-end"><button className="btn-primary" disabled={save.busy} onClick={async () => { await save.run({ prefs }); await refresh(); toast('Preferences saved'); }}>{save.busy && <Spinner />}Save preferences</button></div>
      </Section>
    </div>
  );
}

function Billing() {
  const { data, error, loading, reload } = useApi<any>('billing.get');
  const [params] = useSearchParams();
  const [interval, setInterval] = useState<'month' | 'year'>('year');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (loading && !data) return <div className="panel"><Skeleton /></div>;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const s = data.subscription;
  const go = async (action: string, input: any, key: string) => { setBusy(key); setErr(null); try { const r = await api(action, input); window.location.href = r.url; } catch (e: any) { setErr(e.message); setBusy(null); } };
  const lim = (n: number | null) => (n === null ? '∞' : n);
  return (
    <div className="space-y-6">
      {params.get('checkout') === 'success' && <Callout tone="ok" title="Thanks — payment received">Your subscription will update in a moment once Stripe confirms it.</Callout>}
      {!data.configured && <Callout tone="warn" title="Billing isn't connected yet">Stripe keys are not configured for this deployment. Plan limits still apply; see the deployment guide to connect Stripe.</Callout>}
      <Section title="Current plan"><div className="p-4 grid sm:grid-cols-4 gap-4 text-sm">
        <div><div className="text-muted">Plan</div><div className="text-lg font-semibold">{data.plan.name}</div><div className="text-muted">{humanize(s.status)}{s.status === 'trialing' && s.trialEndsAt ? ` until ${formatDate(s.trialEndsAt)}` : ''}{s.cancelAtPeriodEnd ? ' · cancels at period end' : ''}</div>{s.currentPeriodEnd && <div className="text-xs text-faint">Renews {formatDate(s.currentPeriodEnd)}</div>}</div>
        <div><div className="text-muted">Active subcontractors</div><div className="text-lg tabular-nums">{data.usage.activeSubcontractors} / {lim(data.plan.limits.activeSubcontractors)}</div></div>
        <div><div className="text-muted">Active projects</div><div className="text-lg tabular-nums">{data.usage.activeProjects} / {lim(data.plan.limits.activeProjects)}</div></div>
        <div><div className="text-muted">Users</div><div className="text-lg tabular-nums">{data.usage.users} / {lim(data.plan.limits.users)}</div></div>
      </div>{data.canManage && s.stripeCustomerId && <div className="px-4 pb-4"><button className="btn-secondary" disabled={!!busy} onClick={() => go('billing.portal', {}, 'portal')}>{busy === 'portal' && <Spinner />}Manage payment method, invoices and cancellation</button></div>}</Section>
      {data.canManage && (
        <Section title="Change plan" actions={<Segmented size="sm" value={interval} onChange={setInterval} options={[{ value: 'month', label: 'Monthly' }, { value: 'year', label: 'Annual' }]} />}>
          <div className="p-4 grid md:grid-cols-3 gap-4">{data.plans.map((p: any) => {
            const current = p.id === s.plan && s.status !== 'trialing' && s.interval === interval;
            return (
              <div key={p.id} className={cx('rounded border p-4', current ? 'border-accent/50' : 'border-line')}>
                <div className="font-semibold">{p.name}</div><div className="text-2xl font-semibold mt-1 tabular-nums">${interval === 'year' ? p.annual : p.monthly}<span className="text-sm text-muted font-normal">/mo</span></div>
                <div className="text-xs text-muted mt-1">{lim(p.limits.activeSubcontractors)} subcontractors · {lim(p.limits.activeProjects)} projects · {lim(p.limits.users)} users</div>
                <button className={cx('w-full mt-3', current ? 'btn-secondary' : 'btn-primary')} disabled={current || !!busy || !data.configured} onClick={() => go('billing.checkout', { plan: p.id, interval }, p.id)}>{busy === p.id && <Spinner />}{current ? 'Current plan' : s.stripeSubscriptionId ? 'Switch to this plan' : 'Choose plan'}</button>
              </div>
            );
          })}</div>
          <div className="px-4 pb-4"><FormError error={err} /><p className="text-xs text-faint mt-2">Subcontractors are never charged for submitting documents. Payments are processed by Stripe.</p></div>
        </Section>
      )}
      <Section title="Billing history">{data.history.length === 0 ? <Empty title="No invoices yet" /> : (
        <table className="w-full"><thead><tr><th className="th">Date</th><th className="th">Invoice</th><th className="th">Amount</th><th className="th">Status</th><th className="th" /></tr></thead>
          <tbody>{data.history.map((h: any) => <tr key={h.id}><td className="td">{formatDate(h.created)}</td><td className="td">{h.number}</td><td className="td tabular-nums">{(h.amount / 100).toLocaleString('en-GB', { style: 'currency', currency: (h.currency || 'usd').toUpperCase() })}</td><td className={cx('td', h.status === 'paid' ? 'text-ok' : 'text-bad')}>{humanize(h.status)}</td><td className="td text-right">{h.hostedUrl && <a className="link text-sm" href={h.hostedUrl} target="_blank" rel="noreferrer">View</a>}</td></tr>)}</tbody></table>
      )}</Section>
    </div>
  );
}

function Delivery() {
  const { data, error, loading, reload } = useApi<any>('deliveryLogs.list');
  if (loading && !data) return <div className="panel"><Skeleton /></div>;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  return (
    <Section title="Email delivery log" description="Every email SubCleared attempted, with its result. Failed scheduled reminders are retried automatically (up to 3 attempts)." actions={<button className="btn-secondary btn-sm" onClick={() => exportCsv('Delivery log', [{ key: 'updatedAt', label: 'Time' }, { key: 'to', label: 'To' }, { key: 'subject', label: 'Subject' }, { key: 'status', label: 'Status' }, { key: 'attempts', label: 'Attempts' }, { key: 'error', label: 'Error' }], data.items)}>Export CSV</button>}>
      {data.items.length === 0 ? <Empty title="No emails sent yet" /> : (
        <div className="overflow-x-auto"><table className="w-full min-w-[760px]"><thead><tr><th className="th">Time</th><th className="th">To</th><th className="th">Subject</th><th className="th">Status</th><th className="th text-right">Attempts</th></tr></thead>
          <tbody>{data.items.map((l: any) => <tr key={l.id}><td className="td text-muted whitespace-nowrap">{formatDateTime(l.updatedAt)}</td><td className="td">{l.to}</td><td className="td">{l.subject}</td><td className={cx('td', l.status === 'failed' ? 'text-bad' : 'text-ok')}>{l.status === 'dev_logged' ? 'Captured (dev)' : humanize(l.status)}{l.error && <div className="text-xs text-bad">{l.error}</div>}</td><td className="td text-right tabular-nums">{l.attempts}</td></tr>)}</tbody></table></div>
      )}
    </Section>
  );
}

function Audit() {
  const [f, setF] = useState<any>({});
  const { data, error, loading, reload } = useApi<any>('audit.list', { ...f, limit: 500 });
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Section title="Audit log" description="Append-only. Records cannot be edited or deleted by any user." actions={data && <button className="btn-secondary btn-sm" onClick={() => exportCsv('Audit log', [{ key: 'at', label: 'Time' }, { key: 'actorName', label: 'Actor' }, { key: 'action', label: 'Action' }, { key: 'label', label: 'Record' }, { key: 'source', label: 'Source' }, { key: 'change', label: 'Change' }], data.items.map((e: any) => ({ ...e, actorName: e.actor.name, label: e.entity.label, change: JSON.stringify(e.after ?? '') })))}>Export CSV</button>}>
      <div className="p-3 border-b border-line grid sm:grid-cols-4 gap-2">
        <input className="input h-9 text-sm" placeholder="Search" value={f.q ?? ''} onChange={(e) => setF({ ...f, q: e.target.value || undefined })} aria-label="Search audit" />
        <select className="input h-9 text-sm" value={f.action ?? ''} onChange={(e) => setF({ ...f, action: e.target.value || undefined })} aria-label="Action"><option value="">All actions</option>{['document', 'compliance', 'subcontractor', 'project', 'requirement', 'template', 'request', 'member', 'portal', 'notification', 'billing', 'organisation'].map((a) => <option key={a} value={a}>{humanize(a)}</option>)}</select>
        <input className="input h-9 text-sm" type="date" value={f.from ?? ''} onChange={(e) => setF({ ...f, from: e.target.value || undefined })} aria-label="From" />
        <input className="input h-9 text-sm" type="date" value={f.to ?? ''} onChange={(e) => setF({ ...f, to: e.target.value || undefined })} aria-label="To" />
      </div>
      {loading && !data ? <Skeleton /> : error ? <div className="p-4"><ErrorState error={error} onRetry={reload} /></div> : data.items.length === 0 ? <Empty title="No events" /> : (
        <ul className="divide-y divide-line">{data.items.map((e: any) => (
          <li key={e.id} className="px-4 py-2.5 text-sm">
            <button className="w-full text-left flex flex-wrap gap-x-3" onClick={() => setOpen(open === e.id ? null : e.id)}><span className="text-faint whitespace-nowrap tabular-nums">{formatDateTime(e.at)}</span><span className="font-mono text-xs text-accent mt-0.5">{e.action}</span><span>{e.entity.label}</span><span className="text-muted">· {e.actor.name} ({e.source})</span></button>
            {open === e.id && <pre className="mt-2 text-xs bg-raised rounded p-3 overflow-x-auto">{JSON.stringify({ before: e.before, after: e.after, entity: e.entity, ip: e.ip }, null, 2)}</pre>}
          </li>
        ))}</ul>
      )}
      {data && data.total > data.items.length && <div className="px-4 py-2 text-xs text-muted">Showing {data.items.length} of {data.total}. Use the audit trail report for a full export.</div>}
    </Section>
  );
}
