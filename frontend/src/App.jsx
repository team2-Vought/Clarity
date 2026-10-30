import { Suspense, lazy } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import ErrorBoundary from './components/ErrorBoundary';
import { copy } from './copy';
import Layout from './components/Layout';
import './styles/tokens.css';
import './styles/base.css';
import './styles/auth.css';
import './styles/landing.css';
import './styles/debate.css';
import './styles/history.css';
import './styles/settings.css';
import './styles/help.css';
import './styles/journal.css';
import './styles/tools.css';

const LandingPage = lazy(() => import('./pages/LandingPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'));
const DebatePage = lazy(() => import('./pages/DebatePage'));
const HelpPage = lazy(() => import('./pages/HelpPage'));
const JournalPage = lazy(() => import('./pages/JournalPage'));
const HistoryPage = lazy(() => import('./pages/HistoryPage'));
const ChatPage = lazy(() => import('./pages/ChatPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));
const SharedPage = lazy(() => import('./pages/SharedPage'));

function RouteFallback() {
  return (
    <div className="page page--auth">
      <main className="main main--auth" aria-busy="true" aria-label={copy.common.loading}>
        <p className="hero__text">{copy.common.loading}</p>
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
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password/:uid/:token" element={<ResetPasswordPage />} />
            <Route path="/shared/:token" element={<SharedPage />} />
            <Route element={<Layout />}>
              <Route path="/home" element={<DebatePage />} />
              <Route path="/chat/:id" element={<ChatPage />} />
              <Route path="/account" element={<Navigate to="/settings" replace />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/journal" element={<JournalPage />} />
              <Route path="/help" element={<HelpPage />} />
            </Route>
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
