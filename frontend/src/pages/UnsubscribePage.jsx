import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AuthPage } from './AuthLayout';
import { unsubscribeJournal } from '../api/journal';
import { copy } from '../copy';

const t = copy.unsubscribe;

/** Відписка від листів журналу за посиланням із листа, без входу.
 *  Підтвердження кнопкою: посилання в листах заздалегідь відкривають антивіруси. */
export default function UnsubscribePage() {
  const navigate = useNavigate();
  const { token = '' } = useParams();
  // 'ask' | 'busy' | 'done' | { error }
  const [state, setState] = useState('ask');

  const confirm = async () => {
    setState('busy');
    try {
      await unsubscribeJournal(token);
      setState('done');
    } catch (err) {
      setState({ error: err?.message || t.invalidTitle });
    }
  };

  if (state === 'done' || state?.error) {
    return (
      <AuthPage
        title={state === 'done' ? t.doneTitle : t.invalidTitle}
        lead={state === 'done' ? t.done : state.error}
        variant="login"
        form={
          <div className="form">
            <button className="btn" type="button" onClick={() => navigate('/', { replace: true })}>
              {t.toHome}
            </button>
          </div>
        }
      />
    );
  }

  return (
    <AuthPage
      title={t.title}
      lead={t.lead}
      variant="login"
      form={
        <div className="form">
          <button className="btn" type="button" onClick={confirm} disabled={state === 'busy'}>
            {state === 'busy' ? t.busy : t.confirm}
          </button>
        </div>
      }
    />
  );
}
