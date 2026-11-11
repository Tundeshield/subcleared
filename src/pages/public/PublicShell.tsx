import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '../../lib/session';
import { Logo } from '../../ui';

export function PublicNav() {
  const { authUser } = useSession();
  return (
    <header className="border-b border-line bg-canvas/95 backdrop-blur sticky top-0 z-30">
      <div className="max-w-6xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
        <Link to="/" aria-label="SubCleared home"><Logo /></Link>
        <nav className="flex items-center gap-1 sm:gap-2" aria-label="Site">
          <Link to="/pricing" className="btn-ghost">Pricing</Link>
          {authUser ? <Link to="/app/overview" className="btn-primary">Open SubCleared</Link> : <>
            <Link to="/login" className="btn-ghost">Sign in</Link>
            <Link to="/signup" className="btn-primary hidden sm:inline-flex">Start free trial</Link>
          </>}
        </nav>
      </div>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="border-t border-line mt-28">
      <div className="max-w-6xl mx-auto px-5 sm:px-8 py-12 grid sm:grid-cols-[1fr_auto] gap-8 text-sm text-muted">
        <div><Logo descriptor /><p className="mt-5 max-w-md leading-relaxed">For contractors who need to know which subcontractors are ready to work. SubCleared is not an insurance broker and does not make legal coverage determinations.</p></div>
        <nav className="flex gap-6 items-start" aria-label="Footer"><Link to="/pricing" className="hover:text-ink">Pricing</Link><Link to="/login" className="hover:text-ink">Sign in</Link><Link to="/signup" className="hover:text-ink">Start free trial</Link></nav>
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
