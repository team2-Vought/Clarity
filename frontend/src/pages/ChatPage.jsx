import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  advanceDiscussion,
  deleteDiscussion,
  fetchDiscussion,
  fetchModels,
  fetchPersonas,
} from '../api/discussions';
import { AiModelIcon, ChevronIcon, UserPlusIcon } from '../components/DebateIcons';
import ThoughtLine from '../components/ThoughtLine';
import { uk } from '../copy/uk';
import { TRAITS, TRAIT_COLORS } from '../utils/debateOptions';

const t = uk.chat;
const d = uk.debate;

const DEVIL_COLOR = '#fde3c6';
const USER_COLOR = '#f0f0f0';
const MAX_AUTO_STEPS = 50;
const STICK_THRESHOLD = 120;
// 502 (модель не відповіла) і 409 (крок ще виконується) часто минають самі:
// повторюємо кілька разів із паузою, перш ніж показати помилку.
const AUTO_RETRY_DELAYS = [4000, 12000];
const RETRYABLE_STATUSES = new Set([0, 409, 502, 503, 504]);

const wait = (ms, signal) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true }
    );
  });

const AvatarIcon = () => (
  <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
    <circle cx="20" cy="15" r="6" fill="#ffffff" />
    <path d="M7 36c1.2-7.6 6-11.5 13-11.5s11.8 3.9 13 11.5H7Z" fill="#ffffff" />
  </svg>
);

const splitParagraphs = (content) =>
  String(content || '')
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

const listOf = (value) =>
  (Array.isArray(value) ? value : [])
    .map((item) => String(item ?? '').trim())
    .filter(Boolean);

const stanceText = (stance) => (stance ? t.stance[stance] || stance : '');

const phaseLabel = (message) => {
  switch (message.phase) {
    case 'opening':
      return t.phaseOpening;
    case 'debate':
      return t.phaseRound(message.round || 1);
    case 'synthesis':
      return t.phaseSynthesis;
    case 'devil':
      return t.phaseDevil;
    case 'rebuttal':
      return t.phaseRebuttal;
    case 'final':
      return t.phaseFinal;
    default:
      return '';
  }
};

export default function ChatPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [discussion, setDiscussion] = useState(null);
  const [personas, setPersonas] = useState([]);
  const [models, setModels] = useState([]);
  const [defaultModel, setDefaultModel] = useState('');
  const [activeSlug, setActiveSlug] = useState('');
  const [scrollState, setScrollState] = useState({ overflow: false, left: false, right: false });
  const [isAdvancing, setIsAdvancing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [stopReason, setStopReason] = useState('');
  const [copyState, setCopyState] = useState('');
  const discussionRef = useRef(null);
  const runningRef = useRef(false);
  const autoStartedRef = useRef(null);
  const abortRef = useRef(null);
  const bottomRef = useRef(null);
  const mainRef = useRef(null);
  const stickToBottomRef = useRef(true);
  const participantListRef = useRef(null);

  const loadDiscussion = useCallback(async () => {
    try {
      const [data, personaData, modelData] = await Promise.all([
        fetchDiscussion(id),
        fetchPersonas().catch(() => null),
        fetchModels().catch(() => null),
      ]);
      discussionRef.current = data;
      setDiscussion(data);
      setActiveSlug(data.personas?.[0]?.slug || '');
      if (personaData?.personas) setPersonas(personaData.personas);
      if (modelData?.models) {
        setModels(modelData.models);
        setDefaultModel(
          modelData.default_model
            || modelData.models.find((model) => model.available)?.id
            || ''
        );
      }
      setError('');
      setStopReason('');
      setLoadError('');
    } catch (err) {
      setLoadError(err.message || t.loadError);
    }
  }, [id]);

  useEffect(() => {
    autoStartedRef.current = null;
    const timer = setTimeout(loadDiscussion, 0);
    return () => clearTimeout(timer);
  }, [loadDiscussion]);

  const runDiscussion = useCallback(async () => {
    const start = discussionRef.current;
    if (!start || runningRef.current || start.phase === 'done' || start.is_finished) {
      return;
    }

    runningRef.current = true;
    setIsAdvancing(true);
    setError('');
    setStopReason('');
    const controller = new AbortController();
    abortRef.current = controller;

    let current = start;
    let retries = 0;
    try {
      for (let step = 0; step < MAX_AUTO_STEPS; step += 1) {
        if (!current || current.phase === 'done' || current.is_finished) break;
        if (controller.signal.aborted) break;

        let data;
        try {
          data = await advanceDiscussion(current.id, {
            signal: controller.signal,
          });
        } catch (err) {
          if (
            err?.name === 'AbortError'
            || retries >= AUTO_RETRY_DELAYS.length
            || !RETRYABLE_STATUSES.has(err?.status)
          ) {
            throw err;
          }
          // частина паралельних відповідей могла зберегтися — підтягуємо їх
          const fresh = await fetchDiscussion(current.id).catch(() => null);
          if (fresh) {
            current = fresh;
            discussionRef.current = fresh;
            setDiscussion(fresh);
          }
          await wait(AUTO_RETRY_DELAYS[retries], controller.signal);
          retries += 1;
          continue;
        }
        retries = 0;
        // паралельні фази (вступ, відповіді на Devil) повертають кілька реплік
        const created = Array.isArray(data?.messages)
          ? data.messages
          : [data?.message].filter(Boolean);
        const previousPhase = current.phase;
        current = {
          ...current,
          ...(data?.discussion || {}),
          messages: [...(current.messages || []), ...created],
        };
        discussionRef.current = current;
        setDiscussion(current);

        if (current.phase === 'done' || current.is_finished) break;
        if (created.length === 0 && current.phase === previousPhase) {
          setError(t.stopped);
          break;
        }
      }

      if (controller.signal.aborted) {
        setStopReason(t.stoppedByUser);
      } else if (current && current.phase !== 'done' && !current.is_finished) {
        setError((previous) => previous || t.stopped);
      }
    } catch (err) {
      if (err?.name === 'AbortError') {
        setStopReason(t.stoppedByUser);
      } else {
        setError(err.message || t.errorAdvance);
        // частина паралельних відповідей могла зберегтися — синхронізуємося
        try {
          const fresh = await fetchDiscussion(start.id);
          discussionRef.current = fresh;
          setDiscussion(fresh);
        } catch {
          // залишаємо локальний стан; «Продовжити» повторить крок
        }
      }
    } finally {
      runningRef.current = false;
      abortRef.current = null;
      setIsAdvancing(false);
    }
  }, []);

  useEffect(() => {
    if (!discussion) return;
    if (autoStartedRef.current === discussion.id) return;
    autoStartedRef.current = discussion.id;
    runDiscussion();
  }, [discussion, runDiscussion]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    []
  );

  const messages = discussion?.messages;
  const visibleMessages = (messages || []).filter((message) => message.role !== 'user');
  const isFinished = discussion
    ? discussion.phase === 'done' || discussion.is_finished
    : false;

  const personaNames = useMemo(() => {
    const map = new Map();
    personas.forEach((persona) => map.set(persona.slug, persona.name));
    (discussion?.personas || []).forEach((persona) => {
      if (persona.name) map.set(persona.slug, persona.name);
    });
    return map;
  }, [personas, discussion?.personas]);

  const customNames = useMemo(() => {
    const map = new Map();
    (discussion?.personas || []).forEach((persona) => {
      if (persona.name) map.set(persona.slug, persona.name);
    });
    return map;
  }, [discussion?.personas]);

  const participantEntries = useMemo(
    () =>
      (discussion?.personas || []).map((persona, index) => ({
        key: persona.slug || `participant-${index}`,
        label:
          persona.name
          || personaNames.get(persona.slug)
          || t.fallbackParticipant(index + 1),
        model: persona.model || defaultModel || '',
        traits: Array.isArray(persona.traits) ? persona.traits : [],
        color: TRAIT_COLORS[index % TRAIT_COLORS.length],
      })),
    [discussion?.personas, defaultModel, personaNames]
  );

  const participantColors = useMemo(
    () => new Map(participantEntries.map((participant) => [participant.key, participant.color])),
    [participantEntries]
  );

  const activeParticipant =
    participantEntries.find((participant) => participant.key === activeSlug)
    || participantEntries[0];
  const activeTraits = activeParticipant?.traits || [];
  const selectedModel = models.find((model) => model.id === activeParticipant?.model);
  const selectedModelLabel = selectedModel
    ? `${selectedModel.provider} — ${selectedModel.label || selectedModel.model}`
    : activeParticipant?.model || '';

  const allTraits = useMemo(() => {
    const customTraits = [];
    participantEntries.forEach((participant) => {
      participant.traits.forEach((trait) => {
        if (!TRAITS.includes(trait) && !customTraits.includes(trait)) {
          customTraits.push(trait);
        }
      });
    });
    return [...TRAITS, ...customTraits];
  }, [participantEntries]);

  const participantNames = useMemo(
    () =>
      (discussion?.personas || []).map(
        (persona, index) =>
          persona.name || personaNames.get(persona.slug) || t.fallbackParticipant(index + 1)
      ),
    [discussion?.personas, personaNames]
  );

  // Етапи дискусії: вступ і відповіді на Devil — паралельні, тож це один етап.
  // Після раннього консенсусу раунди, які пропустили, не показуємо.
  const plannedRounds = discussion?.early_stop
    ? Number(discussion?.current_round) || 1
    : Math.max(1, Number(discussion?.rounds) || 1);

  const stagePlan = useMemo(() => {
    if (participantNames.length === 0) return [];
    const stages = [t.stageOpening];
    for (let round = 1; round <= plannedRounds; round += 1) {
      participantNames.forEach((name) => stages.push(t.stageRound(round, name)));
    }
    stages.push(t.stageSynthesis, t.stageDevil, t.stageRebuttal, t.stageFinal);
    return stages;
  }, [participantNames, plannedRounds]);

  const currentStage = useMemo(() => {
    if (!discussion) return 0;
    const debateStart = 1;
    const afterDebate = debateStart + plannedRounds * participantNames.length;
    switch (discussion.phase) {
      case 'opening':
        return 0;
      case 'debate':
        return (
          debateStart
          + (Math.max(1, Number(discussion.current_round) || 1) - 1) * participantNames.length
          + (Number(discussion.speaker_index) || 0)
        );
      case 'synthesis':
        return afterDebate;
      case 'devil':
        return afterDebate + 1;
      case 'rebuttal':
        return afterDebate + 2;
      case 'final':
        return afterDebate + 3;
      default:
        return stagePlan.length;
    }
  }, [discussion, plannedRounds, participantNames.length, stagePlan.length]);

  const traceSteps = stagePlan.slice(
    0,
    isFinished ? stagePlan.length : Math.min(currentStage + 1, stagePlan.length)
  );
  const showThoughtLine = stagePlan.length > 0 && (isAdvancing || isFinished);

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    bottomRef.current?.scrollIntoView({ behavior: isAdvancing ? 'smooth' : 'auto', block: 'end' });
  }, [visibleMessages.length, isAdvancing, error, stopReason]);

  const handleMainScroll = () => {
    const el = mainRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distance < STICK_THRESHOLD;
    if (distance < STICK_THRESHOLD) stickToBottomRef.current = true;
  };

  const updateScrollState = useCallback(() => {
    const el = participantListRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setScrollState({
      overflow: max > 1,
      left: el.scrollLeft > 1,
      right: el.scrollLeft < max - 1,
    });
  }, []);

  useEffect(() => {
    updateScrollState();
    const el = participantListRef.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(updateScrollState);
    observer.observe(el);
    window.addEventListener('resize', updateScrollState);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateScrollState);
    };
  }, [participantEntries.length, updateScrollState]);

  useEffect(() => {
    const el = participantListRef.current;
    if (!el) return;
    const active = el.querySelector('[data-active="true"]');
    if (!active) return;
    const listRect = el.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    if (activeRect.left < listRect.left) {
      el.scrollBy({ left: activeRect.left - listRect.left - 4, behavior: 'smooth' });
    } else if (activeRect.right > listRect.right) {
      el.scrollBy({ left: activeRect.right - listRect.right + 4, behavior: 'smooth' });
    }
  }, [activeSlug, participantEntries.length, scrollState.overflow]);

  const scrollParticipants = (direction) => {
    const el = participantListRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * 108, behavior: 'smooth' });
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const handleRetry = () => {
    if (runningRef.current) return;
    runDiscussion();
  };

  const handleDelete = async () => {
    if (isDeleting) return;
    if (!window.confirm(t.deleteConfirm)) return;
    abortRef.current?.abort();
    setIsDeleting(true);
    setLoadError('');
    try {
      await deleteDiscussion(id);
      navigate('/home', { replace: true });
    } catch (err) {
      setError(err.message || t.deleteError);
      setIsDeleting(false);
    }
  };

  const speakers = useMemo(() => {
    const map = new Map();
    let index = 0;
    (messages || []).forEach((message) => {
      const key = message.persona_name || message.role;
      if (map.has(key)) return;
      if (message.role === 'devil') {
        map.set(key, { color: DEVIL_COLOR, side: 'right', participant: true });
      } else if (message.role === 'moderator') {
        map.set(key, { color: DEVIL_COLOR, side: 'left', participant: false });
      } else if (message.role === 'user') {
        map.set(key, { color: USER_COLOR, side: 'right', participant: false });
      } else {
        map.set(key, {
          color:
            participantColors.get(message.persona_slug) ||
            TRAIT_COLORS[index % TRAIT_COLORS.length],
          side: index % 2 === 0 ? 'left' : 'right',
          participant: true,
        });
        index += 1;
      }
    });
    return map;
  }, [messages, participantColors]);

  const summary = discussion?.final_summary || null;
  const summaryDecision = summary?.decision ? String(summary.decision) : '';
  const summaryConfidence = Number.isFinite(Number(summary?.confidence))
    && summary?.confidence !== null
    ? Math.max(0, Math.min(100, Math.round(Number(summary.confidence))))
    : null;
  const summaryLists = [
    { key: 'pros', title: t.summaryPros, items: listOf(summary?.pros) },
    { key: 'cons', title: t.summaryCons, items: listOf(summary?.cons) },
    { key: 'risks', title: t.summaryRisks, items: listOf(summary?.risks) },
  ].filter((list) => list.items.length > 0);

  const handleCopySummary = async () => {
    const lines = [discussion.question, ''];
    if (summary?.answer) lines.push(`${t.summaryAnswer}: ${summary.answer}`);
    lines.push(`${t.summaryDecision}: ${summaryDecision}`);
    if (!summary?.confirmed && summary?.revision) {
      lines.push(`${t.summaryRevision}: ${summary.revision}`);
    }
    if (summaryConfidence !== null) lines.push(`${t.summaryConfidence}: ${summaryConfidence}%`);
    summaryLists.forEach(({ title, items }) => {
      lines.push('', `${title}:`, ...items.map((item) => `• ${item}`));
    });
    if (summary?.recommendation) {
      lines.push('', `${t.summaryNextStep}: ${summary.recommendation}`);
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopyState('done');
    } catch {
      setCopyState('error');
    }
    window.setTimeout(() => setCopyState(''), 2000);
  };

  return (
    <div className="debate-page chat-page">
      <aside className="debate__form-panel chat__sidebar">
        {discussion && (
          <>
            <section className="debate__section">
              <h2 className="debate__section-title">{d.participants}</h2>
              <div className="debate__participant-row">
                {scrollState.left && (
                  <button
                    type="button"
                    className="debate__participant-arrow debate__participant-arrow--left"
                    onClick={() => scrollParticipants(-1)}
                    aria-label={d.scrollLeft}
                  >
                    <ChevronIcon />
                  </button>
                )}
                <div
                  className="debate__participant-list"
                  ref={participantListRef}
                  onScroll={updateScrollState}
                >
                  {participantEntries.map((participant, index) => {
                    const active = participant.key === activeParticipant?.key;
                    return (
                      <button
                        key={participant.key}
                        type="button"
                        className={`debate__card debate__participant ${active ? 'debate__participant--active' : ''}`}
                        style={{ '--chip': participant.color }}
                        data-active={active ? 'true' : undefined}
                        aria-label={`${d.participant} ${index + 1}`}
                        aria-pressed={active}
                        onClick={() => setActiveSlug(participant.key)}
                      >
                        <UserPlusIcon />
                        <span className="debate__participant-label">{participant.label}</span>
                      </button>
                    );
                  })}
                </div>
                {scrollState.right && (
                  <button
                    type="button"
                    className="debate__participant-arrow debate__participant-arrow--right"
                    onClick={() => scrollParticipants(1)}
                    aria-label={d.scrollRight}
                  >
                    <ChevronIcon />
                  </button>
                )}
              </div>
            </section>

            <section className="debate__section">
              <h2 className="debate__section-title">{d.aiModel}</h2>
              <div className="debate__model-card">
                <div className="debate__model-toggle">
                  <AiModelIcon />
                  <span className="debate__model-row">
                    <span
                      className={`debate__model-value ${selectedModelLabel ? '' : 'debate__model-value--placeholder'}`}
                    >
                      {selectedModelLabel || d.chooseModel}
                    </span>
                  </span>
                </div>
              </div>
            </section>

            <section className="debate__section">
              <h2 className="debate__section-title">{d.character}</h2>
              <label className="debate__card">
                <UserPlusIcon />
                <input
                  className="debate__card-input"
                  type="text"
                  value=""
                  readOnly
                  tabIndex={-1}
                  placeholder={activeTraits.length ? String(activeTraits.length) : d.placeholderCharacter}
                  aria-label={d.character}
                />
              </label>
              <div className="debate__trait-list">
                {allTraits.map((trait, index) => {
                  const active = activeTraits.includes(trait);
                  return (
                    <span
                      key={trait}
                      className={`debate__trait-chip ${active ? 'debate__trait-chip--active' : ''}`}
                      style={{ '--chip': TRAIT_COLORS[index % TRAIT_COLORS.length] }}
                    >
                      {trait}
                    </span>
                  );
                })}
              </div>
            </section>

            <section className="debate__section debate__section--description">
              <h2 className="debate__section-title">{d.description}</h2>
              <textarea
                className="debate__textarea"
                value={discussion.question}
                readOnly
                tabIndex={-1}
                aria-label={d.description}
              />
            </section>
          </>
        )}
      </aside>

      <section
        className="chat__main"
        ref={mainRef}
        onScroll={handleMainScroll}
        aria-busy={isAdvancing}
      >
        {discussion && (
          <header className="chat__prompt">
            <div className="chat__toolbar">
              {isAdvancing ? (
                <button type="button" className="chat__tool" onClick={handleStop}>
                  {t.stop}
                </button>
              ) : (
                !isFinished && (error || stopReason) && (
                  <button type="button" className="chat__tool" onClick={handleRetry}>
                    {t.resume}
                  </button>
                )
              )}
              <button
                type="button"
                className="chat__tool chat__tool--danger"
                onClick={handleDelete}
                disabled={isDeleting}
              >
                {isDeleting ? t.deleting : t.delete}
              </button>
            </div>
            <p className="chat__prompt-text">{discussion.question}</p>
          </header>
        )}

        {!discussion && (
          <div className="chat__empty" role="status">
            {loadError || t.loading}
            {loadError && (
              <button type="button" className="chat__advance" onClick={loadDiscussion}>
                {t.retry}
              </button>
            )}
          </div>
        )}

        {visibleMessages.map((message, index) => {
          const speakerKey = message.persona_name || message.role;
          const { color, side } = speakers.get(speakerKey) || { color: USER_COLOR, side: 'left' };
          const paragraphs = splitParagraphs(message.content);
          const authorName =
            (message.role === 'ai' && customNames.get(message.persona_slug))
            || message.persona_name;
          const replyTo = message.reply_to || '';
          const stance = message.role === 'ai' ? stanceText(message.stance) : '';
          const previous = visibleMessages[index - 1];
          const divider = phaseLabel(message);
          const showDivider = divider && (!previous || phaseLabel(previous) !== divider);
          const showEarlyStop =
            showDivider && message.phase === 'synthesis' && discussion?.early_stop;
          return (
            <Fragment key={message.id || `${speakerKey}-${message.seq}`}>
              {showEarlyStop && (
                <p className="chat__notice">{t.earlyStop(discussion.current_round)}</p>
              )}
              {showDivider && (
                <div className="chat__divider" role="separator">
                  <span>{divider}</span>
                </div>
              )}
              <div className={`chat__row chat__row--${side}`}>
                <span
                  className="chat__avatar"
                  style={{ '--avatar': color }}
                  aria-hidden="true"
                >
                  <AvatarIcon />
                </span>
                <div className="chat__body">
                  <div className="chat__bubble" style={{ '--bubble': color }}>
                    <div className="chat__name">{authorName}</div>
                    {(replyTo || stance) && (
                      <div className="chat__meta">
                        {replyTo && <span className="chat__reply">{t.replyTo(replyTo)}</span>}
                        {stance && <span className="chat__stance">{t.stanceLabel(stance)}</span>}
                      </div>
                    )}
                    <div className="chat__text">
                      {paragraphs.length > 0
                        ? paragraphs.map((paragraph, pIndex) => (
                            <p key={`${message.id}-${pIndex}`}>{paragraph}</p>
                          ))
                        : message.content}
                    </div>
                  </div>
                </div>
              </div>
            </Fragment>
          );
        })}

        {summaryDecision && (
          <section className="chat__summary" aria-labelledby="chat-summary-title">
            <div className="chat__summary-heading">
              <h2 id="chat-summary-title" className="chat__summary-title">
                {t.summary}
              </h2>
              <span
                className={`chat__summary-badge ${summary?.confirmed ? '' : 'chat__summary-badge--pending'}`}
              >
                {summary?.confirmed ? t.summaryConfirmed : t.summaryRevised}
              </span>
            </div>
            {summary?.answer && (
              <p className="chat__summary-answer">{String(summary.answer)}</p>
            )}
            <p className="chat__summary-decision">
              <span>{t.summaryDecision}</span>
              {summaryDecision}
            </p>
            {!summary?.confirmed && summary?.revision && (
              <p className="chat__summary-line">
                <span>{t.summaryRevision}</span>
                {String(summary.revision)}
              </p>
            )}
            {summaryConfidence !== null && (
              <div className="chat__summary-confidence">
                <span>{t.summaryConfidence}</span>
                <div
                  className="chat__confidence-bar"
                  role="meter"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={summaryConfidence}
                  aria-label={t.summaryConfidence}
                >
                  <div style={{ width: `${summaryConfidence}%` }} />
                </div>
                <strong>{summaryConfidence}%</strong>
              </div>
            )}
            <div className="chat__summary-grid">
              {summaryLists.map(({ key, title, items }) => (
                <div key={key} className={`chat__summary-block chat__summary-block--${key}`}>
                  <h3>{title}</h3>
                  <ul>
                    {items.map((item, itemIndex) => (
                      <li key={`${key}-${itemIndex}`}>{item}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            {summary?.recommendation && (
              <p className="chat__summary-line chat__summary-next">
                <span>{t.summaryNextStep}</span>
                {String(summary.recommendation)}
              </p>
            )}
            <div className="chat__summary-actions">
              <button type="button" className="chat__tool" onClick={handleCopySummary}>
                {copyState === 'done'
                  ? t.copied
                  : copyState === 'error'
                    ? t.copyError
                    : t.copySummary}
              </button>
            </div>
          </section>
        )}

        {showThoughtLine && (
          <ThoughtLine
            working={isAdvancing}
            steps={traceSteps}
            label={t.advancing}
            doneLabel={t.thoughtDone}
            glyph="sparkle"
            fontSize={16}
            className="chat__thought"
          />
        )}

        {(error || stopReason) && (
          <div className="chat__error-block" role="alert" aria-live="polite">
            <p className="debate__error">{error || stopReason}</p>
            {!isAdvancing && (
              <button type="button" className="chat__advance" onClick={handleRetry}>
                {t.resume}
              </button>
            )}
          </div>
        )}

        <div ref={bottomRef} />
      </section>
    </div>
  );
}
