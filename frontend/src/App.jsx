import { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import ErrorBoundary from './components/ErrorBoundary';
import { copy } from './copy';
import Layout from './components/Layout';
import VisionDialog from './components/VisionDialog';
import BugReportDialog from './components/BugReportDialog';
import ConfirmDialog from './components/ConfirmDialog';
import { getSession, keepServerWarm } from './api/client';
import logoThinking from './assets/logo-thinking.svg';
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
import './styles/report.css';
import './styles/marks.css';
import './styles/tree.css';
import './styles/legal.css';
// останнім: режим для слабозорих перебиває стилі сторінок
import './styles/vision.css';

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
const UnsubscribePage = lazy(() => import('./pages/UnsubscribePage'));
const VerifyEmailPage = lazy(() => import('./pages/VerifyEmailPage'));
const LegalPage = lazy(() => import('./pages/LegalPage'));
const DebatePage = lazy(loadDebate);
const HelpPage = lazy(() => import('./pages/HelpPage'));
const JournalPage = lazy(loadJournal);
const HistoryPage = lazy(loadHistory);
const ChatPage = lazy(loadChat);
const SettingsPage = lazy(loadSettings);
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));
const SharedPage = lazy(() => import('./pages/SharedPage'));

// поки вантажиться сторінка — знак Clarity, що «думає», а не голий текст
function RouteFallback() {
  return (
    <div className="route-loading" role="status" aria-label={copy.common.loading}>
      <img src={logoThinking} alt="" width="72" height="50" />
    </div>
  );
}

// Коли браузер звільнився після першого рендеру, тихо підтягуємо сторінки,
// куди людина найімовірніше піде далі, — перехід стає миттєвим, без «Завантаження…».
// Увійшовши — основні сторінки застосунку; інакше — лише вхід і реєстрацію.
function usePreloadPages() {
  useEffect(() => {
    // будимо API й тримаємо теплим кожні 10 хв, поки вкладка відкрита (Render Free засинає)
    const stopKeepWarm = keepServerWarm();
    const pages = getSession()
      ? [loadDebate, loadChat, loadHistory, loadJournal, loadSettings]
      : [loadLogin, loadRegister];
    const preload = () => pages.forEach((load) => load().catch(() => {}));
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(preload, { timeout: 4000 });
      return () => {
        stopKeepWarm();
        window.cancelIdleCallback(id);
      };
    }
    const timer = setTimeout(preload, 1500);
    return () => {
      stopKeepWarm();
      clearTimeout(timer);
    };
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
            <Route path="/unsubscribe/:token" element={<UnsubscribePage />} />
            <Route path="/verify-email/:token" element={<VerifyEmailPage />} />
            <Route path="/privacy" element={<LegalPage doc="privacy" />} />
            <Route path="/terms" element={<LegalPage doc="terms" />} />
            <Route path="/shared/:token" element={<SharedPage />} />
            <Route path="/examples/:slug" element={<SharedPage />} />
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
        <VisionDialog />
        <BugReportDialog />
        <ConfirmDialog />
      </BrowserRouter>
    </ErrorBoundary>
  );
}
