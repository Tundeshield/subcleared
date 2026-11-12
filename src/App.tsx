import { Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useSession } from './lib/session';
import AppLayout from './pages/app/AppLayout';
import { AcceptInvite, AuthAction, ForgotPassword, Login, Onboarding, Signup, VerifyNotice } from './pages/public/Auth';
import Landing from './pages/public/Landing';
import Pricing from './pages/public/Pricing';
import Design from './pages/public/Design';
import { LoadingBlock, PageLoading } from './ui';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { lazyPage } from './lib/lazyPage';

const Overview = lazyPage(() => import('./pages/app/Overview'));
const Projects = lazyPage(() => import('./pages/app/Projects'));
const ProjectDetail = lazyPage(() => import('./pages/app/ProjectDetail'));
const Subcontractors = lazyPage(() => import('./pages/app/Subcontractors'));
const SubDetail = lazyPage(() => import('./pages/app/SubDetail'));
const Requirements = lazyPage(() => import('./pages/app/Requirements'));
const Documents = lazyPage(() => import('./pages/app/Documents'));
const DocumentDetail = lazyPage(() => import('./pages/app/DocumentDetail'));
const Reviews = lazyPage(() => import('./pages/app/Reviews'));
const Inbox = lazyPage(() => import('./pages/app/Inbox'));
const ReviewDetail = lazyPage(() => import('./pages/app/ReviewDetail'));
const Renewals = lazyPage(() => import('./pages/app/Renewals'));
const Compliance = lazyPage(() => import('./pages/app/Compliance'));
const Reports = lazyPage(() => import('./pages/app/Reports'));
const Notifications = lazyPage(() => import('./pages/app/Notifications'));
const Settings = lazyPage(() => import('./pages/app/Settings'));
const Team = lazyPage(() => import('./pages/app/Team'));
const Billing = lazyPage(() => import('./pages/app/Billing'));
const Portal = lazyPage(() => import('./pages/portal/Portal'));
const DevMailbox = lazyPage(() => import('./pages/public/DevMailbox'));

function FullScreenLoading() {
  return <LoadingBlock className="min-h-screen" />;
}

function RequireOrg({ children }: { children: ReactNode }) {
  const { ready, authUser, me, error } = useSession();
  const loc = useLocation();
  if (!ready) return <FullScreenLoading />;
  if (!authUser) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (!authUser.emailVerified && !me?.user.emailVerified) return <Navigate to="/verify-email" replace />;
  if (error && !me) return <div className="min-h-screen grid place-items-center p-6"><div className="max-w-md"><p className="text-lg font-medium">We couldn't load your account.</p><p className="text-muted mt-2">{error}</p><button className="btn-secondary mt-5" onClick={() => location.reload()}>Reload</button></div></div>;
  if (!me?.org) return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <ErrorBoundary full>
    <Suspense fallback={<FullScreenLoading />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="/design" element={<Design />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/auth/action" element={<AuthAction />} />
        <Route path="/verify-email" element={<VerifyNotice />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/accept-invite" element={<AcceptInvite />} />
        <Route path="/portal/:token" element={<Portal />} />
        <Route path="/dev/mailbox" element={<DevMailbox />} />
        <Route path="/app" element={<RequireOrg><AppLayout /></RequireOrg>}>
          <Route index element={<Navigate to="overview" replace />} />
          <Route path="overview" element={<S><Overview /></S>} />
          <Route path="projects" element={<S><Projects /></S>} />
          <Route path="projects/:id" element={<S><ProjectDetail /></S>} />
          <Route path="subcontractors" element={<S><Subcontractors /></S>} />
          <Route path="subcontractors/:id" element={<S><SubDetail /></S>} />
          <Route path="requirements" element={<S><Requirements /></S>} />
          <Route path="documents" element={<S><Documents /></S>} />
          <Route path="documents/:id" element={<S><DocumentDetail /></S>} />
          <Route path="reviews" element={<S><Reviews /></S>} />
          <Route path="reviews/:versionId" element={<S><ReviewDetail /></S>} />
          <Route path="renewals" element={<S><Renewals /></S>} />
          <Route path="inbox" element={<S><Inbox /></S>} />
          <Route path="compliance" element={<S><Compliance /></S>} />
          <Route path="reports" element={<S><Reports /></S>} />
          <Route path="notifications" element={<S><Notifications /></S>} />
          <Route path="team" element={<S><Team /></S>} />
          <Route path="billing" element={<S><Billing /></S>} />
          <Route path="settings" element={<Navigate to="organisation" replace />} />
          <Route path="settings/users" element={<KeepQuery to="/app/team" />} />
          <Route path="settings/billing" element={<KeepQuery to="/app/billing" />} />
          <Route path="settings/:section" element={<S><Settings /></S>} />
          <Route path="*" element={<div className="py-16"><h1 className="text-2xl font-medium">Page not found</h1><p className="text-muted mt-2">That page doesn't exist. Use the navigation to find what you need.</p></div>} />
        </Route>
        <Route path="*" element={<div className="min-h-screen grid place-items-center px-6"><div><h1 className="text-2xl font-medium">Page not found</h1><p className="text-muted mt-2">That address doesn't match anything in SubCleared.</p><a href="/" className="btn-secondary mt-6">Go to the home page</a></div></div>} />
      </Routes>
    </Suspense>
    </ErrorBoundary>
  );
}

/** Each page has its own error boundary, reset when the address changes, so one failure doesn't take down the layout. */
function S({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <ErrorBoundary key={pathname}><Suspense fallback={<PageLoading />}>{children}</Suspense></ErrorBoundary>;
}

/** Old addresses (in past emails, Stripe settings and bookmarks) keep working, query string included. */
function KeepQuery({ to }: { to: string }) {
  const { search, hash } = useLocation();
  return <Navigate to={`${to}${search}${hash}`} replace />;
}
