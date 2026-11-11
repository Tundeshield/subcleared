import { useState } from 'react';
import { formatDate } from '../../domain/dates';
import { ROLE_DESCRIPTIONS, ROLE_LABELS, ROLE_PERMISSIONS } from '../../domain/permissions';
import type { Permission, Role } from '../../domain/types';
import { useApi, useMutation } from '../../lib/api';
import { useSession } from '../../lib/session';
import { Callout, Checkbox, Confirm, cx, Dialog, Drawer, ErrorState, Field, FormError, humanize, Menu, MoreButton, PageHeader, Skeleton, Spinner, useToast } from '../../ui';

const ALL_PERMS = ROLE_PERMISSIONS.owner;
const PERM_LABELS: Record<Permission, string> = {
  'org.manage': 'Manage organisation', 'users.manage': 'Manage team members', 'billing.manage': 'Manage billing', 'projects.create': 'Create projects', 'projects.edit': 'Edit projects and assignments',
  'projects.archive': 'Archive projects', 'projects.view_all': 'See every project', 'subs.manage': 'Add and edit subcontractors', 'subs.notes': 'Read and write internal notes',
  'requirements.manage': 'Manage requirements and templates', 'requirements.override': 'Mark requirements not applicable', 'documents.upload': 'Upload documents', 'documents.review': 'Approve and reject documents',
  'documents.verify': 'Record independent verification', 'documents.archive': 'Archive documents', 'requests.send': 'Send document requests', 'reports.view': 'Run reports', 'audit.view': 'View the audit log', 'settings.manage': 'Change organisation settings',
};

export default function Team() {
  const { can, me } = useSession();
  const { data, error, loading, reload } = useApi<any>('members.list');
  const [invite, setInvite] = useState(false);
  const [edit, setEdit] = useState<any>(null);
  const [deact, setDeact] = useState<any>(null);
  const update = useMutation('members.update');
  const revoke = useMutation('invitations.revoke');
  const toast = useToast();
  const manage = can('users.manage');
  return (
    <div>
      <PageHeader title="Team and permissions" description="Who can see and do what. Permissions are checked on the server for every action, not just hidden in the interface." actions={manage && <button className="btn-primary" onClick={() => setInvite(true)}>Invite someone</button>} />
      {loading && !data ? <Skeleton /> : error ? <ErrorState error={error} onRetry={reload} /> : (
        <div className="space-y-14">
          <section>
            <div className="overflow-x-auto -mx-4 sm:mx-0"><table className="table min-w-[680px]">
              <thead><tr><th className="th">Name</th><th className="th">Role</th><th className="th">Status</th><th className="th">Joined</th><th className="th"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>{data.members.map((m: any) => (
                <tr key={m.uid} className={cx(m.status !== 'active' && 'opacity-60')}>
                  <td className="td"><div className="font-medium">{m.name || m.email}{m.uid === me!.user.uid && <span className="text-faint font-normal"> (you)</span>}</div><div className="text-sm text-faint">{m.email}</div></td>
                  <td className="td">{ROLE_LABELS[m.role as Role]}{(m.extraPermissions?.length || m.revokedPermissions?.length) ? <div className="text-sm text-faint">Adjusted permissions</div> : null}</td>
                  <td className="td">{humanize(m.status)}</td><td className="td text-muted">{formatDate(m.joinedAt)}</td>
                  <td className="td text-right">{manage && m.uid !== me!.user.uid && (
                    <Menu trigger={(t) => <MoreButton label={`Actions for ${m.name || m.email}`} {...t} />} items={[
                      { label: 'Change role and permissions', onClick: () => setEdit(m) },
                      m.status === 'active' ? { label: 'Deactivate', onClick: () => setDeact(m), danger: true } : { label: 'Reactivate', onClick: () => update.run({ uid: m.uid, status: 'active' }).then(() => toast('Reactivated')) },
                    ]} />
                  )}</td>
                </tr>
              ))}</tbody>
            </table></div>
            <div className="mt-3"><FormError error={update.error} /></div>
          </section>
          {manage && data.invitations.length > 0 && (
            <section><h2 className="text-lg font-semibold pb-3 border-b border-charcoal/80">Pending invitations</h2>
              <ul>{data.invitations.map((i: any) => (
                <li key={i.id} className="py-3.5 border-b border-line flex flex-wrap justify-between items-center gap-3"><span>{i.email} <span className="text-muted">· {ROLE_LABELS[i.role as Role]}</span> <span className="text-sm text-faint">· expires {formatDate(i.expiresAt)}</span></span><button className="btn-ghost btn-sm" onClick={() => revoke.run({ invitationId: i.id }).then(() => toast('Invitation withdrawn'))}>Withdraw</button></li>
              ))}</ul>
            </section>
          )}
          <section>
            <h2 className="text-lg font-semibold pb-3 border-b border-charcoal/80">Roles</h2>
            <dl className="grid md:grid-cols-2 gap-x-12">{(Object.keys(ROLE_LABELS) as Role[]).map((r) => <div key={r} className="py-4 border-b border-line"><dt className="font-medium">{ROLE_LABELS[r]}</dt><dd className="text-muted mt-1">{ROLE_DESCRIPTIONS[r]}</dd></div>)}</dl>
          </section>
        </div>
      )}
      {invite && <InviteDialog onClose={() => setInvite(false)} />}
      {edit && <EditMember member={edit} onClose={() => setEdit(null)} />}
      <Confirm open={!!deact} onClose={() => setDeact(null)} danger title={`Deactivate ${deact?.name || deact?.email}?`} confirmLabel="Deactivate" busy={update.busy} onConfirm={async () => { await update.run({ uid: deact.uid, status: 'deactivated' }); setDeact(null); toast('Deactivated'); }}>
        They lose access immediately and are signed out everywhere. Their history stays in the audit trail.
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
    <Dialog open onClose={onClose} title="Invite someone" footer={res ? <button className="btn-primary" onClick={onClose}>Done</button> : <><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy || !email} onClick={async () => { try { setRes(await run({ email, role })); } catch { /* shown */ } }}>{busy && <Spinner />}Send invitation</button></>}>
      {res ? <div className="space-y-4"><Callout tone={res.emailStatus === 'failed' ? 'warn' : 'ok'} title="Invitation created">{res.emailStatus === 'failed' ? `The email couldn't be sent (${res.emailError}). Share this link with them directly — it expires in 7 days.` : `We've emailed ${email}. The invitation expires in 7 days.`}</Callout>
        {res.emailStatus === 'failed' && <div className="flex gap-2"><input className="input text-xs font-mono" readOnly value={res.inviteUrl} aria-label="Invitation link" /><button className="btn-secondary btn-sm h-10" onClick={() => navigator.clipboard.writeText(res.inviteUrl).then(() => toast('Copied'))}>Copy</button></div>}</div> : (
        <div className="space-y-5">
          <Field label="Email address"><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
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
    <Drawer open onClose={onClose} title={member.name || member.email} description="Changes take effect immediately and are recorded in the audit log." footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy} onClick={async () => { await run({ uid: member.uid, role, extraPermissions: extra.filter((p) => !base.has(p)), revokedPermissions: revoked.filter((p) => base.has(p)) }); toast('Access updated'); onClose(); }}>{busy && <Spinner />}Save</button></>}>
      <div className="space-y-8">
        <Field label="Role" hint={ROLE_DESCRIPTIONS[role]}><select className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>{(Object.keys(ROLE_LABELS) as Role[]).filter((r) => r !== 'owner' || me!.member!.role === 'owner').map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select></Field>
        <fieldset><legend className="label">Permissions</legend><p className="hint -mt-1 mb-4">Fine-tune on top of the role.</p>
          <div className="space-y-3">{ALL_PERMS.map((p) => <Checkbox key={p} checked={effective(p)} onChange={(v) => toggle(p, v)} label={PERM_LABELS[p]} hint={base.has(p) ? 'Part of this role' : 'Added for this person'} />)}</div>
        </fieldset>
        <FormError error={error} />
      </div>
    </Drawer>
  );
}
