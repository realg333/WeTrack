import React from 'react';
import ReactDOM from 'react-dom/client';
import { lazy, Suspense } from 'react';
import Landing from './Landing';
import './styles.css';

const App = lazy(() => import('./App'));
const dashboardPages = new Set([
  'overview',
  'campaigns',
  'sales',
  'visits',
  'whatsapp',
  'rules',
  'integrations',
  'notifications',
  'settings',
]);
const legacyDashboard = dashboardPages.has(window.location.hash.slice(1));
if (window.location.pathname === '/' && legacyDashboard) {
  window.history.replaceState(null, '', `/app${window.location.search}${window.location.hash}`);
}
const isDashboard = /^\/(app|login)\/?$/.test(window.location.pathname);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isDashboard ? (
      <Suspense
        fallback={
          <div className="site-loading" role="status">
            Abrindo sua WeTrack…
          </div>
        }
      >
        <App />
      </Suspense>
    ) : (
      <Landing />
    )}
  </React.StrictMode>,
);
