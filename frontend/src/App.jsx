import { Suspense, lazy } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import ErrorBoundary from './components/ErrorBoundary';
import Layout from './components/Layout';
import './styles/tokens.css';
import './styles/base.css';
import './styles/auth.css';
import './styles/landing.css';
import './styles/debate.css';

const LandingPage = lazy(() => import('./pages/LandingPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const HomePage = lazy(() => import('./pages/DebatePage'));
const AccountPage = lazy(() => import('./pages/AccountPage'));
const ChatPage = lazy(() => import('./pages/ChatPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

function RouteFallback() {
  return (
    <div className="page page--auth">
      <main className="main main--auth" aria-busy="true" aria-label="Завантаження">
        <p className="hero__text">Завантаження…</p>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route element={<Layout />}>
              <Route path="/home" element={<HomePage />} />
              <Route path="/chat/:id" element={<ChatPage />} />
              <Route path="/account" element={<AccountPage />} />
              <Route path="/history" element={<AccountPage />} />
              <Route path="/settings" element={<AccountPage />} />
              <Route path="/help" element={<AccountPage />} />
            </Route>
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
