import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useSession } from '../../lib/session';
import { cx, Logo } from '../../ui';

export function PublicNav({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const { authUser } = useSession();
  const { pathname } = useLocation();
  const dark = tone === 'dark';
  const anchor = (id: string) => (pathname === '/' ? `#${id}` : `/#${id}`);
  const quiet = dark ? 'btn text-white/70 hover:text-white hover:bg-white/[0.06] px-3' : 'btn-ghost';
  return (
    <header className={dark ? 'relative z-30' : 'border-b border-line bg-canvas/95 backdrop-blur sticky top-0 z-30'}>
      <div className="max-w-6xl mx-auto px-5 sm:px-8 h-16 sm:h-[4.5rem] flex items-center justify-between gap-4">
        <Link to="/" aria-label="SubCleared home"><Logo inverse={dark} /></Link>
        <nav className="flex items-center gap-1 sm:gap-2" aria-label="Site">
          <a href={anchor('how')} className={cx(quiet, 'hidden md:inline-flex')}>How it works</a>
          <a href={anchor('features')} className={cx(quiet, 'hidden md:inline-flex')}>Features</a>
          <Link to="/pricing" className={cx(quiet, 'hidden sm:inline-flex')}>Pricing</Link>
          {authUser ? <Link to="/app/overview" className={dark ? 'btn bg-white text-night hover:bg-white/90' : 'btn-primary'}>Open SubCleared</Link> : <>
            <Link to="/login" className={quiet}>Sign in</Link>
            <Link to="/signup" className={dark ? 'btn bg-white text-night hover:bg-white/90' : 'btn-primary'}>Get started</Link>
          </>}
        </nav>
      </div>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="border-t border-line mt-24 sm:mt-32">
      <div className="max-w-6xl mx-auto px-5 sm:px-8 py-12 grid sm:grid-cols-[1fr_auto] gap-8 text-sm text-muted">
        <div><Logo descriptor /><p className="mt-5 max-w-md leading-relaxed">For contractors who need to know which subcontractors are ready to work. SubCleared is not an insurance broker and does not make legal coverage determinations.</p></div>
        <nav className="flex flex-wrap gap-x-6 gap-y-3 items-start" aria-label="Footer"><a href="/#how" className="hover:text-ink">How it works</a><a href="/#features" className="hover:text-ink">Features</a><Link to="/pricing" className="hover:text-ink">Pricing</Link><Link to="/login" className="hover:text-ink">Sign in</Link><Link to="/signup" className="hover:text-ink">Get started</Link></nav>
      </div>
    </footer>
  );
}

export function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <PublicNav />
      <main className="flex-1 grid place-items-center px-5 py-16">
        <div className="w-full max-w-[27rem]">
          <h1 className="text-2xl font-medium">{title}</h1>
          {subtitle && <p className="text-muted mt-2 leading-relaxed">{subtitle}</p>}
          <div className="mt-8">{children}</div>
          {footer && <div className="mt-8 pt-6 border-t border-line text-sm text-muted">{footer}</div>}
        </div>
      </main>
    </div>
  );
}
