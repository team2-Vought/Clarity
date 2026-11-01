import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listSessions, revokeSession } from '../api/auth';
import { forgetSession } from '../api/client';
import { useToasts } from '../hooks/useToasts';
import { downloadAccountExport } from '../utils/accountExport';
import { Row } from './SettingsControls';
import { copy, lang } from '../copy';

const t = copy.settings.privacy;

const when = (value) =>
  new Date(value).toLocaleString(lang === 'uk' ? 'uk-UA' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

/** «Дані й входи»: де людина зараз в акаунті та всі її дані одним файлом. */
export default function PrivacySettings() {
  const navigate = useNavigate();
  const { pushToast } = useToasts();
  const [sessions, setSessions] = useState(null);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      setSessions(await listSessions());
    } catch (err) {
      pushToast(err?.message || copy.settings.saveError);
      setSessions([]);
    }
  }, [pushToast]);

  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const signOut = async (session) => {
    setBusy(`session-${session.id}`);
    try {
      await revokeSession(session.id);
      if (session.current) {
        forgetSession();
        navigate('/login', { replace: true });
        return;
      }
      setSessions((list) => list.filter((item) => item.id !== session.id));
      pushToast(t.signedOut, 'success');
    } catch (err) {
      pushToast(err?.message || copy.settings.saveError);
    } finally {
      setBusy('');
    }
  };

  const exportData = async () => {
    setBusy('export');
    try {
      await downloadAccountExport();
    } catch (err) {
      pushToast(err?.message || copy.settings.saveError);
    } finally {
      setBusy('');
    }
  };

  return (
    <>
      <div className="settings__sheet">
        {sessions === null && <Row title={t.loading} />}
        {sessions?.map((session) => (
          <Row
            key={session.id}
            title={session.current ? `${session.device || t.unknownDevice} · ${t.thisDevice}` : session.device || t.unknownDevice}
            hint={t.lastActive(when(session.last_used_at))}
          >
            <button
              type="button"
              className="settings__button settings__button--soft"
              onClick={() => signOut(session)}
              disabled={Boolean(busy)}
            >
              {t.signOut}
            </button>
          </Row>
        ))}
      </div>
      <p className="settings__footnote">{t.sessionsLead}</p>

      <div className="settings__sheet">
        <Row title={t.exportLabel} hint={t.exportHint}>
          <button
            type="button"
            className="settings__button settings__button--soft"
            onClick={exportData}
            disabled={Boolean(busy)}
          >
            {busy === 'export' ? t.exporting : t.exportButton}
          </button>
        </Row>
      </div>
      <p className="settings__footnote">{t.exportLead}</p>
    </>
  );
}
