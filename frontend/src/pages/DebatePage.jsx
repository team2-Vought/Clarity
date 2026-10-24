import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useOutletContext } from 'react-router-dom';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  BookmarkAdd01Icon,
  Delete02Icon,
  PencilEdit02Icon,
} from '@hugeicons/core-free-icons';
import {
  createDiscussion,
  deleteTeam,
  fetchModels,
  fetchPersonas,
  fetchTeams,
  saveTeam,
} from '../api/discussions';
import { getToken } from '../api/client';
import {
  ArrowUpIcon,
  CloseIcon,
  PlusIcon,
} from '../components/DebateIcons';
import ModePicker from '../components/ModePicker';
import ModelPicker from '../components/ModelPicker';
import PanelToggle from '../components/PanelToggle';
import RolePicker from '../components/RolePicker';
import TraitPicker from '../components/TraitPicker';
import { uk } from '../copy/uk';
import { ROLE_ORDER, TRAITS, TRAIT_COLORS, roleIcon } from '../utils/debateOptions';
import { useToasts } from '../hooks/useToasts';

const t = uk.debate;

// Фраза заголовка обирається випадково один раз на завантаження сторінки
const TITLE = t.titles[Math.floor(Math.random() * t.titles.length)];

const MIN_PARTICIPANTS = 2;
const DEFAULT_MAX_PARTICIPANTS = 5;
const DEFAULT_ROUNDS = 2;
// сервер рахує довжину після стискання пробілів, тож і тут так само
const MIN_QUESTION = 10;
const MAX_QUESTION = 6000;
const MAX_NAME = 64;
const MAX_TRAIT = 40;
const DRAFT_KEY = 'clarity:draft-question';

const readDraft = () => {
  try {
    return localStorage.getItem(DRAFT_KEY) || '';
  } catch {
    return '';
  }
};

const saveDraft = (value) => {
  try {
    if (value.trim()) localStorage.setItem(DRAFT_KEY, value);
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    // без сховища чернетка просто не переживе перезавантаження
  }
};

const shortModel = (model) => (model ? model.label || model.model : '');

// Склад учасників зі збережених даних (команда, шаблон, попередня дискусія).
// Невідомі ролі пропускаємо, недоступну модель замінюємо наступною з пулу.
const toParticipants = (list, { known, availableIds, fallbackModel }) =>
  (list || [])
    .map((item) => (typeof item === 'string' ? { slug: item } : item))
    .filter((item) => known.has(item.slug))
    .map((item, i) => ({
      slug: item.slug,
      name: item.name || '',
      color: TRAIT_COLORS[i % TRAIT_COLORS.length],
      model: availableIds.has(item.model) ? item.model : fallbackModel(i),
      traits: Array.isArray(item.traits) ? item.traits : [],
    }));

const customTraitsOf = (list) => [
  ...new Set(list.flatMap((p) => p.traits).filter((trait) => !TRAITS.includes(trait))),
];

// Ім'я «Учасник N» сервер дає сам, тож у збереженому складі воно зайве:
// інакше після перестановки учасників номер не збігався б з позицією
const isDefaultName = (name) => /^Учасник \d+$/.test(name || '');

const MAX_OPTIONS = 8;
const OPTION_LETTERS = 'ABCDEFGH';

// Ролі за замовчуванням ідуть у порядку, що дає різні погляди вже з двох учасників.
const orderRoles = (list) =>
  [...list].sort((a, b) => {
    const ia = ROLE_ORDER.indexOf(a.slug);
    const ib = ROLE_ORDER.indexOf(b.slug);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

// Різні моделі для різних учасників: одна модель N разів повторює ті самі
// знання й упередження. Спершу рекомендовані, потім решта доступних.
const modelPool = (models, recommended, defaultId) => {
  const available = models.filter((m) => m.available).map((m) => m.id);
  const ordered = [defaultId, ...recommended, ...available].filter(
    (id, index, list) => id && available.includes(id) && list.indexOf(id) === index
  );
  return ordered;
};

export default function DebatePage() {
  const navigate = useNavigate();
  const [personas, setPersonas] = useState([]);
  const [models, setModels] = useState([]);
  const [defaultModel, setDefaultModel] = useState('');
  const [modelOrder, setModelOrder] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [activeSlug, setActiveSlug] = useState('');
  const [maxParticipants, setMaxParticipants] = useState(DEFAULT_MAX_PARTICIPANTS);
  const [customTraits, setCustomTraits] = useState([]);
  const [traitDraft, setTraitDraft] = useState('');
  const location = useLocation();
  // «Повторити з цими налаштуваннями» з чату приносить шаблон у state переходу
  const templateRef = useRef(location.state?.template || null);
  const [description, setDescription] = useState(
    () => location.state?.template?.question || readDraft()
  );
  const [searchStatus, setSearchStatus] = useState({ available: false, provider: '', limited: false });
  const [webSearch, setWebSearch] = useState(false);
  const [moderatorModel, setModeratorModel] = useState('');
  const [devilModel, setDevilModel] = useState('');
  const [mode, setMode] = useState('open');
  const [options, setOptions] = useState([]);
  const [optionDraft, setOptionDraft] = useState('');
  const [rounds, setRounds] = useState(DEFAULT_ROUNDS);
  const [maxRounds, setMaxRounds] = useState(3);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  // на телефоні панель налаштувань — висувна, відкривається кнопкою «≡»
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const { panelCollapsed = false, registerPanelToggle } = useOutletContext() ?? {};

  // на телефоні кнопка-перемикач у куті відкриває / закриває висувну панель
  useEffect(
    () => registerPanelToggle?.(() => setIsPanelOpen((open) => !open)),
    [registerPanelToggle]
  );
  const [isCreating, setIsCreating] = useState(false);
  const [teams, setTeams] = useState([]);
  const [teamName, setTeamName] = useState('');
  const [isTeamFormOpen, setIsTeamFormOpen] = useState(false);
  const [isSavingTeam, setIsSavingTeam] = useState(false);
  const { pushToast } = useToasts();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const allTraits = [...TRAITS, ...customTraits];
  const advancedRef = useRef(null);
  const panelRef = useRef(null);
  const teamInputRef = useRef(null);
  const formRef = useRef(null);
  const questionRef = useRef(null);
  const activeParticipant =
    participants.find((p) => p.slug === activeSlug) || participants[0];
  const activeTraits = activeParticipant?.traits || [];
  const hasAvailableModels = models.some((m) => m.available);
  const allParticipantsHaveModels =
    participants.length > 0
    && participants.every((p) => models.some((m) => m.id === p.model && m.available));
  const activeIndex = Math.max(0, participants.indexOf(activeParticipant));
  const activeLabel = activeParticipant?.name || `${t.participant} ${activeIndex + 1}`;
  const canStart =
    !isCreating
    && !isLoading
    && description.trim().length > 0
    && participants.length >= MIN_PARTICIPANTS
    && allParticipantsHaveModels;
  const canAddParticipant =
    participants.length < maxParticipants && participants.length < personas.length;

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const [pData, mData, teamData] = await Promise.all([
        fetchPersonas(),
        fetchModels(),
        // без збережених команд сторінка все одно працює
        fetchTeams().catch(() => null),
      ]);
      setTeams(teamData?.results || []);
      const personaList = orderRoles(pData.personas || []);
      const modelList = mData.models || [];
      const availableModels = modelList.filter((m) => m.available);
      const selectedDefault =
        availableModels.find((model) => model.id === mData.default_model)?.id
        || availableModels[0]?.id
        || '';
      const pool = modelPool(modelList, mData.recommended || [], selectedDefault);
      const fallbackModel = (i) => (pool.length ? pool[i % pool.length] : selectedDefault);
      const template = templateRef.current;
      const known = new Set(personaList.map((persona) => persona.slug));
      const fromTemplate = toParticipants(template?.personas, {
        known,
        availableIds: new Set(availableModels.map((m) => m.id)),
        fallbackModel,
      }).map((p) => ({ ...p, name: isDefaultName(p.name) ? '' : p.name }));
      const initial = fromTemplate.length >= MIN_PARTICIPANTS
        ? fromTemplate
        : personaList.slice(0, MIN_PARTICIPANTS).map((persona, i) => ({
          slug: persona.slug,
          name: '',
          color: TRAIT_COLORS[i % TRAIT_COLORS.length],
          model: fallbackModel(i),
          traits: [],
        }));
      if (template) {
        setCustomTraits(customTraitsOf(initial));
        if (template.mode) setMode(template.mode);
        if (template.mode === 'choose_one') setOptions(template.options || []);
        if (template.rounds) setRounds(template.rounds);
        setModeratorModel(template.moderatorModel || '');
        setDevilModel(template.devilModel || '');
        // шаблон застосовуємо один раз: після перезавантаження діє звичайна чернетка
        templateRef.current = null;
        window.history.replaceState({ ...window.history.state, usr: null }, '');
      }
      const search = pData.search || { available: false };
      setSearchStatus(search);
      // пошук увімкнено за замовчуванням, якщо сервер його підтримує
      const templateSearch = template?.webSearch;
      setWebSearch(Boolean(search.available && (templateSearch ?? true)));
      setModelOrder(pool);
      setPersonas(personaList);
      setMaxParticipants(pData.max_ai || DEFAULT_MAX_PARTICIPANTS);
      setMaxRounds(pData.max_rounds || 3);
      setParticipants(initial);
      setActiveSlug(initial[0]?.slug || '');
      setModels(modelList);
      setDefaultModel(selectedDefault);
      setError('');
    } catch (err) {
      setError(err?.message || t.loadError);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!getToken()) {
      navigate('/login', { replace: true });
      return undefined;
    }
    const timer = setTimeout(loadData, 0);
    return () => clearTimeout(timer);
  }, [loadData, navigate]);

  // Поле промпту росте разом із текстом; після max-height з'являється скрол.
  useLayoutEffect(() => {
    const el = questionRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [description]);

  const handleQuestionKeyDown = (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    if (canStart) formRef.current?.requestSubmit();
  };

  useEffect(() => {
    if (!isPanelOpen) return undefined;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !isAdvancedOpen) setIsPanelOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isPanelOpen, isAdvancedOpen]);

  // поле назви команди завжди в розмітці (щоб плавно розкриватися), тож фокус ставимо самі
  useEffect(() => {
    if (isTeamFormOpen) teamInputRef.current?.focus({ preventScroll: true });
  }, [isTeamFormOpen]);

  useEffect(() => {
    if (!isAdvancedOpen) return undefined;
    const handleMouseDown = (e) => {
      if (!advancedRef.current?.contains(e.target)) setIsAdvancedOpen(false);
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setIsAdvancedOpen(false);
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isAdvancedOpen]);

  const updateActiveParticipant = (updater) => {
    setParticipants((prev) =>
      prev.map((p) =>
        p.slug === (activeParticipant?.slug ?? activeSlug) ? updater(p) : p
      )
    );
  };

  const handleModelSelect = (modelId) => {
    updateActiveParticipant((p) => ({ ...p, model: modelId }));
  };

  // Роль (архетип) учасника: визначає базовий спосіб мислення.
  const handleRoleSelect = (slug) => {
    if (!activeParticipant || slug === activeParticipant.slug) return;
    if (participants.some((p) => p.slug === slug)) return;
    const previous = activeParticipant.slug;
    setParticipants((prev) => prev.map((p) => (p.slug === previous ? { ...p, slug } : p)));
    setActiveSlug(slug);
  };

  const handleRemoveParticipant = (slug) => {
    if (participants.length <= MIN_PARTICIPANTS) return;
    const index = participants.findIndex((p) => p.slug === slug);
    if (index < 0) return;
    const next = participants.filter((p) => p.slug !== slug);
    setParticipants(next);
    if (slug === activeParticipant?.slug) {
      // активним стає сусід зліва (або новий перший)
      setActiveSlug(next[Math.max(0, index - 1)]?.slug || '');
    }
  };

  const selectParticipant = (slug) => {
    if (slug === activeParticipant?.slug) return;
    setActiveSlug(slug);
  };

  // Ім'я редагується прямо в заголовку анкети; пробіли по краях прибираються на виході з поля
  const updateName = (value) => {
    updateActiveParticipant((p) => ({ ...p, name: value }));
  };

  const handleNameKeyDown = (e) => {
    if (e.key !== 'Enter' && e.key !== 'Escape') return;
    e.preventDefault(); // Enter у полі не має відправляти форму
    e.currentTarget.blur();
  };

  // Додаткові налаштування — окремий екран панелі; кожен екран відкривається з початку
  const toggleAdvanced = () => {
    setIsAdvancedOpen((open) => !open);
    panelRef.current?.scrollTo({ top: 0 });
  };

  const handleModeChange = (nextMode) => {
    setMode(nextMode);
    if (nextMode !== 'choose_one') {
      setOptions([]);
      setOptionDraft('');
    }
  };

  const addOption = () => {
    const value = optionDraft.trim();
    if (!value) return;
    if (value.length > 100) {
      setError(t.optionTooLong);
      return;
    }
    if (options.some((item) => item.toLowerCase() === value.toLowerCase())) {
      setError(t.optionDuplicate);
      return;
    }
    if (options.length >= 8) {
      setError(t.optionsRange);
      return;
    }
    setOptions((prev) => [...prev, value]);
    setOptionDraft('');
    setError('');
  };

  const removeOption = (value) => {
    setOptions((prev) => prev.filter((item) => item !== value));
  };

  const addTrait = () => {
    const val = traitDraft.trim();
    if (!val) return;
    if (val.length > MAX_TRAIT) {
      setError(t.traitTooLong);
      return;
    }
    if (!allTraits.includes(val)) setCustomTraits((prev) => [...prev, val]);
    updateActiveParticipant((p) => ({
      ...p,
      traits: p.traits.includes(val) ? p.traits : [...p.traits, val],
    }));
    setTraitDraft('');
    setError('');
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
        model: modelOrder.length ? modelOrder[prev.length % modelOrder.length] : defaultModel,
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

  const handleOptionKeyDown = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    addOption();
  };

  const participantContext = () => ({
    known: new Set(personas.map((persona) => persona.slug)),
    availableIds: new Set(models.filter((m) => m.available).map((m) => m.id)),
    fallbackModel: (i) => (modelOrder.length ? modelOrder[i % modelOrder.length] : defaultModel),
  });

  const replaceParticipants = (next) => {
    setParticipants(next);
    setActiveSlug(next[0]?.slug || '');
    setRenamingSlug(null);
    setCustomTraits((current) => [...new Set([...current, ...customTraitsOf(next)])]);
  };

  const applyTeam = (team) => {
    const next = toParticipants(team.personas, participantContext()).map((p) => ({
      ...p,
      name: isDefaultName(p.name) ? '' : p.name,
    }));
    if (next.length < MIN_PARTICIPANTS) {
      setError(t.teamApplyError);
      return;
    }
    replaceParticipants(next);
    setModeratorModel(team.moderator_model || '');
    setDevilModel(team.devil_model || '');
    setError('');
  };

  const personasPayload = () =>
    participants.map((p) => ({
      slug: p.slug,
      name: (p.name || '').trim() || undefined,
      model: p.model,
      traits: p.traits.length > 0 ? p.traits : undefined,
    }));

  const saveCurrentTeam = async () => {
    const name = teamName.trim();
    if (!name || isSavingTeam) return;
    setIsSavingTeam(true);
    try {
      const team = await saveTeam({
        name,
        personas: personasPayload(),
        moderatorModel,
        devilModel,
      });
      setTeams((current) => [team, ...current.filter((item) => item.id !== team.id)]);
      setTeamName('');
      setIsTeamFormOpen(false);
      pushToast(t.teamSaved(team.name));
    } catch (err) {
      setError(err.message || t.teamSaveError);
    } finally {
      setIsSavingTeam(false);
    }
  };

  const removeTeam = async (team) => {
    setTeams((current) => current.filter((item) => item.id !== team.id));
    try {
      await deleteTeam(team.id);
    } catch (err) {
      setTeams((current) => [team, ...current]);
      setError(err.message);
    }
  };

  const handleTeamKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveCurrentTeam();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsTeamFormOpen(false);
    }
  };

  const handleStart = async (e) => {
    e.preventDefault();
    const question = description.trim();
    if (!question) {
      setError(t.placeholderDescription);
      return;
    }
    if (question.replace(/[ \t]+/g, ' ').length < MIN_QUESTION) {
      setError(t.tooShort);
      return;
    }
    if (question.length > MAX_QUESTION) {
      setError(t.tooLong);
      return;
    }
    if (participants.length < MIN_PARTICIPANTS) {
      setError(t.minParticipants);
      return;
    }
    if (!allParticipantsHaveModels) {
      setError(t.noModel);
      return;
    }
    if (mode === 'choose_one' && (options.length < 2 || options.length > 8)) {
      setError(t.optionsRequired);
      return;
    }
    const names = participants.map((p) => (p.name || '').trim().toLowerCase());
    if (names.some(Boolean) && new Set(names.filter(Boolean)).size !== names.filter(Boolean).length) {
      setError(t.namesDuplicate);
      return;
    }

    setIsCreating(true);
    setError('');
    try {
      const selectedPersonas = personasPayload();

      const data = await createDiscussion({
        question,
        mode,
        options: mode === 'choose_one' ? options : [],
        personas: selectedPersonas,
        rounds,
        webSearch,
        moderatorModel,
        devilModel,
      });
      saveDraft('');
      navigate(`/chat/${data.id}`, { replace: true });
    } catch (err) {
      setError(err.message || t.errorCreate);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <form
      className={`debate-page ${isPanelOpen ? 'debate-page--panel-open' : ''} ${panelCollapsed ? 'debate-page--panel-collapsed' : ''}`}
      ref={formRef}
      onSubmit={handleStart}
      noValidate
    >
      <PanelToggle controls="debate-settings" phoneOpen={isPanelOpen} />
      {isPanelOpen && (
        <div
          className="debate__panel-backdrop"
          onClick={() => setIsPanelOpen(false)}
          aria-hidden="true"
        />
      )}
      <div className="debate__form-panel" id="debate-settings" ref={panelRef}>
        {isAdvancedOpen ? (
          <section
            className="debate__panel-view"
            id="debate-advanced"
            ref={advancedRef}
            aria-labelledby="debate-more-title"
          >
            <div className="debate__panel-body debate__more">
              <div className="debate__cast-head">
                <h2 id="debate-more-title" className="debate__cast-title">{t.advancedShort}</h2>
              </div>

              <div className="debate__sheet">
                <div className="debate__field debate__field--first">
                  <h3 className="debate__field-title">
                    {t.rounds}
                    <span className="debate__field-aside">{t.roundsSub(rounds)}</span>
                  </h3>
                  <div className="debate__pills" role="radiogroup" aria-label={t.rounds}>
                    {Array.from({ length: maxRounds }, (_, i) => i + 1).map((value) => (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={rounds === value}
                        className={`debate__pill ${rounds === value ? 'debate__pill--active' : ''}`}
                        onClick={() => setRounds(value)}
                        disabled={isCreating}
                      >
                        {t.advancedRounds(value)}
                      </button>
                    ))}
                  </div>
                  <p className="debate__note">{t.roundsHint}</p>
                </div>

                <div className="debate__field">
                  <label className={`debate__switch-row ${searchStatus.available ? '' : 'debate__switch-row--off'}`}>
                    <span className="debate__field-title">{t.webSearch}</span>
                    <input
                      type="checkbox"
                      role="switch"
                      className="debate__switch-input"
                      checked={webSearch}
                      onChange={(e) => setWebSearch(e.target.checked)}
                      disabled={isCreating || !searchStatus.available}
                    />
                  </label>
                  {!searchStatus.available && (
                    <p className="debate__note">{t.webSearchUnavailable}</p>
                  )}
                </div>
              </div>

              <div className="debate__sheet">
                <div className="debate__field debate__field--first">
                  <h3 className="debate__field-title">{t.judges}</h3>
                </div>
                {[
                  { key: 'moderator', name: t.moderator, sub: t.moderatorSub, value: moderatorModel, onChange: setModeratorModel, label: t.moderatorModel },
                  { key: 'devil', name: t.devil, sub: t.devilSub, value: devilModel, onChange: setDevilModel, label: t.devilModel },
                ].map((judge) => (
                  <div key={judge.key} className="debate__field">
                    <h3 className="debate__field-title">
                      <span className="debate__judge-name">
                        <HugeiconsIcon icon={roleIcon(judge.key)} size={15} strokeWidth={1.8} aria-hidden="true" />
                        {judge.name}
                      </span>
                      <span className="debate__field-aside">{judge.sub}</span>
                    </h3>
                    <ModelPicker
                      models={models}
                      value={judge.value}
                      onChange={judge.onChange}
                      disabled={isCreating}
                      label={judge.label}
                      autoLabel={t.autoModel}
                    />
                  </div>
                ))}
              </div>
            </div>
            <button
              type="button"
              className="debate__more-toggle debate__more-toggle--back"
              onClick={toggleAdvanced}
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} size={16} aria-hidden="true" />
              <span className="debate__more-toggle-text">{t.back}</span>
            </button>
          </section>
        ) : (
          <div className="debate__panel-view">
            <div className="debate__panel-body">
              <section className="debate__cast" aria-labelledby="debate-cast-title">
                <div className="debate__cast-head">
                  <h2 id="debate-cast-title" className="debate__cast-title">
                    {t.participants}
                    <span className="debate__cast-count">
                      {participants.length}/{maxParticipants}
                    </span>
                  </h2>
                  {!isTeamFormOpen && (
                    <button
                      type="button"
                      className="debate__ghost"
                      onClick={() => setIsTeamFormOpen(true)}
                      disabled={isCreating || participants.length < MIN_PARTICIPANTS}
                      aria-label={t.saveTeam}
                      title={t.teamsHint}
                    >
                      <HugeiconsIcon icon={BookmarkAdd01Icon} size={16} aria-hidden="true" />
                    </button>
                  )}
                </div>

                <div className="debate__lineup">
                  {participants.map((p, i) => {
                    const active = p.slug === activeParticipant?.slug;
                    const label = p.name.trim() || t.participantN(i + 1);
                    const roleName = personas.find((persona) => persona.slug === p.slug)?.name || '';
                    const modelName = shortModel(models.find((m) => m.id === p.model));
                    return (
                      <button
                        key={p.slug}
                        type="button"
                        className={`debate__token ${active ? 'debate__token--active' : ''}`}
                        style={{ '--chip': p.color }}
                        aria-pressed={active}
                        aria-label={t.selectParticipant(label)}
                        title={[label, roleName, modelName].filter(Boolean).join(' · ')}
                        onClick={() => selectParticipant(p.slug)}
                      >
                        <HugeiconsIcon icon={roleIcon(p.slug)} size={20} strokeWidth={1.8} aria-hidden="true" />
                        <span className="debate__token-num" aria-hidden="true">{i + 1}</span>
                      </button>
                    );
                  })}
                  {canAddParticipant && (
                    <button
                      type="button"
                      className="debate__token debate__token--add"
                      onClick={handleAddParticipant}
                      aria-label={t.addParticipant}
                      title={t.addParticipant}
                    >
                      <PlusIcon />
                    </button>
                  )}
                </div>

                {/* поле назви розкривається плавно й відсуває картку учасника вниз */}
                <div
                  className={`debate__team-reveal ${isTeamFormOpen ? 'debate__team-reveal--open' : ''}`}
                  inert={!isTeamFormOpen}
                >
                  <div className="debate__team-reveal-inner">
                    <div className="debate__team-form">
                      <input
                        ref={teamInputRef}
                        type="text"
                        value={teamName}
                        maxLength={MAX_NAME}
                        onChange={(e) => setTeamName(e.target.value)}
                        onKeyDown={handleTeamKeyDown}
                        onBlur={() => {
                          if (!teamName.trim()) setIsTeamFormOpen(false);
                        }}
                        placeholder={t.teamNamePlaceholder}
                        aria-label={t.teamName}
                      />
                      <button
                        type="button"
                        className="debate__mini-add"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={saveCurrentTeam}
                        disabled={!teamName.trim() || isSavingTeam}
                        aria-label={t.saveTeam}
                        title={t.saveTeam}
                      >
                        <PlusIcon />
                      </button>
                    </div>
                  </div>
                </div>

                {teams.length > 0 && (
                  <div className="debate__teams" role="group" aria-label={t.teams}>
                    <span className="debate__teams-label">{t.teams}</span>
                    {teams.map((team) => (
                      <span key={team.id} className="debate__team-chip">
                        <button
                          type="button"
                          className="debate__team-apply"
                          onClick={() => applyTeam(team)}
                          disabled={isCreating}
                          title={t.applyTeam(team.name)}
                        >
                          {team.name}
                        </button>
                        <button
                          type="button"
                          className="debate__team-remove"
                          onClick={() => removeTeam(team)}
                          aria-label={t.deleteTeam(team.name)}
                          title={t.deleteTeam(team.name)}
                        >
                          <CloseIcon />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </section>

              {activeParticipant && (
                <section
                  className="debate__sheet"
                  style={{ '--chip': activeParticipant.color }}
                  aria-label={t.participantSheet(activeLabel)}
                >
                  <div className="debate__sheet-head">
                    <span className="debate__sheet-avatar" aria-hidden="true">
                      <HugeiconsIcon icon={roleIcon(activeParticipant.slug)} size={22} strokeWidth={1.8} />
                    </span>
                    <label className="debate__sheet-name">
                      <input
                        type="text"
                        value={activeParticipant.name}
                        maxLength={MAX_NAME}
                        onChange={(e) => updateName(e.target.value)}
                        onBlur={() => updateName(activeParticipant.name.trim())}
                        onKeyDown={handleNameKeyDown}
                        placeholder={t.participantN(activeIndex + 1)}
                        aria-label={t.participantName}
                        disabled={isCreating}
                      />
                      <HugeiconsIcon icon={PencilEdit02Icon} size={14} aria-hidden="true" />
                    </label>
                    {participants.length > MIN_PARTICIPANTS && (
                      <button
                        type="button"
                        className="debate__sheet-remove"
                        onClick={() => handleRemoveParticipant(activeParticipant.slug)}
                        disabled={isCreating}
                        aria-label={t.removeParticipant(activeLabel)}
                        title={t.removeParticipant(activeLabel)}
                      >
                        <HugeiconsIcon icon={Delete02Icon} size={16} aria-hidden="true" />
                      </button>
                    )}
                  </div>

                  <div className="debate__field">
                    <h3 className="debate__field-title">{t.role}</h3>
                    <RolePicker
                      personas={personas}
                      participants={participants}
                      value={activeParticipant.slug}
                      onChange={handleRoleSelect}
                      disabled={isCreating}
                    />
                  </div>

                  <div className="debate__field">
                    <h3 className="debate__field-title">{t.aiModel}</h3>
                    <ModelPicker
                      models={models}
                      value={activeParticipant.model || ''}
                      onChange={handleModelSelect}
                      disabled={isCreating}
                    />
                    {models.length > 0 && !hasAvailableModels && (
                      <p className="debate__hint">{t.noModelsAvailable}</p>
                    )}
                  </div>

                  <div className="debate__field">
                    <h3 className="debate__field-title">
                      {t.character}
                      {activeTraits.length > 0 && (
                        <span className="debate__field-aside">{t.traitsPicked(activeTraits.length)}</span>
                      )}
                    </h3>
                    <TraitPicker
                      traits={allTraits}
                      value={activeTraits}
                      onToggle={toggleTrait}
                      draft={traitDraft}
                      onDraftChange={setTraitDraft}
                      onAdd={addTrait}
                      maxLength={MAX_TRAIT}
                      disabled={isCreating}
                    />
                  </div>
                </section>
              )}
              {isLoading && (
                <p className="debate__hint" role="status">{t.loading}</p>
              )}
            </div>
            <button
              type="button"
              className="debate__more-toggle"
              onClick={toggleAdvanced}
              aria-expanded={isAdvancedOpen}
              aria-controls="debate-advanced"
            >
              <span className="debate__more-toggle-text">{t.advancedShort}</span>
              <HugeiconsIcon icon={ArrowRight01Icon} size={16} aria-hidden="true" />
            </button>
          </div>
        )}

      </div>

      <main className="debate__main">
        {/* бліда пляма під полем вводу, що повільно переливається, поки чат порожній */}
        <div className="debate__glow" aria-hidden="true">
          <span className="debate__glow-blob" />
        </div>
        <div className="debate__hero">
          <h1 className="debate__title">{TITLE}</h1>
        </div>

        <div className="debate__prompt">
          <ModePicker
            value={mode}
            onChange={handleModeChange}
            onChosen={() => questionRef.current?.focus()}
            disabled={isCreating}
          />
          <div
            className={`debate__composer ${isCreating ? 'debate__composer--busy' : ''}`}
            onClick={(e) => {
              if (e.target === e.currentTarget) questionRef.current?.focus();
            }}
          >
            <textarea
              ref={questionRef}
              className="debate__composer-input"
              placeholder={t.placeholderDescription}
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                saveDraft(e.target.value);
              }}
              onKeyDown={handleQuestionKeyDown}
              maxLength={MAX_QUESTION}
              rows={1}
              disabled={isCreating}
              aria-label={t.description}
            />
            <div className="debate__composer-bar">
              <span
                className={`debate__composer-count ${description.length >= MAX_QUESTION ? 'debate__hint--error' : ''}`}
              >
                {description.length > 0 ? `${description.length} / ${MAX_QUESTION}` : ''}
              </span>
              <button
                type="submit"
                className="debate__send"
                disabled={!canStart}
                aria-label={isCreating ? t.creating : t.start}
                title={isCreating ? t.creating : t.start}
              >
                {isCreating ? <span className="debate__send-spinner" /> : <ArrowUpIcon />}
              </button>
            </div>
          </div>
        </div>

        <div className="debate__mode-bar">
          {mode === 'choose_one' && (
            <div
              className="debate__option-field"
              onClick={(e) => {
                if (e.target === e.currentTarget) e.currentTarget.querySelector('input')?.focus();
              }}
            >
              {options.map((option, index) => (
                <span key={option} className="debate__option-chip">
                  <span className="debate__option-letter" aria-hidden="true">
                    {OPTION_LETTERS[index]}
                  </span>
                  {option}
                  <button
                    type="button"
                    className="debate__option-remove"
                    onClick={() => removeOption(option)}
                    aria-label={t.removeOption(option)}
                  >
                    ×
                  </button>
                </span>
              ))}
              {options.length < MAX_OPTIONS && (
                <input
                  className="debate__option-draft"
                  type="text"
                  value={optionDraft}
                  maxLength={100}
                  onChange={(e) => setOptionDraft(e.target.value)}
                  onKeyDown={handleOptionKeyDown}
                  placeholder={options.length < 2 ? t.optionPlaceholder : t.optionPlaceholderMore}
                  aria-label={t.options}
                  disabled={isCreating}
                />
              )}
              {optionDraft.trim() && options.length < MAX_OPTIONS && (
                <button
                  type="button"
                  className="debate__mini-add"
                  onClick={addOption}
                  disabled={isCreating}
                  aria-label={t.addOption}
                  title={t.addOption}
                >
                  +
                </button>
              )}
              <span
                className={`debate__option-count ${options.length >= 2 ? 'debate__option-count--ok' : ''}`}
                title={t.optionsHint}
              >
                {options.length}/{MAX_OPTIONS}
              </span>
            </div>
          )}
        </div>

        {error && (
          <div className="debate__error-block">
            <p className="debate__error" role="alert">
              {error}
            </p>
            {!isLoading && participants.length === 0 && (
              <button type="button" className="debate__retry" onClick={loadData}>
                {t.retry}
              </button>
            )}
          </div>
        )}
      </main>
    </form>
  );
}

DebatePage.propTypes = {};