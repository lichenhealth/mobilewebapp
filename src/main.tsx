import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './auth/AuthProvider';
import { ActingProvider } from './acting/ActingProvider';
import { NotificationsProvider } from './notifications/NotificationsProvider';
import { startAutoUpdate } from './lib/autoUpdate';
import './styles/global.css';

// Register the push service worker (no-op for members who never opt in; keeps
// an already-subscribed device's SW active across sessions).
if ('serviceWorker' in navigator && 'PushManager' in window) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  });
}

// Reload when a new build deploys, so installed PWAs never run a stale version.
startAutoUpdate();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ActingProvider>
          <NotificationsProvider>
            <App />
          </NotificationsProvider>
        </ActingProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
