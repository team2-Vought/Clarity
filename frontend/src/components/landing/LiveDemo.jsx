import { useEffect, useRef, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Refresh01Icon } from '@hugeicons/core-free-icons';
import { prefersReducedMotion, toneOf } from './personaTones';
import { AvatarIcon } from '../DebateIcons';
import { roleIcon } from '../../utils/debateOptions';
import { uk } from '../../copy/uk';

const t = uk.landing;
const MESSAGES = t.demoMessages;
const CONSENSUS = 88;

// Стан демо: скільки реплік уже видно, чи хтось «друкує», чи з'явився вердикт
const FINAL = { shown: MESSAGES.length, typing: false, verdict: true, consensus: CONSENSUS };
const EMPTY = { shown: 0, typing: false, verdict: false, consensus: 0 };

export default function LiveDemo() {
  const rootRef = useRef(null);
  const [run, setRun] = useState(0);
  const [state, setState] = useState(EMPTY);
  // без анімації демо одразу показує всю розмову
  const [reduced] = useState(prefersReducedMotion);
  const view = reduced ? FINAL : state;

  // стартує, коли блок уперше з'являється на екрані
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
      { threshold: 0.35 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!run || reduced) return undefined;
    const timers = [];
    let at = 600;
    const at_ = (delay, fn) => {
      at += delay;
      timers.push(setTimeout(fn, at));
    };
    MESSAGES.forEach((_, i) => {
      at_(i === 0 ? 300 : 900, () => setState((s) => ({ ...s, typing: true })));
      at_(1100, () => setState((s) => ({ ...s, typing: false, shown: i + 1 })));
    });
    at_(900, () => setState((s) => ({ ...s, typing: true })));
    at_(1200, () => setState((s) => ({ ...s, typing: false, verdict: true })));
    // лічильник згоди «набігає» до кінцевого значення
    for (let v = 4; v <= CONSENSUS; v += 4) {
      at_(22, () => setState((s) => ({ ...s, consensus: Math.min(v, CONSENSUS) })));
    }
    at_(22, () => setState((s) => ({ ...s, consensus: CONSENSUS })));
    return () => timers.forEach(clearTimeout);
  }, [run, reduced]);

  const nextSpeaker = view.shown < MESSAGES.length ? MESSAGES[view.shown].slug : 'moderator';

  return (
    <section className="lp-section lp-demo" id="demo" aria-labelledby="demo-title">
      <header className="lp-section__head" data-reveal>
        <p className="lp-eyebrow">{t.demoEyebrow}</p>
        <h2 id="demo-title" className="lp-section__title">
          {t.demoTitle}
        </h2>
        <p className="lp-section__text">{t.demoText}</p>
      </header>

      <div className="lp-demo__window" ref={rootRef} data-reveal>
        <div className="lp-demo__head">
          <span className="lp-demo__team" aria-hidden="true">
            {MESSAGES.map((m, i) => (
              <span
                key={m.slug}
                className={`lp-demo__dot${i < view.shown ? ' is-on' : ''}${m.slug === 'devil' ? ' lp-demo__dot--devil' : ''}`}
                style={{ '--tone': toneOf(m.slug) }}
              >
                <HugeiconsIcon icon={roleIcon(m.slug)} size={13} strokeWidth={1.9} />
              </span>
            ))}
          </span>
          <button type="button" className="lp-demo__replay" onClick={() => {
              setState(EMPTY);
              setRun((r) => r + 1);
            }}>
            <HugeiconsIcon icon={Refresh01Icon} size={16} strokeWidth={1.9} />
            {t.demoReplay}
          </button>
        </div>

        <div className="lp-demo__chat" aria-live="polite">
          <div className="lp-msg lp-msg--user">
            <span className="lp-msg__avatar lp-msg__avatar--user" aria-hidden="true">
              <AvatarIcon />
            </span>
            <div className="lp-msg__body">
              <span className="lp-msg__name">{t.demoAsker}</span>
              <p className="lp-msg__bubble">{t.demoQuestion}</p>
            </div>
          </div>

          {MESSAGES.slice(0, view.shown).map((m) => (
            <div
              key={m.slug}
              className={`lp-msg lp-msg--in${m.slug === 'devil' ? ' lp-msg--devil' : ''}`}
              style={{ '--tone': toneOf(m.slug) }}
            >
              <span className="lp-msg__avatar" aria-hidden="true">
                <HugeiconsIcon icon={roleIcon(m.slug)} size={17} strokeWidth={1.8} />
              </span>
              <div className="lp-msg__body">
                <span className="lp-msg__name">{m.name}</span>
                <p className="lp-msg__bubble">{m.text}</p>
              </div>
            </div>
          ))}

          {view.typing && (
            <div className="lp-msg lp-msg--in lp-msg--typing" style={{ '--tone': toneOf(nextSpeaker) }} aria-hidden="true">
              <span className="lp-msg__avatar">
                <HugeiconsIcon icon={roleIcon(nextSpeaker)} size={17} strokeWidth={1.8} />
              </span>
              <div className="lp-msg__body">
                <p className="lp-msg__bubble lp-typing">
                  <span />
                  <span />
                  <span />
                </p>
              </div>
            </div>
          )}

          {view.verdict && (
            <div className="lp-verdict lp-msg--in">
              <div className="lp-verdict__head">
                <span className="lp-msg__avatar" style={{ '--tone': toneOf('moderator') }} aria-hidden="true">
                  <HugeiconsIcon icon={roleIcon('moderator')} size={17} strokeWidth={1.8} />
                </span>
                <span className="lp-msg__name">{t.demoVerdictLabel}</span>
              </div>
              <p className="lp-verdict__text">{t.demoVerdict}</p>
              <div className="lp-verdict__meter">
                <span>{t.demoConsensus}</span>
                <strong>{view.consensus}%</strong>
                <span className="lp-meter lp-meter--wide">
                  <span style={{ width: `${view.consensus}%` }} />
                </span>
              </div>
              <p className="lp-verdict__next">{t.demoNext}</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
