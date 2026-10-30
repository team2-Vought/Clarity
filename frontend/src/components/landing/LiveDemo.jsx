import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { HugeiconsIcon } from '@hugeicons/react';
import { Refresh01Icon } from '@hugeicons/core-free-icons';
import { prefersReducedMotion } from './personaTones';
import ThoughtLine from '../ThoughtLine';
import ParagraphReveal from '../ParagraphReveal';
import MessageMarkdown from '../MessageMarkdown';
import SummaryDetails from '../SummaryDetails';
import { AvatarIcon } from '../DebateIcons';
import { USER_COLOR, buildSpeakers, phaseLabel } from '../../utils/chatView';
import { describeSummary } from '../../utils/summary';
import { parseBlocks } from '../../utils/markdown';
import { roleIcon } from '../../utils/debateOptions';
import logoThinking from '../../assets/logo-thinking.svg';
import logoStill from '../../assets/Clarity_logo_8.svg';
import { copy } from '../../copy';

const t = copy.landing;
const tc = copy.chat;

// Репліки демо в тому ж вигляді, що приходять із сервера, — тож кольори,
// сторони, роздільники фаз і анімації беруться з тих самих функцій, що в чаті
const MESSAGES = t.demoMessages.map((m, i) => ({
  id: `demo-${i}`,
  role: m.role,
  persona_slug: m.slug,
  persona_name: m.name,
  phase: m.phase || 'opening',
  content: m.text,
  model: m.model,
}));
const SPEAKERS = buildSpeakers(MESSAGES, new Map());
const SUMMARY = t.demoSummary;
const SUMMARY_VIEW = describeSummary(SUMMARY);
const NO_SOURCES = new Map();
const THINK_MS = 1500;

const THINKING_GLYPH = <img className="chat__thought-logo" src={logoThinking} alt="" />;
const STILL_GLYPH = <img className="chat__thought-logo chat__thought-logo--still" src={logoStill} alt="" />;

// Один «прогін» дискусії: думає → репліка проявляється абзацами → наступна…
// Ключ ззовні перезапускає його з початку.
function DemoRun({ reduced }) {
  // shown — скільки реплік уже показано повністю; typing — чи друкується наступна
  const [shown, setShown] = useState(reduced ? MESSAGES.length : 0);
  const [typing, setTyping] = useState(false);
  const [summary, setSummary] = useState(reduced);
  const finished = shown >= MESSAGES.length;

  // пауза «думання» перед кожною реплікою і перед підсумком
  useEffect(() => {
    if (typing || summary) return undefined;
    const timer = setTimeout(() => (finished ? setSummary(true) : setTyping(true)), THINK_MS);
    return () => clearTimeout(timer);
  }, [typing, finished, summary]);

  const thinkingPhase = finished ? 'final' : MESSAGES[shown].phase;
  const visible = MESSAGES.slice(0, typing ? shown + 1 : shown);

  return (
    <>
      {visible.map((message, index) => {
        const { color, side } = SPEAKERS.get(message.persona_name);
        const isTyping = typing && index === shown;
        const divider = phaseLabel(message);
        const previous = visible[index - 1];
        const showDivider = !previous || phaseLabel(previous) !== divider;
        return (
          <Fragment key={message.id}>
            {showDivider && (
              <div className="chat__divider" role="separator">
                <span>{divider}</span>
              </div>
            )}
            <div
              className={[
                'chat__row',
                `chat__row--${side}`,
                `chat__row--${message.role}`,
                isTyping && 'chat__row--enter',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <span className="chat__avatar" style={{ '--avatar': color }} aria-hidden="true">
                <HugeiconsIcon
                  icon={roleIcon(message.persona_slug)}
                  className="chat__avatar-role"
                  strokeWidth={1.8}
                />
              </span>
              <div className="chat__body">
                <div className="chat__head">
                  <span className="chat__name">{message.persona_name}</span>
                  <span className="chat__model">{message.model}</span>
                </div>
                <div
                  className={`chat__bubble chat__bubble--wide${isTyping ? ' chat__bubble--typing' : ''}`}
                  style={{ '--bubble': color }}
                >
                  {isTyping ? (
                    <ParagraphReveal
                      content={message.content}
                      onDone={() => {
                        setShown((n) => n + 1);
                        setTyping(false);
                      }}
                    >
                      {(blocks, pending) => (
                        <MessageMarkdown blocks={blocks} sources={NO_SOURCES} animate>
                          {pending && (
                            <span className="chat__pending" aria-hidden="true">
                              <span />
                              <span />
                            </span>
                          )}
                        </MessageMarkdown>
                      )}
                    </ParagraphReveal>
                  ) : (
                    <MessageMarkdown blocks={parseBlocks(message.content)} sources={NO_SOURCES} />
                  )}
                </div>
              </div>
            </div>
          </Fragment>
        );
      })}

      {!typing && !summary && (
        <ThoughtLine
          working
          label={tc.phaseStatus[thinkingPhase]}
          doneLabel={tc.thoughtDone}
          glyph={reduced ? STILL_GLYPH : THINKING_GLYPH}
          glyphBreath={false}
          openOnWork={false}
          fontSize={16}
          className="chat__thought"
        />
      )}

      {summary && (
        <section className={`chat__summary${reduced ? '' : ' chat__summary--enter'}`} aria-label={tc.summary}>
          <SummaryDetails
            summary={SUMMARY}
            view={SUMMARY_VIEW}
            sources={NO_SOURCES}
            mode="yes_no"
            animate={!reduced}
          />
        </section>
      )}
    </>
  );
}

DemoRun.propTypes = {
  reduced: PropTypes.bool.isRequired,
};

export default function LiveDemo() {
  const rootRef = useRef(null);
  // 0 — ще не почалося; кожне «Ще раз» збільшує номер і перезапускає прогін
  const [run, setRun] = useState(0);
  const [reduced] = useState(prefersReducedMotion);
  const question = useMemo(() => parseBlocks(t.demoQuestion), []);

  // стартує, коли вікно демо вперше з'являється на екрані
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setRun((r) => (r === 0 ? 1 : r));
          observer.disconnect();
        }
      },
      { threshold: 0.3 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <section className="lp-section lp-demo" id="demo" aria-labelledby="demo-title">
      <header className="lp-section__head" data-reveal>
        <h2 id="demo-title" className="lp-section__title">
          {t.demoTitle}
        </h2>
        <p className="lp-section__text">{t.demoText}</p>
      </header>

      <div className="lp-demo__window lp-chat" ref={rootRef} data-reveal>
        <button
          type="button"
          className="lp-demo__replay"
          onClick={() => setRun((r) => r + 1)}
          aria-label={t.demoReplay}
          title={t.demoReplay}
        >
          <HugeiconsIcon icon={Refresh01Icon} size={17} strokeWidth={1.9} />
        </button>

        <div className="chat__main lp-demo__chat">
          <header className="chat__row chat__row--right chat__row--user">
            <span className="chat__avatar" style={{ '--avatar': USER_COLOR }} aria-hidden="true">
              <AvatarIcon />
            </span>
            <div className="chat__body">
              <div className="chat__head">
                <span className="chat__name">{tc.you}</span>
              </div>
              <div className="chat__bubble" style={{ '--bubble': USER_COLOR }}>
                <MessageMarkdown blocks={question} sources={NO_SOURCES} />
              </div>
            </div>
          </header>

          {run > 0 && <DemoRun key={run} reduced={reduced} />}
        </div>
      </div>
    </section>
  );
}
