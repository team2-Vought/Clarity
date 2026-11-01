import { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { googleConfig, googleLogin } from '../api/auth';
import { useToasts } from '../hooks/useToasts';
import { copy } from '../copy';

const t = copy.google;
const SCRIPT_URL = 'https://accounts.google.com/gsi/client';

let scriptPromise = null;

// бібліотеку Google вантажимо один раз і лише там, де є кнопка
function loadGoogle() {
  if (window.google?.accounts?.oauth2) return Promise.resolve(window.google);
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = SCRIPT_URL;
      script.async = true;
      script.onload = () => resolve(window.google);
      script.onerror = () => {
        scriptPromise = null;
        reject(new Error(t.error));
      };
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
}

// фірмова «G» — Google вимагає саме її на кнопці входу
const GoogleMark = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
    <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.81z" />
    <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.92l-3.88-3c-1.07.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.28v3.1A12 12 0 0 0 12 24z" />
    <path fill="#FBBC05" d="M5.29 14.28A7.2 7.2 0 0 1 4.91 12c0-.79.14-1.56.38-2.28v-3.1H1.28A12 12 0 0 0 0 12c0 1.94.46 3.77 1.28 5.38l4.01-3.1z" />
    <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.44-3.44A11.5 11.5 0 0 0 12 0 12 12 0 0 0 1.28 6.62l4.01 3.1C6.23 6.88 8.88 4.77 12 4.77z" />
  </svg>
);

/**
 * «Продовжити з Google» під формою входу й реєстрації. Google віддає
 * access-токен у спливному вікні, сервер перевіряє його й входить в акаунт
 * з цією поштою або створює новий. Якщо на сервері немає GOOGLE_CLIENT_ID —
 * кнопки немає.
 */
export default function GoogleButton({ onSignedIn }) {
  const { pushToast } = useToasts();
  const [clientId, setClientId] = useState('');
  const [busy, setBusy] = useState(false);
  const clientRef = useRef(null);
  const latest = useRef({ onSignedIn, pushToast });

  useEffect(() => {
    latest.current = { onSignedIn, pushToast };
  }, [onSignedIn, pushToast]);

  useEffect(() => {
    let alive = true;
    googleConfig()
      .then((data) => {
        if (alive) setClientId(data?.client_id || '');
      })
      .catch(() => {
        /* без налаштувань — просто без кнопки */
      });
    return () => {
      alive = false;
    };
  }, []);

  // клієнт готуємо заздалегідь: вікно Google має відкритися прямо з кліку,
  // інакше браузер сприйме його як небажане й заблокує
  useEffect(() => {
    if (!clientId) return undefined;
    let alive = true;
    loadGoogle()
      .then((google) => {
        if (!alive) return;
        clientRef.current = google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: 'openid email profile',
          callback: async (response) => {
            if (response?.error || !response?.access_token) {
              setBusy(false);
              latest.current.pushToast(t.error);
              return;
            }
            try {
              const data = await googleLogin(response.access_token);
              // пароль, заданий до підтвердження пошти, міг задати хтось інший — сервер його скинув
              if (data?.password_removed) latest.current.pushToast(t.passwordRemoved, 'success');
              latest.current.onSignedIn?.(data);
            } catch (err) {
              setBusy(false);
              latest.current.pushToast(err?.message || t.error);
            }
          },
          error_callback: (err) => {
            setBusy(false);
            latest.current.pushToast(err?.type === 'popup_closed' ? t.popupClosed : t.error);
          },
        });
      })
      .catch(() => {
        /* скрипт Google не завантажився — кнопка скаже про це при натисканні */
      });
    return () => {
      alive = false;
    };
  }, [clientId]);

  if (!clientId) return null;

  const start = () => {
    if (!clientRef.current) {
      pushToast(t.error);
      return;
    }
    setBusy(true);
    clientRef.current.requestAccessToken();
  };

  return (
    <div className="form__google">
      <span className="form__divider">{t.divider}</span>
      <button type="button" className="btn btn--google" onClick={start} disabled={busy}>
        <GoogleMark />
        <span>{busy ? t.busy : t.button}</span>
      </button>
    </div>
  );
}

GoogleButton.propTypes = {
  onSignedIn: PropTypes.func,
};
