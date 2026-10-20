import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchPersonas, fetchModels, createDiscussion } from '../api/discussions';
import { getToken } from '../api/client';
import { uk } from '../copy/uk';

const t = uk.debate;

const MODEL_PLACEHOLDER = 'Оберіть модель';
const MIN_PARTICIPANTS = 2;
const DEFAULT_MAX_PARTICIPANTS = 5;

const TRAITS = [
  'Перфекціоніст',
  'Реаліст',
  'Егоїст',
  'Романтик',
  'Оптиміст',
  'Авантюрист',
  'Стратег',
  'Провокатор',
  'Маніпулятор',
  'Бунтар',
  'Консерватор',
];

// Пастельні кольори вибраних темпераментів (по колу)
const TRAIT_COLORS = [
  '#f4c1cf', '#feedd5', '#c2effd', '#b4b5ce', '#d3f0dc', '#fff1b8',
  '#e4d4f4', '#ffd9c7', '#cfe3fb', '#f6d5ea', '#d9ecc6', '#ffe0b8',
];

const UserPlusIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M17 7C17 9.76142 14.7614 12 12 12C9.23858 12 7 9.76142 7 7C7 4.23858 9.23858 2 12 2C14.7614 2 17 4.23858 17 7Z"
      stroke="currentColor"
      strokeWidth="2"
    />
    <path
      d="M17.0001 22H5.26606C4.98244 22.0001 4.70205 21.9398 4.44351 21.8232C4.18496 21.7066 3.95416 21.5364 3.76644 21.3238C3.57871 21.1112 3.43835 20.8611 3.35467 20.5901C3.27098 20.3191 3.24589 20.0334 3.28106 19.752L3.67106 16.628C3.76176 15.9022 4.11448 15.2346 4.66289 14.7506C5.21131 14.2667 5.91764 13.9997 6.64906 14H7.00006M19.0001 14V16M19.0001 16V18M19.0001 16H17.0001M19.0001 16H21.0001"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const AiModelIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M8.6069 9.3362C9.0629 10.0562 9.6749 10.6682 10.3949 11.1242C9.6749 11.5802 9.0629 12.1922 8.6069 12.9122C8.1509 12.1922 7.5389 11.5802 6.8189 11.1242C7.5389 10.6682 8.1509 10.0562 8.6069 9.3362ZM8.6069 4.9082C8.2829 4.9082 7.9589 5.1122 7.8989 5.5082L7.6829 6.8162C7.3949 8.5442 6.0389 9.9002 4.3109 10.1882L3.0029 10.4042C2.1989 10.5362 2.1989 11.7002 3.0029 11.8322L4.3109 12.0482C6.0389 12.3362 7.3949 13.6922 7.6829 15.4202L7.8989 16.7282C7.9709 17.1362 8.2829 17.3282 8.6069 17.3282C8.9309 17.3282 9.2549 17.1242 9.3149 16.7282L9.5309 15.4202C9.8189 13.6922 11.1749 12.3362 12.9029 12.0482L14.2109 11.8322C15.0149 11.7002 15.0149 10.5362 14.2109 10.4042L12.9029 10.1882C11.1749 9.9002 9.8189 8.5442 9.5309 6.8162L9.3149 5.5082C9.2429 5.1002 8.9309 4.9082 8.6069 4.9082Z"
      fill="currentColor"
    />
    <path
      d="M17.718 3.05991L17.922 4.27191C18.102 5.33991 18.9419 6.17991 20.0099 6.35991L21.2219 6.56391C21.6299 6.63591 21.6299 7.21191 21.2219 7.27191L20.0099 7.47591C18.9419 7.65591 18.102 8.49591 17.922 9.56391L17.718 10.7759C17.646 11.1839 17.07 11.1839 17.01 10.7759L16.806 9.56391C16.626 8.49591 15.786 7.65591 14.718 7.47591L13.506 7.27191C13.098 7.19991 13.098 6.62391 13.506 6.56391L14.718 6.35991C15.786 6.17991 16.626 5.33991 16.806 4.27191L17.01 3.05991C17.082 2.65191 17.658 2.65191 17.718 3.05991Z"
      fill="currentColor"
    />
    <path
      d="M15.6721 13.5062L15.8761 14.7182C16.0561 15.7862 16.8961 16.6262 17.9641 16.8062L19.1761 17.0102C19.5841 17.0822 19.5841 17.6582 19.1761 17.7182L17.9641 17.9222C16.8961 18.1022 16.0561 18.9422 15.8761 20.0102L15.6721 21.2222C15.6001 21.6302 15.0241 21.6302 14.9641 21.2222L14.7601 20.0102C14.5801 18.9422 13.7401 18.1022 12.6721 17.9222L11.4601 17.7182C11.0521 17.6462 11.0521 17.0702 11.4601 17.0102L12.6721 16.8062C13.7401 16.6262 14.5801 15.7862 14.7601 14.7182L14.9641 13.5062C15.0361 13.0982 15.6121 13.0982 15.6721 13.5062Z"
      fill="currentColor"
    />
  </svg>
);

const ChevronIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const PlusIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

export default function DebatePage() {
  const navigate = useNavigate();
  const [personas, setPersonas] = useState([]);
  const [models, setModels] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [activeSlug, setActiveSlug] = useState('');
  const [maxParticipants, setMaxParticipants] = useState(DEFAULT_MAX_PARTICIPANTS);
  const [renamingSlug, setRenamingSlug] = useState(null);
  const [nameDraft, setNameDraft] = useState('');
  const [isModelOpen, setIsModelOpen] = useState(false);
  const [scrollState, setScrollState] = useState({ overflow: false, left: false, right: false });
  const [customTraits, setCustomTraits] = useState([]);
  const [traitDraft, setTraitDraft] = useState('');
  const [description, setDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');

  const allTraits = [...TRAITS, ...customTraits];
  const participantListRef = useRef(null);
  const modelRef = useRef(null);
  const cancelRenameRef = useRef(false);
  const activeParticipant =
    participants.find((p) => p.slug === activeSlug) || participants[0];
  const activeTraits = activeParticipant?.traits || [];
  const selectedModel = models.find((m) => m.model === activeParticipant?.model);
  const selectedModelLabel = selectedModel
    ? `${selectedModel.provider} — ${selectedModel.model}`
    : '';
  const canAddParticipant =
    participants.length < maxParticipants && participants.length < personas.length;

  const loadData = useCallback(async () => {
    try {
      const [pData, mData] = await Promise.all([fetchPersonas(), fetchModels()]);
      const personaList = pData.personas || [];
      const initial = personaList.slice(0, MIN_PARTICIPANTS).map((persona, i) => ({
        slug: persona.slug,
        name: '',
        color: TRAIT_COLORS[i % TRAIT_COLORS.length],
        model: '',
        traits: [],
      }));
      setPersonas(personaList);
      setMaxParticipants(pData.max_ai || DEFAULT_MAX_PARTICIPANTS);
      setParticipants(initial);
      setActiveSlug(initial[0]?.slug || '');
      setModels(mData.models || []);
    } catch {
      setError('Не вдалося завантажити дані');
    }
  }, []);

  useEffect(() => {
    if (!getToken()) {
      navigate('/login', { replace: true });
      return;
    }
    loadData();
  }, [loadData, navigate]);

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
  }, [participants.length, updateScrollState]);

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
  }, [activeSlug, participants.length, scrollState.overflow]);

  useEffect(() => {
    if (!isModelOpen) return undefined;
    const handleMouseDown = (e) => {
      if (!modelRef.current?.contains(e.target)) setIsModelOpen(false);
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setIsModelOpen(false);
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isModelOpen]);

  const scrollParticipants = (direction) => {
    const el = participantListRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * 108, behavior: 'smooth' });
  };

  const handleParticipantClick = (participant, index) => {
    if (participant.slug === activeParticipant?.slug) {
      setNameDraft(participant.name || String(index + 1));
      setRenamingSlug(participant.slug);
      return;
    }
    setRenamingSlug(null);
    setActiveSlug(participant.slug);
  };

  const commitRename = () => {
    if (!renamingSlug) return;
    const name = nameDraft.trim();
    setParticipants((prev) =>
      prev.map((p) => (p.slug === renamingSlug ? { ...p, name } : p))
    );
    setRenamingSlug(null);
  };

  const handleRenameBlur = () => {
    if (cancelRenameRef.current) {
      cancelRenameRef.current = false;
      return;
    }
    commitRename();
  };

  const handleRenameKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelRenameRef.current = true;
      setRenamingSlug(null);
    }
  };

  const updateActiveParticipant = (updater) => {
    setParticipants((prev) =>
      prev.map((p) =>
        p.slug === (activeParticipant?.slug ?? activeSlug) ? updater(p) : p
      )
    );
  };

  const handleModelSelect = (model) => {
    updateActiveParticipant((p) => ({ ...p, model }));
    setIsModelOpen(false);
  };

  const handleAddParticipant = () => {
    const persona = personas.find(
      (p) => !participants.some((participant) => participant.slug === p.slug)
    );
    if (!persona) return;
    setParticipants((prev) => [
      ...prev,
      {
        slug: persona.slug,
        name: '',
        color: TRAIT_COLORS[prev.length % TRAIT_COLORS.length],
        model: '',
        traits: [],
      },
    ]);
    setActiveSlug(persona.slug);
  };

  const toggleTrait = (trait) => {
    updateActiveParticipant((p) => ({
      ...p,
      traits: p.traits.includes(trait)
        ? p.traits.filter((x) => x !== trait)
        : [...p.traits, trait],
    }));
  };

  const handleTraitKeyDown = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault(); // Enter у полі не має відправляти форму
    const val = traitDraft.trim();
    if (!val) return;
    if (!allTraits.includes(val)) setCustomTraits((prev) => [...prev, val]);
    updateActiveParticipant((p) => ({
      ...p,
      traits: p.traits.includes(val) ? p.traits : [...p.traits, val],
    }));
    setTraitDraft('');
  };

  const handleStart = async (e) => {
    e.preventDefault();
    if (!description.trim()) {
      setError(t.noPersonas);
      return;
    }
    if (participants.length < MIN_PARTICIPANTS) {
      setError('Недостатньо персон');
      return;
    }

    setIsCreating(true);
    setError('');
    try {
      const selectedPersonas = participants.map((p) => ({
        slug: p.slug,
        name: p.name || undefined,
        style: p.traits.length > 0 ? p.traits.join(', ') : undefined,
      }));

      const data = await createDiscussion({
        question: description.trim(),
        mode: 'open',
        options: [],
        personas: selectedPersonas,
        rounds: 2,
      });
      navigate(`/chat/${data.id}`, { replace: true });
    } catch (err) {
      setError(err.message || t.errorCreate);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="debate-page">
      <form className="debate__form-panel" onSubmit={handleStart}>
        <section className="debate__section">
          <h2 className="debate__section-title">{t.participants}</h2>
          <div className="debate__participant-row">
            {scrollState.left && (
              <button
                type="button"
                className="debate__participant-arrow debate__participant-arrow--left"
                onClick={() => scrollParticipants(-1)}
                aria-label={t.scrollLeft}
              >
                <ChevronIcon />
              </button>
            )}
            <div
              className="debate__participant-list"
              ref={participantListRef}
              onScroll={updateScrollState}
            >
              {participants.map((p, i) => {
                const active = p.slug === activeParticipant?.slug;
                if (renamingSlug === p.slug) {
                  return (
                    <div
                      key={p.slug}
                      className="debate__card debate__participant debate__participant--active debate__participant--renaming"
                      style={{ '--chip': p.color }}
                    >
                      <UserPlusIcon />
                      <input
                        className="debate__participant-input"
                        type="text"
                        value={nameDraft}
                        onChange={(e) => setNameDraft(e.target.value)}
                        onBlur={handleRenameBlur}
                        onKeyDown={handleRenameKeyDown}
                        aria-label={`${t.renameParticipant} ${i + 1}`}
                        autoFocus
                      />
                    </div>
                  );
                }
                return (
                  <button
                    key={p.slug}
                    type="button"
                    className={`debate__card debate__participant ${active ? 'debate__participant--active' : ''}`}
                    style={{ '--chip': p.color }}
                    data-active={active ? 'true' : undefined}
                    aria-label={`${t.participant} ${i + 1}`}
                    aria-pressed={active}
                    onClick={() => handleParticipantClick(p, i)}
                  >
                    <UserPlusIcon />
                    <span className="debate__participant-label">{p.name || i + 1}</span>
                  </button>
                );
              })}
              <button
                type="button"
                className="debate__card debate__participant-add"
                onClick={handleAddParticipant}
                disabled={!canAddParticipant}
              >
                <PlusIcon />
                <span>{t.addParticipant}</span>
              </button>
            </div>
            {scrollState.right && (
              <button
                type="button"
                className="debate__participant-arrow debate__participant-arrow--right"
                onClick={() => scrollParticipants(1)}
                aria-label={t.scrollRight}
              >
                <ChevronIcon />
              </button>
            )}
          </div>
        </section>

        <section className="debate__section">
          <h2 className="debate__section-title">{t.aiModel}</h2>
          <div className="debate__model-card" ref={modelRef}>
            <button
              type="button"
              className={`debate__model-toggle ${isModelOpen ? 'debate__model-toggle--open' : ''}`}
              onClick={() => setIsModelOpen((open) => !open)}
              disabled={isCreating || !activeParticipant}
              aria-haspopup="listbox"
              aria-expanded={isModelOpen}
              aria-label={t.aiModel}
            >
              <AiModelIcon />
              <span className="debate__model-row">
                <span
                  className={`debate__model-value ${selectedModelLabel ? '' : 'debate__model-value--placeholder'}`}
                >
                  {selectedModelLabel || MODEL_PLACEHOLDER}
                </span>
                <span className="debate__model-chevron">
                  <ChevronIcon />
                </span>
              </span>
            </button>
            {isModelOpen && (
              <ul className="debate__model-menu" role="listbox" aria-label={t.aiModel}>
                {models.map((m) => {
                  const active = activeParticipant?.model === m.model;
                  return (
                    <li key={`${m.provider}:${m.model}`} role="presentation">
                      <button
                        type="button"
                        className={`debate__model-option ${active ? 'debate__model-option--active' : ''}`}
                        role="option"
                        aria-selected={active}
                        onClick={() => handleModelSelect(m.model)}
                      >
                        {m.provider} — {m.model}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        <section className="debate__section">
          <h2 className="debate__section-title">{t.character}</h2>
          <label className="debate__card">
            <UserPlusIcon />
            <input
              className="debate__card-input"
              type="text"
              value={traitDraft}
              onChange={(e) => setTraitDraft(e.target.value)}
              onKeyDown={handleTraitKeyDown}
              placeholder={activeTraits.length ? String(activeTraits.length) : t.placeholderCharacter}
              aria-label={t.character}
            />
          </label>
          <div className="debate__trait-list">
            {allTraits.map((trait, i) => {
              const active = activeTraits.includes(trait);
              return (
                <button
                  key={trait}
                  type="button"
                  className={`debate__trait-chip ${active ? 'debate__trait-chip--active' : ''}`}
                  style={{ '--chip': TRAIT_COLORS[i % TRAIT_COLORS.length] }}
                  aria-pressed={active}
                  onClick={() => toggleTrait(trait)}
                >
                  <span>{trait}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="debate__section debate__section--description">
          <h2 className="debate__section-title">{t.description}</h2>
          <textarea
            className="debate__textarea"
            placeholder={t.placeholderDescription}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={isCreating}
          />
        </section>

        {error && (
          <p className="debate__error" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          className="debate__start-btn"
          disabled={isCreating || !description.trim() || participants.length < MIN_PARTICIPANTS}
        >
          {isCreating ? t.creating : t.start}
        </button>
      </form>

      <main className="debate__main">
        <h1 className="debate__title">{t.title}</h1>
        <div className="debate__underline" />
      </main>
    </div>
  );
}

DebatePage.propTypes = {};