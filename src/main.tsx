import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './auth/AuthProvider';
import { ActingProvider } from './acting/ActingProvider';
import { NotificationsProvider } from './notifications/NotificationsProvider';
import './styles/global.css';

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
