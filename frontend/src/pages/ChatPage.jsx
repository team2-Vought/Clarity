import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { advanceDiscussion, fetchDiscussion, fetchModels, fetchPersonas } from '../api/discussions';
import { AiModelIcon, ChevronIcon, UserPlusIcon } from '../components/DebateIcons';
import ThoughtLine from '../components/ThoughtLine';
import { uk } from '../copy/uk';
import { TRAITS, TRAIT_COLORS } from '../utils/debateOptions';

const t = uk.chat;
const d = uk.debate;

const DEVIL_COLOR = '#fde3c6';
const USER_COLOR = '#f0f0f0';
const MAX_AUTO_STEPS = 50;

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

export default function ChatPage() {
  const { id } = useParams();
  const [discussion, setDiscussion] = useState(null);
  const [personas, setPersonas] = useState([]);
  const [models, setModels] = useState([]);
  const [defaultModel, setDefaultModel] = useState('');
  const [activeSlug, setActiveSlug] = useState('');
  const [scrollState, setScrollState] = useState({ overflow: false, left: false, right: false });
  const [isAdvancing, setIsAdvancing] = useState(false);
  const [error, setError] = useState('');
  const discussionRef = useRef(null);
  const runningRef = useRef(false);
  const autoStartedRef = useRef(null);
  const bottomRef = useRef(null);
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
    } catch (err) {
      setError(err.message || t.loadError);
    }
  }, [id]);

  useEffect(() => {
    autoStartedRef.current = null;
    loadDiscussion();
  }, [loadDiscussion]);

  const runDiscussion = useCallback(async () => {
    const start = discussionRef.current;
    if (!start || runningRef.current || start.phase === 'done' || start.is_finished) {
      return;
    }

    runningRef.current = true;
    setIsAdvancing(true);
    setError('');

    let current = start;
    try {
      for (let step = 0; step < MAX_AUTO_STEPS; step += 1) {
        if (!current || current.phase === 'done' || current.is_finished) break;

        const data = await advanceDiscussion(current.id);
        const message = data?.message;
        current = {
          ...current,
          ...(data?.discussion || {}),
          messages: message
            ? [...(current.messages || []), message]
            : (current.messages || []),
        };
        discussionRef.current = current;
        setDiscussion(current);

        if (current.phase === 'done' || current.is_finished) break;
        if (!message) {
          setError(t.stopped);
          break;
        }
      }

      if (current && current.phase !== 'done' && !current.is_finished) {
        setError((previous) => previous || t.stopped);
      }
    } catch (err) {
      setError(err.message || t.errorAdvance);
    } finally {
      runningRef.current = false;
      setIsAdvancing(false);
    }
  }, []);

  useEffect(() => {
    if (!discussion) return;
    if (autoStartedRef.current === discussion.id) return;
    autoStartedRef.current = discussion.id;
    runDiscussion();
  }, [discussion, runDiscussion]);

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

  const participantEntries = useMemo(
    () =>
      (discussion?.personas || []).map((persona, index) => ({
        key: persona.slug || `participant-${index}`,
        label: persona.name || String(index + 1),
        model: persona.model || defaultModel || '',
        traits: Array.isArray(persona.traits) ? persona.traits : [],
        color: TRAIT_COLORS[index % TRAIT_COLORS.length],
      })),
    [discussion?.personas, defaultModel]
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

  const stagePlan = useMemo(() => {
    const selected = discussion?.personas || [];
    if (selected.length === 0) return [];

    const names = selected.map(
      (persona, index) =>
        persona.name || personaNames.get(persona.slug) || t.fallbackParticipant(index + 1)
    );
    const rounds = Math.max(1, Number(discussion?.rounds) || 1);
    const stages = names.map((name) => t.stageOpening(name));

    for (let round = 1; round <= rounds; round += 1) {
      names.forEach((name) => stages.push(t.stageRound(round, name)));
    }

    stages.push(t.stageSynthesis);
    stages.push(t.stageDevil);
    stages.push(t.stageFinal);
    return stages;
  }, [discussion?.personas, discussion?.rounds, personaNames]);

  const completedSteps = visibleMessages.length;
  const traceSteps = stagePlan.slice(
    0,
    isFinished ? stagePlan.length : Math.min(completedSteps + 1, stagePlan.length)
  );
  const showThoughtLine = stagePlan.length > 0 && (isAdvancing || isFinished);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [visibleMessages.length, isAdvancing, error]);

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

  const handleRetry = () => {
    if (runningRef.current) return;
    runDiscussion();
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

      <section className="chat__main">
        {discussion && (
          <header className="chat__prompt">
            <p className="chat__prompt-text">{discussion.question}</p>
          </header>
        )}

        {!discussion && <div className="chat__empty">{t.loading}</div>}

        {visibleMessages.map((message) => {
          const key = message.persona_name || message.role;
          const { color, side } = speakers.get(key) || { color: USER_COLOR, side: 'left' };
          const paragraphs = splitParagraphs(message.content);
          return (
            <div key={message.id} className={`chat__row chat__row--${side}`}>
              <span className="chat__avatar" aria-hidden="true">
                <AvatarIcon />
              </span>
              <div className="chat__body">
                <div className="chat__bubble" style={{ '--bubble': color }}>
                  <div className="chat__name">{message.persona_name}</div>
                  <div className="chat__text">
                    {paragraphs.length > 0
                      ? paragraphs.map((paragraph, index) => (
                          <p key={`${message.id}-${index}`}>{paragraph}</p>
                        ))
                      : message.content}
                  </div>
                </div>
              </div>
            </div>
          );
        })}

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

        {error && (
          <div className="chat__error-block">
            <p className="debate__error" role="alert">
              {error}
            </p>
            {!isAdvancing && (
              <button type="button" className="chat__advance" onClick={handleRetry}>
                {t.retry}
              </button>
            )}
          </div>
        )}

        <div ref={bottomRef} />
      </section>
    </div>
  );
}
