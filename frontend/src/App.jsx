import { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import ErrorBoundary from './components/ErrorBoundary';
import { copy } from './copy';
import Layout from './components/Layout';
import { getSession } from './api/client';
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
import './styles/status.css';

const loadLogin = () => import('./pages/LoginPage');
const loadRegister = () => import('./pages/RegisterPage');
const loadDebate = () => import('./pages/DebatePage');
const loadJournal = () => import('./pages/JournalPage');
const loadHistory = () => import('./pages/HistoryPage');
const loadChat = () => import('./pages/ChatPage');
const loadSettings = () => import('./pages/SettingsPage');

const LandingPage = lazy(() => import('./pages/LandingPage'));
const LoginPage = lazy(loadLogin);
const RegisterPage = lazy(loadRegister);
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'));
const ConfirmEmailPage = lazy(() => import('./pages/ConfirmEmailPage'));
const DebatePage = lazy(loadDebate);
const HelpPage = lazy(() => import('./pages/HelpPage'));
const JournalPage = lazy(loadJournal);
const HistoryPage = lazy(loadHistory);
const ChatPage = lazy(loadChat);
const SettingsPage = lazy(loadSettings);
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

// Коли браузер звільнився після першого рендеру, тихо підтягуємо сторінки,
// куди людина найімовірніше піде далі, — перехід стає миттєвим, без «Завантаження…».
// Увійшовши — основні сторінки застосунку; інакше — лише вхід і реєстрацію.
function usePreloadPages() {
  useEffect(() => {
    const pages = getSession()
      ? [loadDebate, loadChat, loadHistory, loadJournal, loadSettings]
      : [loadLogin, loadRegister];
    const preload = () => pages.forEach((load) => load().catch(() => {}));
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(preload, { timeout: 4000 });
      return () => window.cancelIdleCallback(id);
    }
    const timer = setTimeout(preload, 1500);
    return () => clearTimeout(timer);
  }, []);
}

export default function App() {
  usePreloadPages();
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
            <Route path="/confirm-email/:token" element={<ConfirmEmailPage />} />
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
