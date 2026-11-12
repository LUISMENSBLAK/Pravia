import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './app/App';
import { listenForServiceWorkerUpdate } from './services/serviceWorkerUpdates';
import './styles/tokens.css';
import './styles/global.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

const serviceWorkerAllowed = import.meta.env.PROD || ['localhost', '127.0.0.1'].includes(window.location.hostname);
if (serviceWorkerAllowed && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').then((registration) => {
      const announce = (worker: ServiceWorker | null) => {
        if (worker) window.dispatchEvent(new CustomEvent('pravia:update-available', { detail: worker }));
      };
      if (registration.waiting) announce(registration.waiting);
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) announce(worker);
        });
      });
    });
  });
  listenForServiceWorkerUpdate(navigator.serviceWorker, () => window.location.reload());
}
