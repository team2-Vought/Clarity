import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useOutletContext } from 'react-router-dom';
import { HugeiconsIcon } from '@hugeicons/react';
import { PencilEdit02Icon } from '@hugeicons/core-free-icons';
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
  ChevronIcon,
  CloseIcon,
  PlusIcon,
  UserPlusIcon,
} from '../components/DebateIcons';
import ModelPicker from '../components/ModelPicker';
import PanelToggle from '../components/PanelToggle';
import { uk } from '../copy/uk';
import { ROLE_ORDER, TRAITS, TRAIT_COLORS } from '../utils/debateOptions';
import { DEBATE_TEMPLATES } from '../utils/debateTemplates';
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
const MAX_STYLE = 300;
const MAX_NAME = 64;
const MAX_TRAIT = 40;
const DEFAULT_TEMPERATURE = 0.7;
// орієнтовна тривалість одного послідовного кроку (виклик моделі + показ)
const SECONDS_PER_STEP = 12;
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
      style: item.style || '',
      temperature: item.temperature ?? DEFAULT_TEMPERATURE,
    }));

const customTraitsOf = (list) => [
  ...new Set(list.flatMap((p) => p.traits).filter((trait) => !TRAITS.includes(trait))),
];

// Ім'я «Учасник N» сервер дає сам, тож у збереженому складі воно зайве:
// інакше після перестановки учасників номер не збігався б з позицією
const isDefaultName = (name) => /^Учасник \d+$/.test(name || '');

const MODES = [
  { value: 'yes_no', label: t.modeYesNo },
  { value: 'choose_one', label: t.modeChooseOne },
  { value: 'open', label: t.modeOpen },
];

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
  const [renamingSlug, setRenamingSlug] = useState(null);
  const [nameDraft, setNameDraft] = useState('');
  const [scrollState, setScrollState] = useState({ overflow: false, left: false, right: false });
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
  const participantListRef = useRef(null);
  const advancedRef = useRef(null);
  const cancelRenameRef = useRef(false);
  const formRef = useRef(null);
  const questionRef = useRef(null);
  const activeParticipant =
    participants.find((p) => p.slug === activeSlug) || participants[0];
  const activeTraits = activeParticipant?.traits || [];
  const activeStyle = activeParticipant?.style || '';
  const activeTemperature = activeParticipant?.temperature ?? DEFAULT_TEMPERATURE;
  const activeRole = personas.find((p) => p.slug === activeParticipant?.slug);
  const hasAvailableModels = models.some((m) => m.available);
  const allParticipantsHaveModels =
    participants.length > 0
    && participants.every((p) => models.some((m) => m.id === p.model && m.available));
  const activeIndex = Math.max(0, participants.indexOf(activeParticipant));
  const activeLabel = activeParticipant?.name || `${t.participant} ${activeIndex + 1}`;
  const customizedCount = participants.filter(
    (p) => p.style.trim() || p.temperature !== DEFAULT_TEMPERATURE
  ).length;
  const advancedSummary = [
    rounds !== DEFAULT_ROUNDS ? t.advancedRounds(rounds) : '',
    webSearch ? t.webSearchOn : '',
    moderatorModel || devilModel ? t.judgesCustomized : '',
    customizedCount ? t.advancedCustomized(customizedCount) : '',
  ]
    .filter(Boolean)
    .join(' · ');
  // Скільки AI-відповідей і часу займе дискусія — до старту, щоб не було сюрпризів з лімітом
  const estimate = (() => {
    const count = participants.length;
    if (count < MIN_PARTICIPANTS) return '';
    const research = webSearch ? 1 : 0;
    const replies = research + count + rounds * count + 2 + count + 1;
    // вступ і відповіді на критику йдуть паралельно, решта кроків — по черзі
    const sequential = research + 1 + rounds * count + 4;
    return t.estimate(replies, Math.max(1, Math.round((sequential * SECONDS_PER_STEP) / 60)));
  })();
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
          style: '',
          temperature: DEFAULT_TEMPERATURE,
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
      // Wikipedia без ключа дає лише енциклопедичні факти — вмикаємо за бажанням.
      const templateSearch = template?.webSearch;
      setWebSearch(Boolean(search.available && (templateSearch ?? !search.limited)));
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
    if (!isPanelOpen) return undefined;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !isAdvancedOpen) setIsPanelOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isPanelOpen, isAdvancedOpen]);

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

  const scrollParticipants = (direction) => {
    const el = participantListRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * 108, behavior: 'smooth' });
  };

  const handleParticipantClick = (participant) => {
    if (participant.slug === activeParticipant?.slug) {
      setNameDraft(participant.name || '');
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
  };

  // Роль (архетип) учасника: визначає базовий спосіб мислення.
  const handleRoleSelect = (slug) => {
    if (!activeParticipant || slug === activeParticipant.slug) return;
    if (participants.some((p) => p.slug === slug)) return;
    const previous = activeParticipant.slug;
    setParticipants((prev) => prev.map((p) => (p.slug === previous ? { ...p, slug } : p)));
    setActiveSlug(slug);
    setRenamingSlug(null);
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
    setRenamingSlug(null);
  };

  const toggleAdvanced = () => setIsAdvancedOpen((open) => !open);

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

  const updateStyle = (value) => {
    updateActiveParticipant((p) => ({ ...p, style: value }));
  };

  const updateTemperature = (value) => {
    updateActiveParticipant((p) => ({ ...p, temperature: Number(value) }));
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
        style: '',
        temperature: DEFAULT_TEMPERATURE,
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
    addTrait();
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

  // Шаблон: заготовка питання з [полями], формат, ролі й параметри.
  // Перше [поле] одразу виділяється, щоб його можна було просто перепечатати.
  const applyTemplate = (template) => {
    const question = t.templates[template.id].question;
    setDescription(question);
    saveDraft(question);
    handleModeChange(template.mode);
    setRounds(Math.min(template.rounds, maxRounds));
    setWebSearch(Boolean(searchStatus.available && template.webSearch));
    const next = toParticipants(template.roles, participantContext());
    if (next.length >= MIN_PARTICIPANTS) replaceParticipants(next);
    setError('');
    setTimeout(() => {
      const el = questionRef.current;
      if (!el) return;
      el.focus();
      const start = question.indexOf('[');
      if (start >= 0) el.setSelectionRange(start, question.indexOf(']', start) + 1);
    }, 0);
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
      name: p.name || undefined,
      model: p.model,
      style: p.style || undefined,
      temperature: p.temperature,
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
      <div className="debate__form-panel" id="debate-settings">
        <section className="debate__section">
          <h2 className="debate__section-title">{t.teams}</h2>
          {teams.length > 0 && (
            <div className="debate__option-list">
              {teams.map((team) => (
                <span key={team.id} className="debate__option-chip">
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
                    className="debate__option-remove"
                    onClick={() => removeTeam(team)}
                    aria-label={t.deleteTeam(team.name)}
                    title={t.deleteTeam(team.name)}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          {isTeamFormOpen ? (
            <div className="debate__card debate__option-input">
              <input
                className="debate__card-input"
                type="text"
                value={teamName}
                maxLength={MAX_NAME}
                onChange={(e) => setTeamName(e.target.value)}
                onKeyDown={handleTeamKeyDown}
                placeholder={t.teamNamePlaceholder}
                aria-label={t.teamName}
                autoFocus
              />
              <button
                type="button"
                className="debate__mini-add"
                onClick={saveCurrentTeam}
                disabled={!teamName.trim() || isSavingTeam}
                aria-label={t.saveTeam}
                title={t.saveTeam}
              >
                ✓
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="debate__link-button"
              onClick={() => setIsTeamFormOpen(true)}
              disabled={isCreating || participants.length < MIN_PARTICIPANTS}
            >
              {t.saveCurrentTeam}
            </button>
          )}
          {teams.length === 0 && !isTeamFormOpen && <p className="debate__hint">{t.teamsHint}</p>}
        </section>

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
                const label = p.name || t.participantN(i + 1);
                const roleName = personas.find((persona) => persona.slug === p.slug)?.name || '';
                const modelName = shortModel(models.find((m) => m.id === p.model));
                const canRemove = participants.length > MIN_PARTICIPANTS && !isCreating;
                if (renamingSlug === p.slug) {
                  return (
                    <div key={p.slug} className="debate__participant-item">
                      <div
                        className="debate__card debate__participant debate__participant--active debate__participant--renaming"
                        style={{ '--chip': p.color }}
                      >
                        <UserPlusIcon />
                        <input
                          className="debate__participant-input"
                          type="text"
                          value={nameDraft}
                          maxLength={MAX_NAME}
                          onChange={(e) => setNameDraft(e.target.value)}
                          onBlur={handleRenameBlur}
                          onKeyDown={handleRenameKeyDown}
                          aria-label={`${t.renameParticipant} ${i + 1}`}
                          placeholder={t.participantN(i + 1)}
                          autoFocus
                        />
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={p.slug} className="debate__participant-item">
                    <button
                      type="button"
                      className={`debate__card debate__participant ${active ? 'debate__participant--active' : ''}`}
                      style={{ '--chip': p.color }}
                      data-active={active ? 'true' : undefined}
                      aria-label={active ? t.renameParticipantNamed(label) : t.selectParticipant(label)}
                      title={active ? t.renameHint : undefined}
                      aria-pressed={active}
                      onClick={() => handleParticipantClick(p)}
                    >
                      {active ? (
                        <HugeiconsIcon icon={PencilEdit02Icon} size={20} aria-hidden="true" />
                      ) : (
                        <UserPlusIcon />
                      )}
                      <span className="debate__participant-label">{label}</span>
                      <span className="debate__participant-meta">
                        {[roleName, modelName].filter(Boolean).join(' · ')}
                      </span>
                    </button>
                    {canRemove && (
                      <button
                        type="button"
                        className="debate__participant-remove"
                        onClick={() => handleRemoveParticipant(p.slug)}
                        aria-label={t.removeParticipant(label)}
                        title={t.removeParticipant(label)}
                      >
                        <CloseIcon />
                      </button>
                    )}
                  </div>
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
          <h2 className="debate__section-title">{t.role}</h2>
          <div className="debate__trait-list" role="group" aria-label={t.role}>
            {personas.map((persona) => {
              const active = persona.slug === activeParticipant?.slug;
              const taken = !active && participants.some((p) => p.slug === persona.slug);
              return (
                <button
                  key={persona.slug}
                  type="button"
                  className={`debate__trait-chip ${active ? 'debate__trait-chip--active' : ''}`}
                  style={{ '--chip': activeParticipant?.color }}
                  aria-pressed={active}
                  disabled={isCreating || taken}
                  title={taken ? t.roleTaken : persona.description}
                  onClick={() => handleRoleSelect(persona.slug)}
                >
                  <span>{persona.name}</span>
                </button>
              );
            })}
          </div>
          {activeRole && <p className="debate__hint">{activeRole.description}</p>}
        </section>

        <section className="debate__section">
          <h2 className="debate__section-title">{t.aiModel}</h2>
          <ModelPicker
            models={models}
            value={activeParticipant?.model || ''}
            onChange={handleModelSelect}
            disabled={isCreating || !activeParticipant}
          />
          {models.length > 0 && !hasAvailableModels && (
            <p className="debate__hint">{t.noModelsAvailable}</p>
          )}
        </section>

        <section className="debate__section">
          <h2 className="debate__section-title">{t.character}</h2>
          <div className="debate__card debate__trait-input">
            <UserPlusIcon />
            <input
              className="debate__card-input"
              type="text"
              value={traitDraft}
              maxLength={MAX_TRAIT}
              onChange={(e) => setTraitDraft(e.target.value)}
              onKeyDown={handleTraitKeyDown}
              placeholder={t.placeholderTrait}
              aria-label={t.customTrait}
              disabled={isCreating}
            />
            <button
              type="button"
              className="debate__mini-add"
              onClick={addTrait}
              disabled={isCreating || !traitDraft.trim()}
              aria-label={t.addTrait}
              title={t.addTrait}
            >
              +
            </button>
          </div>
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
                  disabled={isCreating}
                >
                  <span>{trait}</span>
                </button>
              );
            })}
          </div>
        </section>

        {isLoading && (
          <p className="debate__hint" role="status">{t.loading}</p>
        )}
        <section className="debate__advanced" ref={advancedRef}>
          <button
            type="button"
            className={`debate__advanced-toggle ${isAdvancedOpen ? 'debate__advanced-toggle--open' : ''}`}
            onClick={toggleAdvanced}
            aria-expanded={isAdvancedOpen}
            aria-haspopup="dialog"
            aria-controls="debate-advanced"
          >
            <span className="debate__advanced-heading">
              <span className="debate__section-title">{t.advanced}</span>
              {advancedSummary && (
                <span className="debate__advanced-summary">{advancedSummary}</span>
              )}
            </span>
            <span className="debate__model-chevron">
              <ChevronIcon />
            </span>
          </button>
          <div
            id="debate-advanced"
            className={`debate__advanced-body ${isAdvancedOpen ? 'debate__advanced-body--open' : ''}`}
            inert={!isAdvancedOpen}
            aria-hidden={!isAdvancedOpen}
            role="dialog"
            aria-label={t.advanced}
          >
            <h3 className="debate__advanced-group">{t.advancedGeneral}</h3>
            <span className="debate__field-label">{t.rounds}</span>
            <label className="debate__range-card">
              <input
                type="range"
                min="1"
                max={maxRounds}
                step="1"
                value={rounds}
                onChange={(e) => setRounds(Number(e.target.value))}
                disabled={isCreating}
                aria-label={t.rounds}
              />
              <span className="debate__range-value">{rounds}</span>
            </label>
            <p className="debate__hint">{t.roundsHint}</p>

            <span className="debate__field-label">{t.webSearch}</span>
            <label className={`debate__switch ${searchStatus.available ? '' : 'debate__switch--disabled'}`}>
              <input
                type="checkbox"
                checked={webSearch}
                onChange={(e) => setWebSearch(e.target.checked)}
                disabled={isCreating || !searchStatus.available}
              />
              <span>
                {searchStatus.available
                  ? t.webSearchLabel(searchStatus.provider)
                  : t.webSearchUnavailable}
              </span>
            </label>
            <p className="debate__hint">
              {searchStatus.limited ? t.webSearchLimitedHint : t.webSearchHint}
            </p>

            <span className="debate__field-label">{t.moderatorModel}</span>
            <ModelPicker
              models={models}
              value={moderatorModel}
              onChange={setModeratorModel}
              disabled={isCreating}
              label={t.moderatorModel}
              autoLabel={t.autoModel}
              compact
            />
            <span className="debate__field-label">{t.devilModel}</span>
            <ModelPicker
              models={models}
              value={devilModel}
              onChange={setDevilModel}
              disabled={isCreating}
              label={t.devilModel}
              autoLabel={t.autoModel}
              compact
            />
            <p className="debate__hint">{t.judgesHint}</p>

            <h3 className="debate__advanced-group">
              {t.advancedParticipant(activeLabel)}
            </h3>
            <label className="debate__card debate__style-card">
              <span className="debate__field-label">{t.style}</span>
              <input
                className="debate__card-input"
                type="text"
                value={activeStyle}
                maxLength={MAX_STYLE}
                onChange={(e) => updateStyle(e.target.value)}
                placeholder={t.placeholderStyle}
                disabled={isCreating}
              />
            </label>
            <label className="debate__range-card">
              <span className="debate__field-label">{t.temperature}</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={activeTemperature}
                onChange={(e) => updateTemperature(e.target.value)}
                disabled={isCreating}
                aria-label={t.temperature}
              />
              <span className="debate__range-value">{Number(activeTemperature).toFixed(1)}</span>
            </label>
            <p className="debate__hint">{t.temperatureHint}</p>
          </div>
        </section>

      </div>

      <main className="debate__main">
        <div className="debate__hero">
          <h1 className="debate__title">{TITLE}</h1>
          <div className="debate__underline" />
        </div>

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

        {!description.trim() && !isLoading && personas.length > 0 && (
          <div className="debate__templates" role="group" aria-label={t.templatesLabel}>
            <span className="debate__templates-label">{t.templatesLabel}</span>
            {DEBATE_TEMPLATES.map((template) => (
              <button
                key={template.id}
                type="button"
                className="debate__template-chip"
                onClick={() => applyTemplate(template)}
                disabled={isCreating}
              >
                {t.templates[template.id].label}
              </button>
            ))}
          </div>
        )}

        <div className="debate__mode-bar">
          <div className="debate__mode-list debate__mode-list--main" role="group" aria-label={t.mode}>
            {MODES.map((item) => (
              <button
                key={item.value}
                type="button"
                className={`debate__mode-chip ${mode === item.value ? 'debate__mode-chip--active' : ''}`}
                aria-pressed={mode === item.value}
                onClick={() => handleModeChange(item.value)}
                disabled={isCreating}
              >
                {item.label}
              </button>
            ))}
          </div>
          {mode === 'choose_one' && (
            <div className="debate__options">
              <div className="debate__option-list">
                {options.map((option) => (
                  <span key={option} className="debate__option-chip">
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
              </div>
              <div className="debate__card debate__option-input">
                <input
                  className="debate__card-input"
                  type="text"
                  value={optionDraft}
                  maxLength={100}
                  onChange={(e) => setOptionDraft(e.target.value)}
                  onKeyDown={handleOptionKeyDown}
                  placeholder={t.optionPlaceholder}
                  aria-label={t.options}
                  disabled={isCreating || options.length >= 8}
                />
                <button
                  type="button"
                  className="debate__mini-add"
                  onClick={addOption}
                  disabled={isCreating || !optionDraft.trim() || options.length >= 8}
                  aria-label={t.addOption}
                  title={t.addOption}
                >
                  +
                </button>
              </div>
              <p className="debate__hint">{t.optionsHint}</p>
            </div>
          )}
          {estimate && <p className="debate__estimate">{estimate}</p>}
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