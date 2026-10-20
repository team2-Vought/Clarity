import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchPersonas, fetchModels, createDiscussion } from '../api/discussions';
import { getToken } from '../api/client';
import { AiModelIcon, ChevronIcon, PlusIcon, UserPlusIcon } from '../components/DebateIcons';
import { uk } from '../copy/uk';
import { TRAITS, TRAIT_COLORS } from '../utils/debateOptions';

const t = uk.debate;

const MODEL_PLACEHOLDER = 'Оберіть модель';
const MIN_PARTICIPANTS = 2;
const DEFAULT_MAX_PARTICIPANTS = 5;

export default function DebatePage() {
  const navigate = useNavigate();
  const [personas, setPersonas] = useState([]);
  const [models, setModels] = useState([]);
  const [defaultModel, setDefaultModel] = useState('');
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
  const selectedModel = models.find((m) => m.id === activeParticipant?.model);
  const selectedModelLabel = selectedModel
    ? `${selectedModel.provider} — ${selectedModel.label || selectedModel.model}`
    : '';
  const hasAvailableModels = models.some((m) => m.available);
  const allParticipantsHaveModels =
    participants.length > 0
    && participants.every((p) => models.some((m) => m.id === p.model && m.available));
  const canAddParticipant =
    participants.length < maxParticipants && participants.length < personas.length;

  const loadData = useCallback(async () => {
    try {
      const [pData, mData] = await Promise.all([fetchPersonas(), fetchModels()]);
      const personaList = pData.personas || [];
      const modelList = mData.models || [];
      const availableModels = modelList.filter((m) => m.available);
      const selectedDefault = mData.default_model || availableModels[0]?.id || '';
      const initial = personaList.slice(0, MIN_PARTICIPANTS).map((persona, i) => ({
        slug: persona.slug,
        name: '',
        color: TRAIT_COLORS[i % TRAIT_COLORS.length],
        model: selectedDefault,
        traits: [],
      }));
      setPersonas(personaList);
      setMaxParticipants(pData.max_ai || DEFAULT_MAX_PARTICIPANTS);
      setParticipants(initial);
      setActiveSlug(initial[0]?.slug || '');
      setModels(modelList);
      setDefaultModel(selectedDefault);
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

  const handleModelSelect = (modelId) => {
    updateActiveParticipant((p) => ({ ...p, model: modelId }));
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
        model: defaultModel,
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
    if (!allParticipantsHaveModels) {
      setError(t.noModel);
      return;
    }

    setIsCreating(true);
    setError('');
    try {
      const selectedPersonas = participants.map((p) => ({
        slug: p.slug,
        name: p.name || undefined,
        model: p.model,
        traits: p.traits.length > 0 ? p.traits : undefined,
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
                  const active = activeParticipant?.model === m.id;
                  return (
                    <li key={m.id} role="presentation">
                      <button
                        type="button"
                        className={`debate__model-option ${active ? 'debate__model-option--active' : ''}`}
                        role="option"
                        aria-selected={active}
                        disabled={!m.available}
                        title={m.available ? m.notes : `${t.modelUnavailable}: ${m.key_env}`}
                        onClick={() => handleModelSelect(m.id)}
                      >
                        <span>{m.provider} — {m.label || m.model}</span>
                        {!m.available && (
                          <span className="debate__model-option-note">
                            {t.modelUnavailable}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {models.length > 0 && !hasAvailableModels && (
            <p className="debate__hint">{t.noModelsAvailable}</p>
          )}
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
          disabled={
            isCreating
            || !description.trim()
            || participants.length < MIN_PARTICIPANTS
            || !allParticipantsHaveModels
          }
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