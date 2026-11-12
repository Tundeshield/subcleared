// The SubCleared design kit, rendered with the real components. This page is
// the visual source of truth; docs/design-system.md carries the same rules.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Breadcrumbs, Callout, Checkbox, Confirm, DocStatus, Drawer, Empty, Field, FilterSelect, HelpTip, Logo, Mark, Menu, Metric, MoreButton, Pagination, Progress, Radio,
  ReadinessBadge, ReadinessBar, SearchInput, Segmented, Skeleton, Spinner, StatusText, Tabs, Tooltip, useToast, VerificationLabel,
} from '../../ui';

type Swatch = [name: string, hex: string, use: string];
const DIRECTIONS: { id: string; name: string; chosen?: boolean; verdict: string; tokens: Swatch[]; status: Swatch[] }[] = [
  {
    id: 'a', name: 'Site Ivory', verdict: 'Warm and calm, and the previous identity. The green accent is also the natural colour for "ready", so actions and status blur together, and with no status colours "expired" and "awaiting review" differ only by glyph shape. It reads heritage rather than precise.',
    tokens: [['Primary background', '#F6F5F0', ''], ['Secondary background', '#FBFAF7', ''], ['Primary text', '#252B27', ''], ['Secondary text', '#525753', ''], ['Brand accent', '#52745F', ''], ['Primary action', '#52745F', ''], ['Borders', '#DDDDD6', '']],
    status: [['Success', '#52745F', ''], ['Warning', '#252B27', 'shape only'], ['Error', '#252B27', 'shape only'], ['Info', '#525753', 'shape only']],
  },
  {
    id: 'b', name: 'Ink, White & Deep Teal', chosen: true, verdict: 'Soft grey carries the page, white carries the work, ink carries the words. One deep teal marks what you can act on and where you are, used sparingly so it always stands out. Four restrained status colours stay separate from teal, so problems are visible at a glance.',
    tokens: [['Page background', '#F4F6F5', 'App canvas'], ['Surfaces', '#FFFFFF', 'Sidebar, top bar, forms, panels, dialogs'], ['Muted surface', '#EDF1EF', 'Hover, selected rows and navigation, skeletons'], ['Primary ink', '#171C20', 'Headings, body, values'], ['Secondary text', '#556068', 'Descriptions, supporting copy'], ['Metadata text', '#667078', 'Timestamps, hints, labels'], ['Deep teal / primary action', '#087E80', 'Primary buttons, active navigation, focus ring'], ['Teal text', '#066B6D', 'Links and teal text (AA on every surface)'], ['Borders', '#E2E7E5', 'Dividers, table rows'], ['Strong borders', '#C5CECB', 'Inputs, section rules']],
    status: [['Success', '#1E784A', 'Ready, approved, in date'], ['Warning', '#9B5800', 'Expiring soon, needs attention'], ['Error', '#B22218', 'Not ready, expired, rejected, missing'], ['Info', '#295999', 'Awaiting review, in progress']],
  },
  {
    id: 'c', name: 'Stone & Signal', verdict: 'Energetic, with black primary buttons and a signal-orange accent. Orange reads as hi-vis site clothing — a construction cliché — and competes directly with the amber used for warnings, so attention states lose their meaning.',
    tokens: [['Primary background', '#F5F4F2', ''], ['Secondary background', '#FFFFFF', ''], ['Primary text', '#1C1917', ''], ['Secondary text', '#57534E', ''], ['Brand accent', '#C2410C', ''], ['Primary action', '#1C1917', ''], ['Borders', '#E7E5E4', '']],
    status: [['Success', '#15803D', ''], ['Warning', '#B45309', ''], ['Error', '#B91C1C', ''], ['Info', '#1D4ED8', '']],
  },
];

const FONTS: [string, string][] = [
  ['Inter — chosen', 'The clearest figures in dense tables (true tabular numbers, a distinct 1/l/I), excellent legibility from 13 to 32 px, and the widest language coverage of the four — important for a product used in many countries. Its familiarity is offset by SubCleared’s own mark, colour and layout.'],
  ['IBM Plex Sans', 'Previous choice. Characterful and precise, but slightly wide in tables and less neutral across languages; still used as the monospace companion (Plex Mono) for references and codes.'],
  ['Geist', 'Crisp and modern; slightly condensed, and its figures are less distinct in dense tables of dates and amounts.'],
  ['Manrope', 'Geometric and friendly; weaker over long tables, and I/l/1 are easy to confuse in reference numbers.'],
]

const TYPE: [string, string, string][] = [
  ['Page title', 'text-2xl font-medium', '28 / 34 · 500'],
  ['Section heading', 'text-lg font-semibold', '18 / 26 · 600'],
  ['Subheading', 'text-md font-semibold', '16 / 25 · 600'],
  ['Body', 'text-base', '15 / 24 · 400'],
  ['Supporting text', 'text-sm text-muted', '14 / 22 · 400'],
  ['Label', 'text-sm font-medium', '14 / 22 · 500'],
  ['Table heading', 'text-xs font-medium text-muted', '13 / 19 · 500'],
  ['Metadata', 'text-xs text-faint', '13 / 19 · 400'],
  ['Metric', 'text-[2rem] leading-none tnum', '32 / 32 · 400, tabular'],
];

const TOKENS: [string, string][] = [
  ['Spacing scale', '4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 56 · 72 px (Tailwind 1–18)'],
  ['Layout widths', 'Content 1320 px · reading 768 px · drawer 576 px · dialog 512 px · portal 576 px'],
  ['Breakpoints', '640 · 768 · 1024 (sidebar appears) · 1280 px'],
  ['Radii', '4 px controls · 6 px panels and callouts · 8 px dialogs · full for avatars'],
  ['Borders', '1 px hairlines only; strong border for inputs and section rules'],
  ['Shadows', 'Only for layers above the page: popovers/menus and drawers'],
  ['Icon sizes', '13 px in tables · 15 px inline status · 16 px controls · 20 px empty states'],
  ['Control heights', 'Buttons 32 / 40 / 48 px · inputs 40 px (48 px in the subcontractor portal)'],
  ['Table density', 'Comfortable: 16 px vertical cell padding, 15 px text; never below 13 px'],
  ['Focus', '2 px accent outline, 2 px offset, on every interactive element'],
  ['Hover', 'Muted surface (#EDF1EF) on rows and quiet buttons; darker accent on primary'],
  ['Disabled', '45% opacity, no pointer events, never the only way an action is explained'],
];

export default function Design() {
  const [tab, setTab] = useState<'one' | 'two' | 'three'>('one');
  const [seg, setSeg] = useState<'all' | 'mine'>('all');
  const [chk, setChk] = useState(true);
  const [radio, setRadio] = useState('a');
  const [q, setQ] = useState('');
  const [f, setF] = useState('');
  const [page, setPage] = useState(1);
  const [drawer, setDrawer] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const toast = useToast();
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-paper"><div className="max-w-content mx-auto px-6 h-16 flex items-center justify-between"><Link to="/"><Logo /></Link><span className="text-sm text-muted">Design kit</span></div></header>
      <main className="max-w-content mx-auto px-6 py-14 space-y-20">
        <section>
          <p className="eyebrow">SubCleared design kit</p>
          <h1 className="text-[2.25rem] leading-tight font-medium mt-3 max-w-3xl">The rules every screen follows.</h1>
          <p className="text-muted mt-4 max-w-2xl leading-relaxed">Neutrals carry the interface. One accent shows what you can act on and where you are. Status colours are reserved for meaning and always come with an icon and words. Everything below is rendered with the components the application uses.</p>
        </section>

        <K title="Identity" description="The mark is a site barrier with its arm raised: the way is clear to start work. It avoids shields, hard hats, buildings and checkmarks, and stays legible at 16 px.">
          <div className="grid md:grid-cols-3 gap-10 items-end">
            <div><Logo descriptor className="scale-125 origin-left" /><p className="text-xs text-faint mt-6">Primary horizontal wordmark</p></div>
            <div className="flex items-end gap-6"><Mark className="w-16 h-16" /><Mark className="w-8 h-8" /><Mark className="w-5 h-5" /><p className="text-xs text-faint">Compact symbol</p></div>
            <div className="flex items-end gap-6"><img src="/favicon.svg" alt="" className="w-16 h-16" /><img src="/favicon.svg" alt="" className="w-8 h-8" /><img src="/favicon.svg" alt="" className="w-4 h-4" /><p className="text-xs text-faint">Favicon / app icon</p></div>
          </div>
          <p className="text-sm text-muted mt-8 max-w-2xl">Wordmark: Inter 600 with −2% tracking. Icon style: 1.5 px outline icons on a 16 px grid, used only where they help recognition (search, notifications, upload). Navigation is text-only.</p>
        </K>

        <K title="Colour directions" description="Three directions were evaluated against the same needs: calm, trustworthy, distinct from insurers and document tools, and able to show status clearly.">
          <div className="grid lg:grid-cols-3 gap-8">
            {DIRECTIONS.map((d) => (
              <article key={d.id} className={d.chosen ? 'rounded-lg border-2 border-accent bg-paper p-5' : 'rounded-lg border border-line bg-paper p-5'}>
                <div className="flex items-center justify-between gap-3"><h3 className="font-semibold">{d.name}</h3>{d.chosen && <span className="text-xs font-medium text-accent-ink">Selected</span>}</div>
                <div className="flex mt-4 h-10 rounded overflow-hidden border border-line">{d.tokens.slice(0, 7).map(([n, h]) => <span key={n} title={`${n} ${h}`} className="flex-1" style={{ background: h }} />)}</div>
                <div className="flex mt-2 h-3 rounded overflow-hidden">{d.status.map(([n, h]) => <span key={n} title={`${n} ${h}`} className="flex-1" style={{ background: h }} />)}</div>
                <p className="text-sm text-muted mt-4 leading-relaxed">{d.verdict}</p>
                <dl className="mt-4 text-xs grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">{[...d.tokens.slice(0, 7), ...d.status].map(([n, h, u]) => <div key={n} className="contents"><dt className="text-faint">{n}</dt><dd className="font-mono">{h}{u === 'shape only' && <span className="text-faint"> (shape only)</span>}</dd></div>)}</dl>
              </article>
            ))}
          </div>
          <h3 className="font-semibold mt-12">Selected palette and where each colour is used</h3>
          <div className="mt-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-x-8">
            {[...DIRECTIONS[1].tokens, ...DIRECTIONS[1].status].map(([n, h, u]) => (
              <div key={n} className="flex items-center gap-4 py-3 border-b border-line"><span className="h-10 w-10 rounded border border-line shrink-0" style={{ background: h }} /><div className="min-w-0"><div className="text-sm font-medium">{n} <span className="font-mono font-normal text-faint">{h}</span></div><div className="text-xs text-muted">{u}</div></div></div>
            ))}
          </div>
          <p className="text-sm text-muted mt-6 max-w-3xl">Each status colour also has a tint used only for callout backgrounds (#E9F4ED, #FBF2E4, #FCECEA, #EBF1FA). All text colours meet WCAG AA on the canvas; primary text, the accent and every status colour exceed 4.5:1.</p>
        </K>

        <K title="Typography" description="One family (Inter), three weights. Sizes were chosen for comfortable reading at desktop distance; nothing operational is smaller than 13 px.">
          <div className="grid lg:grid-cols-[1fr_1fr] gap-12">
            <div>{TYPE.map(([n, cls, spec]) => <div key={n} className="flex items-baseline justify-between gap-6 py-3 border-b border-line"><span className={cls}>{n === 'Metric' ? '24 of 31' : n}</span><span className="text-xs text-faint font-mono whitespace-nowrap">{spec}</span></div>)}</div>
            <div className="space-y-4">{FONTS.map(([n, t]) => <div key={n}><div className="text-sm font-medium">{n}</div><p className="text-sm text-muted">{t}</p></div>)}</div>
          </div>
        </K>

        <K title="Tokens">
          <dl className="grid md:grid-cols-2 gap-x-12">{TOKENS.map(([k, v]) => <div key={k} className="py-3 border-b border-line grid grid-cols-[10rem_1fr] gap-4 text-sm"><dt className="font-medium">{k}</dt><dd className="text-muted">{v}</dd></div>)}</dl>
        </K>

        <K title="Status and feedback" description="Every state has its own mark and its own words. Colour appears only at the ends of the scale — done and blocking — so the interface never turns into a traffic light.">
          <div className="grid md:grid-cols-3 gap-10">
            <div className="space-y-3"><h4 className="text-xs font-medium text-muted">Readiness (per project)</h4>{['ready', 'action_required', 'not_ready', 'not_evaluated'].map((r) => <div key={r}><ReadinessBadge value={r} /></div>)}</div>
            <div className="space-y-3"><h4 className="text-xs font-medium text-muted">Requirement status</h4>{['approved', 'expiring_soon', 'awaiting_review', 'requested', 'missing', 'expired', 'rejected', 'not_applicable'].map((r) => <div key={r}><StatusText value={r} /></div>)}</div>
            <div className="space-y-3"><h4 className="text-xs font-medium text-muted">Document and verification</h4>{['approved', 'awaiting_review', 'expiring_soon', 'rejected', 'superseded'].map((r) => <div key={r}><DocStatus value={r} /></div>)}<div className="pt-2 space-y-1"><div><VerificationLabel value="received" /></div><div><VerificationLabel value="reviewed" /></div><div><VerificationLabel value="independently_verified" /></div></div></div>
          </div>
          <div className="grid md:grid-cols-2 gap-6 mt-10">
            <Callout tone="ok" title="Approved">The subcontractor has been told and readiness was updated.</Callout>
            <Callout tone="warn" title="2 documents expire this month">Requests go out automatically 30, 14 and 7 days before expiry.</Callout>
            <Callout tone="bad" title="Upload blocked">The file contained active content and was not accepted. Ask for a flattened PDF.</Callout>
            <Callout title="Received is not reviewed">A document counts towards readiness only after someone approves it.</Callout>
          </div>
          <div className="grid md:grid-cols-3 gap-10 mt-10">
            <div><h4 className="text-xs font-medium text-muted mb-3">Readiness bar</h4><ReadinessBar ready={5} action={2} notReady={2} total={9} /><p className="text-sm text-muted mt-2">5 of 9 ready · 2 need attention · 2 not ready</p></div>
            <div><h4 className="text-xs font-medium text-muted mb-3">Progress</h4><Progress value={0.62} /><p className="text-sm text-muted mt-2">Uploading… 62%</p></div>
            <div><h4 className="text-xs font-medium text-muted mb-3">Loading</h4><div className="flex items-center gap-3 text-sm text-muted"><Spinner />Loading projects…</div><Skeleton rows={2} /></div>
          </div>
        </K>

        <K title="Actions and forms">
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn-primary" onClick={() => toast('Request sent to 3 contacts')}>Request documents</button>
            <button className="btn-secondary">Export report</button>
            <button className="btn-ghost">Cancel</button>
            <button className="btn-quiet">View all</button>
            <button className="btn-danger" onClick={() => setConfirm(true)}>Remove from project</button>
            <button className="btn-primary" disabled>Disabled</button>
            <button className="btn-primary btn-sm">Small</button>
            <button className="btn-primary btn-lg">Large</button>
          </div>
          <p className="text-sm text-muted mt-3">One primary action per view, labelled with a verb and an object. Destructive actions always ask first.</p>
          <div className="grid md:grid-cols-3 gap-8 mt-10">
            <Field label="Legal business name" hint="As it appears on insurance documents."><input className="input" defaultValue="Northgate Electrical Ltd" /></Field>
            <Field label="Contact email" error="Enter an email address like name@company.com."><input className="input border-danger" defaultValue="sam@" aria-invalid /></Field>
            <Field label="Reference" optional><input className="input" disabled value="Locked after first request" readOnly /></Field>
            <Field label="Expiry date"><input type="date" className="input" defaultValue="2027-03-31" /></Field>
            <Field label="Trade"><select className="input" defaultValue="e"><option value="e">Electrical</option><option>Plumbing</option></select></Field>
            <Field label="Notes for the subcontractor"><textarea className="input" defaultValue="Please include the endorsement page." /></Field>
          </div>
          <div className="grid md:grid-cols-3 gap-8 mt-8">
            <div className="space-y-3"><Checkbox checked={chk} onChange={setChk} label="Mandatory" hint="Must be approved for readiness." /><Checkbox checked={false} onChange={() => undefined} label="Disabled option" disabled /></div>
            <div className="space-y-3"><Radio name="r" checked={radio === 'a'} onChange={() => setRadio('a')} label="Expires on a date" /><Radio name="r" checked={radio === 'b'} onChange={() => setRadio('b')} label="Never expires" hint="Registrations, signed agreements." /></div>
            <div className="space-y-4"><Segmented label="Scope" value={seg} onChange={setSeg} options={[{ value: 'all', label: 'All projects' }, { value: 'mine', label: 'My projects' }]} /><div className="flex items-center gap-2 text-sm">Readiness <HelpTip>Worked out separately for every project from that project's mandatory requirements.</HelpTip></div><Tooltip content="Opens the subcontractor's secure upload page in a new tab"><button className="btn-secondary btn-sm">Hover or focus me</button></Tooltip></div>
          </div>
        </K>

        <K title="Navigation and data">
          <Breadcrumbs items={[{ label: 'Projects', to: '/design' }, { label: 'Riverside Health Centre', to: '/design' }, { label: 'Northgate Electrical' }]} />
          <Tabs value={tab} onChange={setTab} tabs={[{ value: 'one', label: 'Readiness', count: 6 }, { value: 'two', label: 'Requirements', count: 8 }, { value: 'three', label: 'Documents' }]} />
          <div className="flex flex-wrap items-center gap-3 mt-6"><SearchInput value={q} onChange={setQ} placeholder="Search company, trade or contact" className="w-80" /><FilterSelect label="Readiness" value={f} onChange={setF} options={[{ value: 'ready', label: 'Ready' }, { value: 'not', label: 'Not ready' }]} />
            <Menu trigger={(t) => <MoreButton label="Row actions" {...t} />} items={[{ label: 'Request documents', onClick: () => toast('Opened request') }, { label: 'Open profile', onClick: () => undefined }, { label: 'Remove from project', onClick: () => setConfirm(true), danger: true }]} />
            <button className="btn-secondary" onClick={() => setDrawer(true)}>Open a side panel</button>
          </div>
          <div className="overflow-x-auto mt-6"><table className="table min-w-[720px]">
            <thead><tr><th className="th">Subcontractor</th><th className="th">Issues</th><th className="th">Readiness</th><th className="th text-right">Next step</th></tr></thead>
            <tbody>
              <tr><td className="td"><div className="font-medium">Northgate Electrical Ltd</div><div className="text-sm text-faint">Electrical</div></td><td className="td text-sm">2 missing · 1 awaiting review</td><td className="td"><ReadinessBadge value="not_ready" size="sm" /></td><td className="td text-right"><button className="btn-secondary btn-sm">Request documents</button></td></tr>
              <tr><td className="td"><div className="font-medium">Harbour Plumbing &amp; Heating</div><div className="text-sm text-faint">Plumbing</div></td><td className="td text-sm">1 expiring in 12 days</td><td className="td"><ReadinessBadge value="ready" size="sm" /></td><td className="td text-right"><button className="btn-ghost btn-sm">View</button></td></tr>
            </tbody>
          </table></div>
          <Pagination page={page} pages={4} setPage={setPage} total={92} size={25} />
          <div className="grid md:grid-cols-4 gap-6 mt-10"><Metric label="Active projects" value={6} to="/design" /><Metric label="Ready to work" value={24} emphasis="success" to="/design" hint="on every assigned project" /><Metric label="Requiring attention" value={7} emphasis="danger" to="/design" /><Metric label="Awaiting review" value={3} to="/design" /></div>
          <div className="mt-10"><Empty title="No subcontractors yet" action={<button className="btn-primary">Add a subcontractor</button>}>Add the companies you work with, then assign them to projects to see who is ready.</Empty></div>
        </K>
      </main>
      <Drawer open={drawer} onClose={() => setDrawer(false)} title="Edit subcontractor" description="Side panels hold contextual editing without leaving the page." footer={<><button className="btn-secondary" onClick={() => setDrawer(false)}>Cancel</button><button className="btn-primary" onClick={() => { setDrawer(false); toast('Saved'); }}>Save changes</button></>}>
        <div className="space-y-5"><Field label="Legal business name"><input className="input" defaultValue="Northgate Electrical Ltd" /></Field><Field label="Trade"><input className="input" defaultValue="Electrical" /></Field></div>
      </Drawer>
      <Confirm open={confirm} onClose={() => setConfirm(false)} title="Remove Northgate Electrical from this project?" confirmLabel="Remove" danger onConfirm={() => { setConfirm(false); toast('Removed from project'); }}>Their documents and history are kept. Readiness for this project stops being tracked.</Confirm>
    </div>
  );
}

function K({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="border-b border-line-strong pb-3 mb-8"><h2 className="text-xl font-medium">{title}</h2>{description && <p className="text-muted mt-1 max-w-3xl">{description}</p>}</div>
      {children}
    </section>
  );
}
