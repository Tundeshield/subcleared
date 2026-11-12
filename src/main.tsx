import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { SessionProvider } from './lib/session';
import './styles.css';
import { reloadForUpdate } from './lib/lazyPage';
import { ToastProvider } from './ui';

// A preloaded file from an older release is missing: load the current release instead of failing.
window.addEventListener('vite:preloadError', (e) => { if (reloadForUpdate()) e.preventDefault(); });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </SessionProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
