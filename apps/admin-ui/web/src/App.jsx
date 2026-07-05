import { Suspense, lazy } from 'react';
import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';

// Lazy-load the lower-traffic routes so the initial dashboard ships less JS.
const Users = lazy(() => import('./pages/Users'));
const UserDetail = lazy(() => import('./pages/UserDetail'));
const Groups = lazy(() => import('./pages/Groups'));
const GroupDetail = lazy(() => import('./pages/GroupDetail'));
const Invite = lazy(() => import('./pages/Invite'));
const Audit = lazy(() => import('./pages/Audit'));
const NotFound = lazy(() => import('./pages/NotFound'));

function RouteFallback() {
  return (
    <div className="flex items-center justify-center py-16 text-sm text-zinc-500">
      Loading…
    </div>
  );
}

function Lazy({ Component }) {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Component />
    </Suspense>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/users" element={<Lazy Component={Users} />} />
        <Route path="/users/:id" element={<Lazy Component={UserDetail} />} />
        <Route path="/groups" element={<Lazy Component={Groups} />} />
        <Route path="/groups/:name" element={<Lazy Component={GroupDetail} />} />
        <Route path="/invite" element={<Lazy Component={Invite} />} />
        <Route path="/audit" element={<Lazy Component={Audit} />} />
        <Route path="*" element={<Lazy Component={NotFound} />} />
      </Route>
    </Routes>
  );
}
