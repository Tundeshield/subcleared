import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '../../lib/session';
import { Logo } from '../../ui';

export function PublicNav() {
  const { authUser } = useSession();
  return (
    <header className="sticky top-0 z-30 border-b border-line/70 bg-bg/80 backdrop-blur">
      <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
        <Link to="/" aria-label="SubCleared home"><Logo /></Link>
        <nav className="flex items-center gap-1 sm:gap-2">
          <Link to="/pricing" className="btn-ghost">Pricing</Link>
          {authUser ? <Link to="/app/overview" className="btn-primary">Open app</Link> : <>
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
    <footer className="border-t border-line mt-24">
      <div className="max-w-6xl mx-auto px-5 py-10 flex flex-col sm:flex-row gap-6 justify-between text-sm text-muted">
        <div><Logo /><p className="mt-3 max-w-sm">Subcontractor compliance and readiness for general contractors. SubCleared is not an insurance broker and does not make legal coverage determinations.</p></div>
        <div className="flex gap-6"><Link to="/pricing" className="hover:text-ink">Pricing</Link><Link to="/login" className="hover:text-ink">Sign in</Link><Link to="/signup" className="hover:text-ink">Start free trial</Link></div>
      </div>
    </footer>
  );
}

export function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <PublicNav />
      <div className="flex-1 grid place-items-center px-5 py-12">
        <div className="w-full max-w-[26rem]">
          <h1 className="text-2xl font-semibold">{title}</h1>
          {subtitle && <p className="text-muted mt-2">{subtitle}</p>}
          <div className="mt-6">{children}</div>
          {footer && <div className="mt-6 text-sm text-muted">{footer}</div>}
        </div>
      </div>
    </div>
  );
}
