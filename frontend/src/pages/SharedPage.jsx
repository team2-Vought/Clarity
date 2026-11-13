import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { HugeiconsIcon } from '@hugeicons/react';
import { Alert02Icon, Unlink04Icon } from '@hugeicons/core-free-icons';
import { fetchSharedDiscussion } from '../api/discussions';
import { getSession } from '../api/client';
import { AvatarIcon } from '../components/DebateIcons';
import MessageMarkdown from '../components/MessageMarkdown';
import StatusPage from '../components/StatusPage';
import { VisionTrigger } from '../components/VisionDialog';
import SummaryDetails from '../components/SummaryDetails';
import Logo from '../components/Logo';
import PublicFooter from '../components/PublicFooter';
import { copy, locale } from '../copy';
import { asPersona, participantColor, roleIcon } from '../utils/debateOptions';
import {
  USER_COLOR,
  buildSpeakers,
  duplicateFinalId,
  phaseLabel,
  speakerKeyOf,
  stanceLabel,
  stanceTone,
} from '../utils/chatView';
import { parseBlocks } from '../utils/markdown';
import { describeSummary } from '../utils/summary';
import { usePageTitle } from '../hooks/usePageTitle';

const t = copy.shared;
const c = copy.chat;

const dateFormat = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' });

/** Дискусія за публічним посиланням: лише читання, без входу й без поля вводу. */
export default function SharedPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [discussion, setDiscussion] = useState(null);
  // { closed, message }: закрите посилання — окремий стан, інша помилка — з її текстом
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    fetchSharedDiscussion(token)
      .then((data) => {
        if (alive) setDiscussion(data);
      })
      .catch((err) => {
        if (alive) setError({ closed: err.status === 404, message: err.message });
      });
    return () => {
      alive = false;
    };
  }, [token]);

  usePageTitle(discussion?.title || '');

  const messages = useMemo(() => discussion?.messages || [], [discussion]);
  const question = messages.find((message) => message.role === 'user');
  const summary = discussion?.final_summary || null;
  const summaryView = describeSummary(summary);
  const hiddenFinal = duplicateFinalId(messages, Boolean(summaryView.decision));
  const visible = messages.filter((message) => message !== question && message.id !== hiddenFinal);
  const sourcesById = useMemo(
    () => new Map((discussion?.sources || []).map((source) => [source.id, source])),
    [discussion]
  );
  const participantColors = useMemo(
    () =>
      new Map(
        (discussion?.personas || []).map(asPersona).map((persona, index) => [
          persona.slug,
          participantColor(persona.slug, index),
        ])
      ),
    [discussion]
  );
  const speakers = useMemo(() => buildSpeakers(messages, participantColors), [messages, participantColors]);
  const names = (discussion?.personas || []).map(asPersona).map((persona) => persona.name).filter(Boolean);

  if (error) {
    const signedIn = Boolean(getSession());
    return (
      <StatusPage
        icon={error.closed ? Unlink04Icon : Alert02Icon}
        title={error.closed ? t.unavailable : t.loadError}
        text={error.closed ? t.notFound : error.message}
        actions={[
          {
            label: signedIn ? t.ctaSignedIn : t.cta,
            onClick: () => navigate(signedIn ? '/home' : '/register'),
          },
        ]}
      />
    );
  }

  return (
    <div className="shared">
      <header className="shared__bar">
        <Logo onHome={() => navigate('/')} wordmark />
        <div className="shared__actions">
          <VisionTrigger compact />
          <Link to={getSession() ? '/home' : '/register'} className="shared__cta">
            {getSession() ? t.ctaSignedIn : t.cta}
          </Link>
        </div>
      </header>

      <main className="shared__main">
        {!discussion && (
          <p className="shared__status" role="status">
            {t.loading}
          </p>
        )}

        {discussion && (
          <>
            <div className="shared__intro">
              <p className="shared__label">{t.label}</p>
              <h1 className="shared__title">{discussion.title}</h1>
              <p className="shared__meta">
                {dateFormat.format(new Date(discussion.created_at))}
                {names.length > 0 && ` · ${t.participants(names.join(', '))}`}
              </p>
            </div>

            <div className="chat__row chat__row--right chat__row--user">
              <span className="chat__avatar" style={{ '--avatar': USER_COLOR }} aria-hidden="true">
                <AvatarIcon />
              </span>
              <div className="chat__body">
                <div className="chat__head">
                  <span className="chat__name">{question?.persona_name}</span>
                </div>
                <div className="chat__bubble" style={{ '--bubble': USER_COLOR }}>
                  <MessageMarkdown blocks={parseBlocks(discussion.question)} sources={sourcesById} />
                </div>
              </div>
            </div>

            {visible.map((message, index) => {
              const previous = visible[index - 1];
              const divider = message.role === 'user' ? '' : phaseLabel(message);
              const showDivider = divider && (!previous || phaseLabel(previous) !== divider);
              const { color, side } = speakers.get(speakerKeyOf(message)) || {
                color: USER_COLOR,
                side: 'left',
              };
              const stance =
                message.role === 'ai' ? stanceLabel(message, discussion.mode, message.reply_to) : '';
              return (
                <Fragment key={message.id}>
                  {showDivider && (
                    <div className="chat__divider" role="separator">
                      <span>{divider}</span>
                    </div>
                  )}
                  {message.role === 'research' ? (
                    <div className="chat__system">
                      <MessageMarkdown blocks={parseBlocks(message.content)} sources={sourcesById} />
                    </div>
                  ) : (
                    <div className={`chat__row chat__row--${side} chat__row--${message.role}`}>
                      <span className="chat__avatar" style={{ '--avatar': color }} aria-hidden="true">
                        {message.role === 'user' ? (
                          <AvatarIcon />
                        ) : (
                          <HugeiconsIcon
                            icon={roleIcon(message.persona_slug || message.role)}
                            className="chat__avatar-role"
                            strokeWidth={1.8}
                          />
                        )}
                      </span>
                      <div className="chat__body">
                        <div className="chat__head">
                          <span className="chat__name">{message.persona_name}</span>
                          {stance && (
                            <span className="chat__stance" data-stance={stanceTone(message.stance)}>
                              {stance}
                            </span>
                          )}
                        </div>
                        <div
                          className={`chat__bubble ${(message.content || '').length > 160 ? 'chat__bubble--wide' : ''}`}
                          style={{ '--bubble': color }}
                        >
                          <MessageMarkdown blocks={parseBlocks(message.content)} sources={sourcesById} />
                        </div>
                      </div>
                    </div>
                  )}
                </Fragment>
              );
            })}

            {summaryView.decision ? (
              <section className="chat__summary" aria-label={c.summary}>
                <SummaryDetails
                  summary={summary}
                  view={summaryView}
                  sources={sourcesById}
                  mode={discussion.mode}
                  options={discussion.options}
                />
                {discussion.sources?.length > 0 && (
                  <div className="shared__sources">
                    <span className="chat__summary-label">{c.sources}</span>
                    <ol>
                      {discussion.sources.map((source) => (
                        <li key={source.id}>
                          <a href={source.url} target="_blank" rel="noopener noreferrer">
                            {source.title || source.url}
                          </a>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </section>
            ) : (
              <p className="shared__status">{t.inProgress}</p>
            )}
          </>
        )}
      </main>
      <PublicFooter />
    </div>
  );
}
