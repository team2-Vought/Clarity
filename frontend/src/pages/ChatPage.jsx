import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  ArrowDown02Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Attachment01Icon,
  Copy01Icon,
  FlashIcon,
  GlobalSearchIcon,
  IdentityCardIcon,
  Link01Icon,
  PencilEdit02Icon,
} from '@hugeicons/core-free-icons';
import {
  fetchDiscussion,
  fetchModels,
  fetchPersonas,
  postNote,
  answerClarify,
  runDiscussion,
  shareDiscussion,
  finishDiscussion,
  stopDiscussion,
  unshareDiscussion,
  updateDiscussion,
} from '../api/discussions';
import { useIsPhone } from '../hooks/useIsPhone';
import { useMyProfile } from '../hooks/useMyProfile';
import { useToasts } from '../hooks/useToasts';
import { FILE_TYPES, MAX_FILES, useAttachmentDraft } from '../hooks/useAttachmentDraft';
import {
  ArrowUpIcon,
  AvatarIcon,
  StopIcon,
} from '../components/DebateIcons';
import ModePicker from '../components/ModePicker';
import ModelPicker from '../components/ModelPicker';
import PanelToggle from '../components/PanelToggle';
import ThoughtLine from '../components/ThoughtLine';
import MessageMarkdown from '../components/MessageMarkdown';
import ClarifyCard from '../components/ClarifyCard';
import ErrorNotice from '../components/ErrorNotice';
import { discussionErrorKind, requestErrorKind } from '../utils/errorKind';
import { answerOf } from '../utils/clarify';
import { copy } from '../copy';
import { TRAIT_COLORS, roleIcon } from '../utils/debateOptions';
import { parseBlocks, plainText } from '../utils/markdown';
import { describeSummary } from '../utils/summary';
import {
  USER_COLOR,
  buildSpeakers,
  duplicateFinalId,
  phaseLabel,
  speakerKeyOf,
} from '../utils/chatView';
import { discussionMarkdown, downloadText, markdownFileName } from '../utils/exportMarkdown';
import {
  awaitsClarify,
  doneStep,
  draftMessagesOf,
  isIdle,
  lastSeqOf,
  mergeMessages,
  snippetOf,
  thinkingStep,
} from '../utils/chatMessages';
import ChatMessage from '../components/chat/ChatMessage';
import ChatSummary from '../components/chat/ChatSummary';
import NotifyOffer from '../components/chat/NotifyOffer';
import AttachmentChip from '../components/AttachmentChip';
import AttachmentCard from '../components/AttachmentCard';
import { CrisisHelp, TopicNotice } from '../components/SafetyNotice';
import { useRunAlerts } from '../hooks/useRunAlerts';
import { STILL_GLYPH, THINKING_GLYPH } from '../components/chat/thoughtGlyphs';
import { isSendShortcut } from '../utils/devicePrefs';

const t = copy.chat;
const d = copy.debate;

// помилка дії — текст і вид картки; мережеву пояснюємо своїми словами
function actionFailure(err, fallback) {
  const kind = requestErrorKind(err);
  return { kind, text: kind === 'network' ? copy.errors.network : err?.message || fallback };
}


// Чи вміщається текст підказки в поле цілим. Без вимірювань (тести, ще не
// змонтоване поле) вважаємо, що ні, — тоді береться коротший варіант.
let measureCtx;
const fitsField = ({ width, font }, text) => {
  if (!width || !font) return false;
  measureCtx ??= document.createElement('canvas').getContext?.('2d');
  if (!measureCtx) return false;
  measureCtx.font = font;
  return measureCtx.measureText(text).width <= width;
};

const STICK_THRESHOLD = 96;
const JUMP_THRESHOLD = 400;
// частка відстані до низу, яку чат проходить за кадр: великий стрибок висоти
// стає м'яким доїздом (~0,3 с), а рівний ріст тексту — майже без відставання
const FOLLOW_EASE = 0.16;
// скільки триває розгортання кроків чи джерел — стільки чат доганяє їхній низ
const REVEAL_MS = 600;
// відступ розгорнутого блока від поля вводу й від верху чату
const REVEAL_GAP = 16;

const prefersReducedMotion = () =>
  document.documentElement.dataset.motion === 'reduced'
  || Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
// Дискусію виконує сервер; сторінка лише опитує стан.
const POLL_MS = 2000;
// поки модель пише репліку, опитуємо частіше — текст росте майже наживо
const STREAM_POLL_MS = 700;
// Скільки разів поспіль можна «підштовхнути» раннер, якщо сервер його втратив
// (перезапуск процесу), перш ніж показати помилку.
const MAX_KICKS = 3;
const MAX_NOTE = 1000;
const COMPACT_KEY = 'clarity:chat-compact';


const readCompact = () => {
  try {
    return localStorage.getItem(COMPACT_KEY) === '1';
  } catch {
    return false;
  }
};


export default function ChatPage() {
  const { id } = useParams();
  const [discussion, setDiscussion] = useState(null);
  const [personas, setPersonas] = useState([]);
  const [models, setModels] = useState([]);
  const [defaultModel, setDefaultModel] = useState('');
  const [activeSlug, setActiveSlug] = useState('');
  const [actionError, setActionError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [note, setNote] = useState('');
  // меню біля поля вводу: файли до уточнення, швидка відповідь, пошук
  const {
    files: noteFiles,
    ids: noteFileIds,
    reading: noteFilesReading,
    addFiles: addNoteFiles,
    removeFile: removeNoteFile,
    clearFiles: clearNoteFiles,
  } = useAttachmentDraft();
  const [noteFileInput, setNoteFileInput] = useState(null);
  const [isNoteDragging, setIsNoteDragging] = useState(false);
  const [quickNext, setQuickNext] = useState(false);
  const [searchAvailable, setSearchAvailable] = useState(false);
  // кому адресоване питання після висновку: '' — усім, інакше slug учасника
  const [askTarget, setAskTarget] = useState('');
  const [isSending, setIsSending] = useState(false);
  // відповіді на уточнювальні питання модератора: { [id]: { option, custom } }
  const [clarifyAnswers, setClarifyAnswers] = useState({});
  const [isAnswering, setIsAnswering] = useState(false);
  // коли надіслано відповіді: час очікування на них не рахуємо як аналіз
  const [clarifiedAt, setClarifiedAt] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [pollTick, setPollTick] = useState(0);
  // на телефоні бічна панель — висувна, відкривається кнопкою «≡»
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const { panelCollapsed = false, registerPanelToggle, togglePanel } = useOutletContext() ?? {};
  const isPhone = useIsPhone();

  // на телефоні кнопка-перемикач у куті відкриває / закриває висувну панель
  useEffect(
    () => registerPanelToggle?.(() => setIsPanelOpen((open) => !open)),
    [registerPanelToggle]
  );
  // Скільки реплік уже повністю показано. Нові репліки «друкуються» по одній,
  // навіть якщо паралельний крок приніс кілька одразу.
  const [revealedCount, setRevealedCount] = useState(0);
  const [skipTyping, setSkipTyping] = useState(false);
  const discussionRef = useRef(null);
  // репліки, які людина вже бачила чернеткою, з'являються одразу, без повторного «друку»
  const [streamedIds, setStreamedIds] = useState(() => new Set());
  const kicksRef = useRef(0);
  const progressRef = useRef(0);
  const mainRef = useRef(null);
  const stickToBottomRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const touchYRef = useRef(0);
  // на телефоні поле згортається в круглу кнопку, поки людина гортає вниз
  const [isComposerMin, setIsComposerMin] = useState(false);
  const [noteBox, setNoteBox] = useState({ width: 0, font: '' });
  const swipeRef = useRef(0);
  const panelRef = useRef(null);
  const noteRef = useRef(null);
  const composerRef = useRef(null);
  const summaryRef = useRef(null);
  const [showJump, setShowJump] = useState(false);
  const [flashId, setFlashId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  // результат з'являється з анімацією лише тоді, коли дискусія йшла на очах
  const [animateSummary, setAnimateSummary] = useState(false);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const advancedRef = useRef(null);
  const [composerHeight, setComposerHeight] = useState(0);
  // «Лише тези»: AI-репліки стиснуті до головної думки, повний текст — за кліком
  const [compact, setCompact] = useState(readCompact);
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const navigate = useNavigate();
  const { pushToast } = useToasts();
  const myProfile = useMyProfile();
  // як у профілі: фото, а без нього — перша літера імені; іконка — поки профіль не завантажився
  const myInitial = myProfile.name.trim().charAt(0).toUpperCase();
  const userAvatar = myProfile.avatar ? (
    <img className="chat__avatar-photo" src={myProfile.avatar} alt="" />
  ) : myInitial ? (
    <span className="chat__avatar-letter">{myInitial}</span>
  ) : (
    <AvatarIcon />
  );
  const [isSharing, setIsSharing] = useState(false);

  const applyState = useCallback((data, { replaceMessages = false } = {}) => {
    if (!data) return;
    const drafted = new Set(
      (discussionRef.current?.live?.drafts || []).map((draft) => draft.slug)
    );
    const streamed = (data.messages || []).filter(
      (message) => message.role === 'ai' && drafted.has(message.persona_slug)
    );
    if (streamed.length) {
      setStreamedIds((ids) => new Set([...ids, ...streamed.map((message) => message.id)]));
    }
    setDiscussion((previous) => {
      if (!previous || replaceMessages) return data;
      return {
        ...previous,
        ...data,
        messages: mergeMessages(previous.messages, data.messages),
      };
    });
  }, []);

  const startRunner = useCallback(
    async (discussionId) => {
      try {
        const state = await runDiscussion(discussionId);
        applyState(state);
        setActionError('');
      } catch (err) {
        setActionError(actionFailure(err, t.errorAdvance));
      }
    },
    [applyState]
  );

  const loadDiscussion = useCallback(async () => {
    try {
      const [data, personaData, modelData] = await Promise.all([
        fetchDiscussion(id),
        fetchPersonas().catch(() => null),
        fetchModels().catch(() => null),
      ]);
      setDiscussion(data);
      // те, що вже було в дискусії до відкриття сторінки, не анімуємо
      // (мінус перше повідомлення — саме запитання, воно в заголовку)
      setRevealedCount(Math.max(0, (data.messages || []).length - 1));
      setActiveSlug(data.personas?.[0]?.slug || '');
      if (personaData?.personas) setPersonas(personaData.personas);
      setSearchAvailable(Boolean(personaData?.search?.available));
      if (modelData?.models) {
        setModels(modelData.models);
        setDefaultModel(
          modelData.default_model
            || modelData.models.find((model) => model.available)?.id
            || ''
        );
      }
      setActionError('');
      setLoadError('');
      kicksRef.current = 0;
      progressRef.current = lastSeqOf(data);
      if (isIdle(data)) startRunner(data.id);
    } catch (err) {
      setLoadError(actionFailure(err, t.loadError));
    }
  }, [id, startRunner]);

  useEffect(() => {
    const timer = setTimeout(loadDiscussion, 0);
    return () => clearTimeout(timer);
  }, [loadDiscussion]);

  const isFinished = discussion ? discussion.phase === 'done' || discussion.is_finished : false;
  const isRunning = Boolean(discussion?.is_running);
  const isFailed = discussion?.status === 'failed';
  const isStopped = Boolean(discussion?.stop_requested);
  const isAwaitingClarify = awaitsClarify(discussion);
  // Опитуємо, доки сервер працює або має працювати (раннер ще стартує).
  // Поки модератор чекає відповідей на уточнення, раннер стоїть навмисно.
  const shouldPoll = Boolean(discussion)
    && (isRunning || (!isFinished && !isFailed && !isStopped && !isAwaitingClarify));
  const discussionId = discussion?.id;

  useEffect(() => {
    discussionRef.current = discussion;
  });

  useEffect(() => {
    if (!discussionId || !shouldPoll) return undefined;
    const controller = new AbortController();
    const delay = discussionRef.current?.live?.drafts?.length ? STREAM_POLL_MS : POLL_MS;
    const timer = setTimeout(async () => {
      try {
        const known = lastSeqOf(discussionRef.current);
        const data = await fetchDiscussion(discussionId, {
          after: known,
          signal: controller.signal,
        });
        applyState(data);
        const seq = Math.max(known, ...(data.messages || []).map((m) => m.seq));
        if (seq > progressRef.current) {
          progressRef.current = seq;
          kicksRef.current = 0;
        }
        // Сервер втратив раннер (перезапуск) — підштовхуємо, але не нескінченно.
        if (isIdle(data)) {
          if (kicksRef.current < MAX_KICKS) {
            kicksRef.current += 1;
            await startRunner(discussionId);
          } else {
            setActionError({ kind: 'stopped', text: t.stopped });
          }
        }
      } catch (err) {
        if (err?.name !== 'AbortError') setActionError(actionFailure(err, t.errorAdvance));
      } finally {
        if (!controller.signal.aborted) setPollTick((tick) => tick + 1);
      }
    }, delay);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [discussionId, shouldPoll, pollTick, applyState, startRunner]);

  // людина пішла з вкладки, поки AI думали, — кличемо назад, коли вони закінчать
  const alertBadge = useRunAlerts(discussion);

  useEffect(() => {
    if (!discussion?.title) return undefined;
    const previous = document.title;
    const badge = alertBadge ? `${alertBadge} ` : '';
    document.title = `${badge}${discussion.title} · ${copy.appName}`;
    return () => {
      document.title = previous;
    };
  }, [discussion?.title, alertBadge]);

  const messages = discussion?.messages;
  const questionMessage = useMemo(
    () => (messages || []).find((message) => message.role === 'user'),
    [messages]
  );
  const summary = discussion?.final_summary || null;
  const summaryView = describeSummary(summary);
  const { decision: summaryDecision } = summaryView;
  // картка підсумку видна — фінальну репліку модератора, що її дублює, ховаємо
  const hiddenFinalId = duplicateFinalId(messages || [], Boolean(summaryDecision) && isFinished);
  const visibleMessages = useMemo(
    () =>
      (messages || []).filter(
        (message) => message !== questionMessage && message.id !== hiddenFinalId
      ),
    [messages, questionMessage, hiddenFinalId]
  );

  // поля дискусії — окремими змінними, щоб React Compiler бачив ті самі залежності, що й useMemo
  const discussionSources = discussion?.sources;
  const discussionPersonas = discussion?.personas;

  const sourcesById = useMemo(
    () => new Map((discussionSources || []).map((source) => [source.id, source])),
    [discussionSources]
  );

  const personaInfo = useMemo(
    () => new Map(personas.map((persona) => [persona.slug, persona])),
    [personas]
  );

  const customNames = useMemo(() => {
    const map = new Map();
    (discussionPersonas || []).forEach((persona) => {
      if (persona.name) map.set(persona.slug, persona.name);
    });
    return map;
  }, [discussionPersonas]);

  const participantEntries = useMemo(
    () =>
      (discussionPersonas || []).map((persona, index) => ({
        key: persona.slug || `participant-${index}`,
        label:
          persona.name
          || personaInfo.get(persona.slug)?.name
          || t.fallbackParticipant(index + 1),
        role: personaInfo.get(persona.slug)?.name || persona.custom?.name || '',
        model: persona.model || defaultModel || '',
        traits: Array.isArray(persona.traits) ? persona.traits : [],
        color: TRAIT_COLORS[index % TRAIT_COLORS.length],
      })),
    [discussionPersonas, defaultModel, personaInfo]
  );

  const participantColors = useMemo(
    () => new Map(participantEntries.map((participant) => [participant.key, participant.color])),
    [participantEntries]
  );

  const activeParticipant =
    participantEntries.find((participant) => participant.key === activeSlug)
    || participantEntries[0];
  const activeTraits = activeParticipant?.traits || [];

  const participantNames = useMemo(
    () => participantEntries.map((participant) => participant.label),
    [participantEntries]
  );

  // Запуски аналізу: питання чи уточнення користувача й усі репліки AI після нього
  const runs = useMemo(() => {
    const list = [];
    (messages || []).forEach((message) => {
      if (message.role === 'user') list.push({ start: message, items: [] });
      else if (list.length > 0) list[list.length - 1].items.push(message);
    });
    return list;
  }, [messages]);
  const currentRun = runs[runs.length - 1];

  // Кроки індикатора «Аналізуємо…» — лише цього запуску: зроблені репліки
  // й те, над чим AI думають зараз
  const thinking = discussion?.thinking;
  const traceSteps = useMemo(
    () => [...(currentRun?.items || []).map(doneStep), ...(thinking || []).map(thinkingStep)],
    [currentRun, thinking]
  );
  const runStartedAt =
    Math.max(Date.parse(currentRun?.start.created_at) || 0, clarifiedAt) || undefined;
  const pendingMessage =
    revealedCount < visibleMessages.length ? visibleMessages[revealedCount] : null;
  const typingMessage = pendingMessage && pendingMessage.role !== 'user' ? pendingMessage : null;
  const isRevealing = Boolean(typingMessage);
  const shownMessages = visibleMessages.slice(0, revealedCount + 1);
  // чернетки — після всіх показаних реплік; поки щось «друкується», вони чекають
  const draftMessages = useMemo(
    () => (isRevealing || !isRunning ? [] : draftMessagesOf(discussion)),
    [discussion, isRevealing, isRunning]
  );
  const renderedMessages = draftMessages.length
    ? [...shownMessages, ...draftMessages]
    : shownMessages;
  // «Зупинити» показує вже отримані репліки цілком, не чекаючи, доки вони допишуться
  const revealAll = () => {
    setRevealedCount(visibleMessages.length);
    setSkipTyping(false);
  };
  // остання повністю показана репліка — її коротко озвучує aria-live
  const lastShown = visibleMessages[Math.min(revealedCount, visibleMessages.length) - 1];
  const liveText =
    lastShown && lastShown.role !== 'user'
      ? `${lastShown.persona_name}: ${lastShown.thesis || snippetOf(lastShown.content)}`
      : '';
  // поки репліка друкується, індикатор «Аналізуємо…» лише відволікав би
  // після завершення рядок «Готово» не потрібен — підсумок говорить сам за себе
  // поки модератор чекає відповідей, секундомір не йде — працює людина, а не AI
  const showThoughtLine = participantNames.length > 0 && !isRevealing && isRunning && !isFinished
    && !isAwaitingClarify;
  // що саме зараз роблять AI: пошук → рядок, який написала модель → етап,
  // поки модель ще не встигла описати крок
  const live = discussion?.live;
  const thoughtLabel = live?.search
    ? t.searching(live.search)
    : live?.status || t.phaseStatus[discussion?.phase] || t.advancing;

  // Завершені запуски лишають у чаті згорнутий рядок «Аналізовано за …» після
  // своєї останньої репліки — розгорнувши його, видно, що саме аналізували.
  // Тривалість — за часом сервера: від питання чи уточнення до останньої репліки.
  const isCrisis = discussion?.safety === 'crisis';
  const runRecords = useMemo(() => {
    const records = new Map();
    // у кризі ніхто нічого не аналізував — рядок «Аналізовано за …» був би недоречний
    if (isCrisis) return records;
    const lastSettled = !isRunning && (isFinished || isFailed || isStopped);
    runs.forEach((run, index) => {
      const last = run.items[run.items.length - 1];
      if (!last || (index === runs.length - 1 && !lastSettled)) return;
      // рядок стоїть після останньої видимої репліки запуску (фінальну могли сховати)
      const anchor = run.items.findLast((item) => item.id !== hiddenFinalId);
      const seconds = (Date.parse(last.created_at) - Date.parse(run.start.created_at)) / 1000;
      if (!anchor) return;
      records.set(anchor.id, {
        steps: run.items.map(doneStep),
        seconds: Number.isFinite(seconds) ? Math.max(0, seconds) : 0,
      });
    });
    return records;
  }, [runs, isRunning, isFinished, isFailed, isStopped, hiddenFinalId, isCrisis]);

  // уточнення користувача показуємо одразу, без «друку»
  useEffect(() => {
    if (pendingMessage?.role !== 'user') return undefined;
    const timer = setTimeout(() => setRevealedCount((count) => count + 1), 0);
    return () => clearTimeout(timer);
  }, [pendingMessage]);

  // Поле вводу закріплене поверх чату, тож список отримує нижній відступ
  // рівно на висоту поля — останні репліки не ховаються під ним.
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return undefined;
    const update = () => setComposerHeight(el.offsetHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [discussion?.id]);

  // ширина поля — щоб обрати підказку, яка в нього вміщається
  useEffect(() => {
    const el = noteRef.current;
    if (!el) return undefined;
    const update = () => {
      const next = { width: el.clientWidth, font: getComputedStyle(el).font };
      // поле росте й у висоту — тоді ширина та сама, і перерендер не потрібен
      setNoteBox((prev) => (prev.width === next.width && prev.font === next.font ? prev : next));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    // запасний шлях: шрифт і ширина міняються й разом із вікном
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [discussion?.id]);

  // Поле уточнення росте разом із текстом; після max-height з'являється скрол.
  useLayoutEffect(() => {
    const el = noteRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [note, isFinished]);

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

  useEffect(() => {
    if (!isPanelOpen) return undefined;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !isAdvancedOpen) setIsPanelOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isPanelOpen, isAdvancedOpen]);

  // Низ чату — це справжній кінець прокрутки, разом із відступом під полем
  // вводу. scrollIntoView до останнього елемента зупинявся вище за нього й
  // смикав чат угору щоразу, коли користувач догортав донизу.
  const scrollToBottom = useCallback(() => {
    const el = mainRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  // Плавне доганяння низу: щокадру чат проходить частку відстані, що лишилась,
  // тож нова репліка, абзац чи рядок «Аналізуємо…» з'являються без ривка.
  // Зупиняється, щойно дійшов донизу або користувач відгорнув угору.
  const followFrameRef = useRef(0);
  const followBottom = useCallback(() => {
    if (followFrameRef.current) return;
    const step = () => {
      const el = mainRef.current;
      const distance = el ? el.scrollHeight - el.clientHeight - el.scrollTop : 0;
      if (!el || !stickToBottomRef.current || distance <= 1) {
        followFrameRef.current = 0;
        return;
      }
      el.scrollTop += prefersReducedMotion()
        ? distance
        : Math.max(1, Math.ceil(distance * FOLLOW_EASE));
      followFrameRef.current = requestAnimationFrame(step);
    };
    followFrameRef.current = requestAnimationFrame(step);
  }, []);

  // скидаємо й сам ref: інакше followBottom вважав би доганяння запущеним і більше не стартував
  useEffect(
    () => () => {
      cancelAnimationFrame(followFrameRef.current);
      followFrameRef.current = 0;
    },
    []
  );

  // Розгорнуті кроки «Аналізуємо…» чи джерела плавно доїжджають у поле зору:
  // чат гортає донизу, поки низ блока не стане над полем вводу. Блок росте
  // анімовано, тож відстань перераховується щокадру до кінця розгортання.
  // Верх блока не ховаємо — довгий список лишається видно з початку.
  const revealFrameRef = useRef(0);
  const revealOpened = useCallback((block) => {
    cancelAnimationFrame(revealFrameRef.current);
    // згортання, перерване новим розгортанням, не лишає запасу знизу
    mainRef.current?.style.removeProperty('--reveal-hold');
    const until = performance.now() + REVEAL_MS;
    const step = () => {
      const el = mainRef.current;
      if (!el || !block.isConnected) return;
      const box = el.getBoundingClientRect();
      const rect = block.getBoundingClientRect();
      const below = rect.bottom - (box.bottom - composerHeight - REVEAL_GAP);
      const distance = Math.min(below, rect.top - box.top - REVEAL_GAP);
      const before = el.scrollTop;
      if (distance > 1) {
        el.scrollTop += prefersReducedMotion() ? distance : Math.max(1, Math.ceil(distance * FOLLOW_EASE));
      }
      // після розгортання доганяємо, лише поки чат ще має куди гортати
      if (performance.now() < until || (distance > 1 && el.scrollTop !== before)) {
        revealFrameRef.current = requestAnimationFrame(step);
      }
    };
    revealFrameRef.current = requestAnimationFrame(step);
  }, [composerHeight]);

  // Згортання — дзеркально: чат плавно піднімається туди, де опиниться після
  // згортання, замість стрибка, коли вміст раптом стає коротшим. Поки чат
  // їде вгору, знизу тримаємо запас висоти (--reveal-hold), і він тане рівно
  // настільки, наскільки чат уже піднявся.
  const settleClosed = useCallback((lost) => {
    const el = mainRef.current;
    if (!el || lost <= 0) return;
    cancelAnimationFrame(revealFrameRef.current);
    const start = el.scrollTop;
    const target = Math.max(0, Math.min(start, el.scrollHeight - lost - el.clientHeight));
    if (target >= start) return;
    el.style.setProperty('--reveal-hold', `${lost}px`);
    const step = () => {
      const distance = el.scrollTop - target;
      if (distance > 1 && !prefersReducedMotion()) {
        el.scrollTop -= Math.max(1, Math.ceil(distance * FOLLOW_EASE));
      } else {
        el.scrollTop = target;
      }
      if (el.scrollTop > target) {
        el.style.setProperty('--reveal-hold', `${Math.max(0, lost - (start - el.scrollTop))}px`);
        revealFrameRef.current = requestAnimationFrame(step);
      } else {
        el.style.removeProperty('--reveal-hold');
      }
    };
    revealFrameRef.current = requestAnimationFrame(step);
  }, []);

  useEffect(() => () => cancelAnimationFrame(revealFrameRef.current), []);

  // Кроки «Аналізуємо…», джерела підсумку й джерела під реплікою (<details>).
  // Обробник спрацьовує до того, як React чи браузер змінять розмітку, тож
  // тут іще видно, розгорнутий блок чи ні, і яка в нього висота.
  const handleMainClick = (e) => {
    const toggle = e.target.closest?.(
      '.thought-line__head[data-toggle], .chat__sources-toggle, details.chat__sources > summary'
    );
    if (!toggle) return;
    let block;
    let open;
    let lost = 0;
    if (toggle.tagName === 'SUMMARY') {
      block = toggle.parentElement;
      open = block.open;
      if (open) lost = block.offsetHeight - toggle.offsetHeight;
    } else if (toggle.classList.contains('chat__sources-toggle')) {
      open = toggle.getAttribute('aria-expanded') === 'true';
      const id = toggle.getAttribute('aria-controls');
      if (open) lost = document.getElementById(id)?.offsetHeight || 0;
      block = id;
    } else {
      block = toggle.closest('.thought-line');
      open = toggle.getAttribute('aria-expanded') === 'true';
      if (open) lost = block.querySelector('.thought-line__trace')?.offsetHeight || 0;
    }
    if (open) {
      settleClosed(lost);
      return;
    }
    // розгортання з'явиться в наступному рендері — доганяємо його за кадр
    requestAnimationFrame(() => {
      const opened = typeof block === 'string' ? document.getElementById(block) : block;
      if (opened) revealOpened(opened);
    });
  };

  // Відкриваючи дискусію, одразу стаємо внизу — історію не прокручуємо на очах
  const openedAtBottomRef = useRef(null);

  const handleTypingDone = useCallback(() => {
    setRevealedCount((count) => count + 1);
    setSkipTyping(false);
  }, []);

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    if (discussionId && openedAtBottomRef.current !== discussionId) {
      openedAtBottomRef.current = discussionId;
      scrollToBottom();
      return;
    }
    followBottom();
  }, [scrollToBottom, followBottom, discussionId, revealedCount, isRunning, actionError, isStopped, isRevealing]);

  // Поки йде генерація, вміст росте плавно (поява абзаців, висота бульбашки),
  // тож низ відстежується щокадру, а не за окремими подіями.
  useEffect(() => {
    if (!isRunning && !isRevealing) return undefined;
    let frame = 0;
    const tick = () => {
      followBottom();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [isRunning, isRevealing, followBottom]);

  // Стрілка «до рішення» з'являється, коли рішення (а поки його немає —
  // кінець чату) опинилося нижче видимої частини, тобто користувач гортав угору.
  const updateJump = useCallback(() => {
    const el = mainRef.current;
    if (!el) return;
    const visibleBottom = el.getBoundingClientRect().bottom - composerHeight;
    const summaryEl = summaryRef.current;
    if (summaryEl) {
      setShowJump(summaryEl.getBoundingClientRect().top > visibleBottom);
      return;
    }
    setShowJump(el.scrollHeight - el.scrollTop - el.clientHeight > JUMP_THRESHOLD);
  }, [composerHeight]);

  // Програмна прокрутка не відв'язує чат від низу — відв'язують лише жести
  // користувача вгору. Знову прив'язує лише рух донизу до самого кінця:
  // інакше перший же крок угору біля низу повертав би чат назад.
  const handleMainScroll = () => {
    const el = mainRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const goingDown = el.scrollTop > lastScrollTopRef.current;
    lastScrollTopRef.current = el.scrollTop;
    if (distance <= 1 || (goingDown && distance < STICK_THRESHOLD)) {
      stickToBottomRef.current = true;
    }
    updateJump();
  };

  const releaseBottom = () => {
    stickToBottomRef.current = false;
  };

  const handleMainWheel = (e) => {
    if (e.deltaY < 0) releaseBottom();
    swipeComposer(e.deltaY);
  };

  // Згортаємо лише від жестів самої людини (палець, колесо), а не від
  // автопрокрутки за новими репліками. Поле з текстом чи у фокусі не чіпаємо.
  const swipeComposer = (delta) => {
    // поки модератор питає чи висить помилка, поле з карткою над ним не згортається
    if (!isPhone || isAwaitingClarify || notice) return;
    swipeRef.current = Math.sign(delta) === Math.sign(swipeRef.current)
      ? swipeRef.current + delta
      : delta;
    if (Math.abs(swipeRef.current) < 24) return;
    const down = swipeRef.current > 0;
    swipeRef.current = 0;
    if (!down) {
      setIsComposerMin(false);
      return;
    }
    // почате уточнення (текст чи файли) не ховаємо
    if (note.trim() || noteFiles.length > 0 || document.activeElement === noteRef.current) return;
    setIsComposerMin(true);
  };

  // лише розгортає поле — клавіатура не вискакує, поки людина сама не тапне в нього
  const expandComposer = () => setIsComposerMin(false);

  const handleMainTouchStart = (e) => {
    touchYRef.current = e.touches[0]?.clientY ?? 0;
    swipeRef.current = 0;
  };

  // палець рухається донизу — вміст їде вгору, тобто користувач гортає назад
  const handleMainTouchMove = (e) => {
    const y = e.touches[0]?.clientY ?? 0;
    if (y > touchYRef.current + 2) releaseBottom();
    swipeComposer(touchYRef.current - y);
    touchYRef.current = y;
  };

  const handleMainKeyDown = (e) => {
    if (['ArrowUp', 'PageUp', 'Home'].includes(e.key)) releaseBottom();
  };

  // тяга смуги прокрутки: клік припадає на сам контейнер, а не на вміст
  const handleMainPointerDown = (e) => {
    if (e.target === e.currentTarget) releaseBottom();
  };

  useEffect(() => {
    updateJump();
  }, [updateJump, messages, isFinished]);

  // підсумок анімуємо, якщо дискусія хоч раз ішла на очах; рахуємо під час рендеру
  if (isRunning && !animateSummary) setAnimateSummary(true);

  const handleCopyMessage = async (message) => {
    try {
      await navigator.clipboard.writeText(plainText(message.content));
      setCopiedId(message.id);
    } catch {
      setCopiedId(`error-${message.id}`);
    }
  };

  useEffect(() => {
    if (!copiedId) return undefined;
    const timer = setTimeout(() => setCopiedId(null), 2000);
    return () => clearTimeout(timer);
  }, [copiedId]);

  // клік по цитаті веде до репліки, на яку відповідають, і коротко підсвічує її
  const jumpToMessage = (messageId) => {
    const target = document.getElementById(`message-${messageId}`);
    if (!target) return;
    stickToBottomRef.current = false;
    target.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
    setFlashId(messageId);
  };

  useEffect(() => {
    if (!flashId) return undefined;
    const timer = setTimeout(() => setFlashId(null), 1600);
    return () => clearTimeout(timer);
  }, [flashId]);

  // Верх картки підсумку з невеликим відступом — туди веде стрілка «до рішення»
  const summaryScrollTop = (el, summaryEl) =>
    el.scrollTop + summaryEl.getBoundingClientRect().top - el.getBoundingClientRect().top - 16;

  const handleJumpToDecision = () => {
    const el = mainRef.current;
    if (!el) return;
    const summaryEl = summaryRef.current;
    const top = summaryEl ? summaryScrollTop(el, summaryEl) : el.scrollHeight;
    if (!summaryEl) stickToBottomRef.current = true;
    el.scrollTo({ top, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  };

  // Підсумок, що з'явився на очах, читають з початку: чат плавно доїжджає до
  // верху картки й відпускає низ, а не кидає в самий кінець сторінки
  const summaryShown = Boolean(summaryDecision) && isFinished && !isRevealing;
  const summaryShownRef = useRef(summaryShown);
  // до відмальовування: інакше доганяння низу встигає зробити крок униз
  useLayoutEffect(() => {
    const appeared = summaryShown && !summaryShownRef.current;
    summaryShownRef.current = summaryShown;
    const el = mainRef.current;
    const summaryEl = summaryRef.current;
    if (!appeared || !animateSummary || !stickToBottomRef.current || !el || !summaryEl) return;
    stickToBottomRef.current = false;
    cancelAnimationFrame(followFrameRef.current);
    followFrameRef.current = 0;
    el.scrollTo({
      top: Math.min(summaryScrollTop(el, summaryEl), el.scrollHeight - el.clientHeight),
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  }, [summaryShown, animateSummary]);

  const handleStop = async () => {
    if (!discussion) return;
    revealAll();
    try {
      applyState(await stopDiscussion(discussion.id));
    } catch (err) {
      setActionError(actionFailure(err, t.errorAdvance));
    }
  };

  const handleResume = () => {
    if (!discussion) return;
    kicksRef.current = 0;
    startRunner(discussion.id);
  };

  // «Завершити»: дискусія обривається одразу — без решти раундів і висновку модератора
  const handleFinish = async () => {
    if (!discussion) return;
    kicksRef.current = 0;
    try {
      applyState(await finishDiscussion(discussion.id));
      setActionError('');
    } catch (err) {
      setActionError(actionFailure(err, t.finishError));
    }
  };

  const saveModels = async (changes) => {
    if (!discussion || isSaving) return;
    setIsSaving(true);
    try {
      const data = await updateDiscussion(discussion.id, changes);
      applyState(data);
      setActionError('');
    } catch (err) {
      setActionError(actionFailure(err, t.modelChangeError));
    } finally {
      setIsSaving(false);
    }
  };

  const followupsLeft = Math.max(
    0,
    (Number(discussion?.max_followups) || 0) - (Number(discussion?.followups) || 0)
  );
  // після висновку можна звернутися до одного учасника: відповість лише він
  const directLeft = Math.max(
    0,
    (Number(discussion?.max_direct) || 0) - (Number(discussion?.direct_questions) || 0)
  );
  const canAskOne = isFinished && !discussion?.quick && discussion?.safety !== 'crisis';
  const askEntry = canAskOne ? participantEntries.find((item) => item.key === askTarget) : null;
  const questionsLeft = askEntry ? directLeft : followupsLeft;
  // фінальний висновок уже пишеться: уточнення не потрапило б у нього й лишилося б без відповіді
  const isFinalWriting = discussion?.phase === 'final' && !isFinished;
  // ліміт уточнень вичерпано — поле вимкнене, і підказка в ньому пояснює чому
  // повна підказка довга навіть для широкого поля — вона лишається назвою поля,
  // а в самому полі коротший варіант (на телефоні — найкоротший)
  const noteHint = isAwaitingClarify
    ? t.clarifyNoteHint
    : askEntry
      ? directLeft > 0 ? t.askHint(askEntry.label) : t.askDone
    : isFinished
      ? followupsLeft > 0 ? t.followupPlaceholder : t.followupsDone
      : t.notePlaceholderByPhase[discussion?.phase] || t.notePlaceholder;
  const noteHintMid = isAwaitingClarify
    ? t.clarifyNoteHint
    : askEntry
      ? directLeft > 0 ? t.askHintShort(askEntry.label) : t.askDone
    : isFinished
      ? followupsLeft > 0 ? t.followupPlaceholderMid : t.followupsDoneMid
      : t.notePlaceholderByPhaseMid[discussion?.phase] || t.notePlaceholderMid;
  const noteHintShort = isAwaitingClarify
    ? t.clarifyNoteHintShort
    : askEntry
      ? directLeft > 0 ? t.askHintShort(askEntry.label) : t.askDone
    : isFinished
      ? followupsLeft > 0 ? t.followupPlaceholderShort : t.followupsDoneShort
      : t.notePlaceholderShort;
  // з трьох варіантів беремо найдовший, що вміщається в поле цілим
  const notePlaceholder = useMemo(
    () => [noteHint, noteHintMid].find((text) => fitsField(noteBox, text)) || noteHintShort,
    [noteHint, noteHintMid, noteHintShort, noteBox]
  );
  const canSendNote =
    Boolean(discussion)
    && !isSending
    && !isFinalWriting
    && !isAwaitingClarify
    && !noteFilesReading
    && note.trim().length > 0
    && (!isFinished || questionsLeft > 0);
  const showStop = isRunning && !isSending && note.trim().length === 0 && noteFiles.length === 0;

  // коротка відповідь замість раунду — лише для уточнення всім після висновку;
  // у швидкій дискусії так відповідають завжди
  const canQuickNext = isFinished && !askEntry && !discussion?.quick && discussion?.safety !== 'crisis';
  const noteLocked = isSending || isFinalWriting || (isFinished && questionsLeft === 0);

  // пошук можна ввімкнути чи вимкнути й посеред дискусії — діє з наступного кроку
  const toggleSearch = async () => {
    const next = !discussion.web_search;
    setDiscussion((current) => ({ ...current, web_search: next }));
    try {
      await updateDiscussion(discussion.id, { webSearch: next });
    } catch (err) {
      setDiscussion((current) => ({ ...current, web_search: !next }));
      pushToast(err?.message || t.searchToggleError);
    }
  };

  // те саме меню, що й у полі нового питання: формат видно, але вже не змінити
  const composerExtras = discussion
    ? [
        {
          key: 'attach',
          icon: Attachment01Icon,
          label: d.attach,
          hint: t.noteAttachHint,
          disabled: noteLocked || noteFiles.length >= MAX_FILES,
          onSelect: () => noteFileInput?.click(),
        },
        {
          key: 'quick',
          icon: FlashIcon,
          label: d.quick,
          hint: discussion.quick ? t.quickAlways : canQuickNext ? t.quickNextHint : t.quickAfterFinal,
          checked: Boolean(discussion.quick) || (canQuickNext && quickNext),
          disabled: !canQuickNext,
          onSelect: () => setQuickNext((value) => !value),
        },
        {
          key: 'search',
          icon: GlobalSearchIcon,
          label: d.webSearch,
          hint: searchAvailable ? d.webSearchMenuHint : d.webSearchUnavailable,
          checked: Boolean(discussion.web_search),
          disabled: !searchAvailable && !discussion.web_search,
          onSelect: toggleSearch,
        },
      ]
    : [];

  const handleSendNote = async (e) => {
    e.preventDefault();
    if (!canSendNote) return;
    setIsSending(true);
    try {
      const data = await postNote(discussion.id, note.trim(), askEntry ? askEntry.key : '', {
        quick: canQuickNext && quickNext,
        attachments: noteFileIds,
      });
      applyState({ ...data.discussion, messages: [data.message] });
      kicksRef.current = 0;
      setNote('');
      clearNoteFiles();
      setActionError('');
      stickToBottomRef.current = true;
    } catch (err) {
      setActionError(actionFailure(err, t.noteError));
    } finally {
      setIsSending(false);
    }
  };

  // відповіді модератору: після них сервер одразу запускає вступ учасників
  const submitClarify = async ({ skip = false } = {}) => {
    if (!isAwaitingClarify || isAnswering) return;
    setIsAnswering(true);
    try {
      const answers = skip
        ? []
        : discussion.clarify_questions.map((item) => ({
            question: item.question,
            answer: answerOf(clarifyAnswers[item.id]),
          }));
      const data = await answerClarify(discussion.id, answers);
      setClarifiedAt(Date.now());
      applyState(data);
      kicksRef.current = 0;
      setActionError('');
      stickToBottomRef.current = true;
    } catch (err) {
      setActionError(actionFailure(err, t.clarifyError));
    } finally {
      setIsAnswering(false);
    }
  };

  const handleNoteKeyDown = (e) => {
    if (!isSendShortcut(e)) return;
    e.preventDefault();
    e.currentTarget.form?.requestSubmit();
  };


  const speakers = useMemo(
    () => buildSpeakers([...(messages || []), ...draftMessages], participantColors),
    [messages, draftMessages, participantColors]
  );


  const authorOf = (message) =>
    (message.role === 'ai' && customNames.get(message.persona_slug)) || message.persona_name;

  const handleExportMarkdown = () => {
    const text = discussionMarkdown(discussion, { labels: t, phaseLabel, authorOf });
    downloadText(text, markdownFileName(discussion.title));
  };

  // нова дискусія з тим самим складом і параметрами: питання можна відредагувати
  const handleRepeat = () => {
    navigate('/home', {
      state: {
        template: {
          question: discussion.question,
          mode: discussion.mode,
          options: discussion.options,
          rounds: discussion.rounds,
          untilConsensus: discussion.until_consensus,
          webSearch: discussion.web_search,
          moderatorModel: discussion.moderator_model,
          devilModel: discussion.devil_model,
          personas: discussion.personas,
          criteria: discussion.criteria,
          quick: discussion.quick,
        },
      },
    });
  };

  // швидка відповідь виявилась замалою — те саме питання, але з повними дебатами
  const handleDeepen = () => {
    navigate('/home', {
      state: {
        template: {
          question: discussion.question,
          mode: discussion.mode,
          options: discussion.options,
          criteria: discussion.criteria,
          personas: discussion.personas,
          webSearch: discussion.web_search,
          quick: false,
        },
      },
    });
  };

  const shareUrl = discussion?.share_token
    ? `${window.location.origin}/shared/${discussion.share_token}`
    : '';

  const copyLink = async (url) => {
    try {
      await navigator.clipboard.writeText(url);
      pushToast(t.linkCopied);
    } catch {
      // без доступу до буфера посилання лишається в полі — його можна скопіювати вручну
    }
  };

  // Вмикає посилання (або бере наявне) і одразу копіює його
  const handleShare = async () => {
    if (isSharing) return;
    setIsSharing(true);
    try {
      const data = await shareDiscussion(discussion.id);
      setDiscussion((current) => (current ? { ...current, share_token: data.share_token } : current));
      await copyLink(`${window.location.origin}/shared/${data.share_token}`);
    } catch (err) {
      setActionError(actionFailure(err, t.shareError));
    } finally {
      setIsSharing(false);
    }
  };

  const handleUnshare = async () => {
    if (isSharing) return;
    setIsSharing(true);
    try {
      await unshareDiscussion(discussion.id);
      setDiscussion((current) => (current ? { ...current, share_token: null } : current));
      pushToast(t.shareClosed);
    } catch (err) {
      setActionError(actionFailure(err, t.shareError));
    } finally {
      setIsSharing(false);
    }
  };

  const toggleCompact = (value) => {
    setCompact(value);
    try {
      localStorage.setItem(COMPACT_KEY, value ? '1' : '0');
    } catch {
      // без сховища вибір діє до перезавантаження
    }
  };

  const expandMessage = (messageId) => {
    setExpandedIds((current) => new Set(current).add(messageId));
  };


  // «Завершити» має сенс, лише коли учасникам уже є що підсумувати
  const hasSpoken = Boolean(discussion?.messages?.some((message) => message.role === 'ai'));

  const notice = (() => {
    if (actionError) return actionError;
    if (isFailed) {
      // помилку прибирає сервер, коли користувач змінив модель
      if (!discussion.error_public && !discussion.error_code) {
        return { kind: 'modelChanged', text: t.modelChanged };
      }
      return {
        kind: discussionErrorKind(discussion.error_code),
        text: discussion.error_public || t.errorAdvance,
        who: true,
      };
    }
    if (isStopped && isRunning) return { kind: 'stopped', text: t.stopping };
    if (isStopped && !isFinished) {
      return { kind: 'stopped', text: hasSpoken ? t.stoppedByUser : t.stoppedBeforeStart };
    }
    return null;
  })();
  const canResume = !isFinished && !isRunning && (isFailed || isStopped || Boolean(actionError));
  // з карткою помилки поле не згортається в кнопку — інакше картка висить без поля
  const isComposerSmall = isPhone && isComposerMin && !notice;

  // панель із моделями відкриваємо, лише коли її не видно
  const openModelPanel = () => {
    if (isPhone) setIsPanelOpen(true);
    else if (panelCollapsed) togglePanel?.();
  };

  // кнопки картки: 'model' — відкрити панель із моделями, 'resume' — продовжити
  const noticeButtons = (() => {
    if (!notice) return [];
    const { kind } = notice;
    const buttons = [];
    const canPickModel =
      isFailed && ['quota', 'config', 'provider'].includes(kind) && (isPhone || panelCollapsed);
    // квоту чи ключ повтор не виправить — спершу пропонуємо іншу модель
    if (canPickModel && kind !== 'provider') buttons.push('model');
    if (canResume && !['limit', 'followups'].includes(kind)) buttons.push('resume');
    // зупинену дискусію можна й завершити, якщо учасникам уже є що підсумувати
    if (kind === 'stopped' && canResume && hasSpoken) buttons.push('finish');
    if (canPickModel && kind === 'provider') buttons.push('model');
    return buttons;
  })();
  const retryLabel = notice && ['provider', 'network', 'server', 'generic'].includes(notice.kind) ? t.retry : t.resume;
  const canEditModels = Boolean(discussion) && !isRunning && !isSaving;

  // Додаткові налаштування — окремий екран панелі, як на сторінці нової дискусії
  const toggleAdvanced = () => {
    setIsAdvancedOpen((open) => !open);
    panelRef.current?.scrollTo({ top: 0 });
  };

  return (
    <div
      className={`debate-page chat-page ${isPanelOpen ? 'debate-page--panel-open' : ''} ${panelCollapsed ? 'debate-page--panel-collapsed' : ''}`}
    >
      <PanelToggle controls="chat-settings" phoneOpen={isPanelOpen} />
      {isPanelOpen && (
        <div
          className="debate__panel-backdrop"
          onClick={() => setIsPanelOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside className="debate__form-panel chat__sidebar" id="chat-settings" ref={panelRef}>
        {discussion && (isAdvancedOpen ? (
          <section
            className="debate__panel-view"
            id="chat-advanced"
            ref={advancedRef}
            aria-labelledby="chat-more-title"
          >
            <div className="debate__panel-body debate__more">
              <div className="debate__cast-head">
                <h2 id="chat-more-title" className="debate__cast-title">{d.advancedShort}</h2>
              </div>

              <div className="debate__sheet">
                <div className="debate__field debate__field--first">
                  <h3 className="debate__field-title">{d.judges}</h3>
                </div>
                {[
                  { key: 'moderator', name: d.moderator, sub: d.moderatorSub, value: discussion.moderator_model, save: 'moderatorModel', label: d.moderatorModel },
                  { key: 'devil', name: d.devil, sub: d.devilSub, value: discussion.devil_model, save: 'devilModel', label: d.devilModel },
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
                      value={judge.value || ''}
                      onChange={(modelId) => saveModels({ [judge.save]: modelId })}
                      disabled={!canEditModels}
                      label={judge.label}
                      autoLabel={d.autoModel}
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
              <span className="debate__more-toggle-text">{d.back}</span>
            </button>
          </section>
        ) : (
          <div className="debate__panel-view">
            <div className="debate__panel-body">
              <section className="debate__cast" aria-labelledby="chat-cast-title">
                <div className="debate__cast-head">
                  <h2 id="chat-cast-title" className="debate__cast-title">
                    {d.participants}
                    <span className="debate__cast-count">{participantEntries.length}</span>
                  </h2>
                </div>
                <div className="debate__lineup">
                  {participantEntries.map((participant, index) => {
                    const active = participant.key === activeParticipant?.key;
                    return (
                      <button
                        key={participant.key}
                        type="button"
                        className={`debate__token ${active ? 'debate__token--active' : ''}`}
                        style={{ '--chip': participant.color }}
                        aria-pressed={active}
                        aria-label={d.selectParticipant(participant.label)}
                        title={[participant.label, participant.role].filter(Boolean).join(' · ')}
                        onClick={() => setActiveSlug(participant.key)}
                      >
                        <HugeiconsIcon icon={roleIcon(participant.key)} size={20} strokeWidth={1.8} aria-hidden="true" />
                        <span className="debate__token-num" aria-hidden="true">{index + 1}</span>
                      </button>
                    );
                  })}
                </div>
              </section>

              {activeParticipant && (
                <section
                  key={activeParticipant.key}
                  className="debate__sheet"
                  style={{ '--chip': activeParticipant.color }}
                  aria-label={d.participantSheet(activeParticipant.label)}
                >
                  <div className="debate__sheet-head">
                    <span className="debate__sheet-avatar" aria-hidden="true">
                      <HugeiconsIcon icon={roleIcon(activeParticipant.key)} size={22} strokeWidth={1.8} />
                    </span>
                    <div className="debate__sheet-title">
                      <span>{activeParticipant.label}</span>
                      {activeParticipant.role && activeParticipant.role !== activeParticipant.label && (
                        <small>{activeParticipant.role}</small>
                      )}
                    </div>
                  </div>

                  <div className="debate__field">
                    <h3 className="debate__field-title">{d.aiModel}</h3>
                    <ModelPicker
                      models={models}
                      value={activeParticipant.model || ''}
                      onChange={(modelId) =>
                        saveModels({ personas: [{ slug: activeParticipant.key, model: modelId }] })
                      }
                      disabled={!canEditModels}
                    />
                  </div>

                  <div className="debate__field">
                    <h3 className="debate__field-title">{d.character}</h3>
                    {activeTraits.length > 0 ? (
                      <div className="debate__tags">
                        {activeTraits.map((trait) => (
                          <span key={trait} className="debate__tag debate__tag--active">{trait}</span>
                        ))}
                      </div>
                    ) : (
                      <p className="debate__hint">{t.noTraits}</p>
                    )}
                  </div>
                </section>
              )}

              <section className="debate__sheet debate__sheet--plain" aria-label={t.view}>
                <div className="debate__field debate__field--first">
                  <h3 className="debate__field-title">{t.view}</h3>
                  <div className="debate__pills" role="group" aria-label={t.view}>
                    {[
                      [false, t.viewFull],
                      [true, t.viewTheses],
                    ].map(([value, label]) => (
                      <button
                        key={label}
                        type="button"
                        className={`debate__pill ${compact === value ? 'debate__pill--active' : ''}`}
                        aria-pressed={compact === value}
                        onClick={() => toggleCompact(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="debate__field">
                  <h3 className="debate__field-title">{t.share}</h3>
                  {shareUrl ? (
                    <>
                      <div className="debate__share">
                        <input
                          type="text"
                          value={shareUrl}
                          readOnly
                          onFocus={(e) => e.target.select()}
                          aria-label={t.shareLink}
                        />
                        <button
                          type="button"
                          className="debate__share-copy"
                          onClick={() => copyLink(shareUrl)}
                          aria-label={t.copyLink}
                          title={t.copyLink}
                        >
                          <HugeiconsIcon icon={Copy01Icon} size={15} aria-hidden="true" />
                        </button>
                      </div>
                      <button
                        type="button"
                        className="debate__link-button"
                        onClick={handleUnshare}
                        disabled={isSharing}
                      >
                        {t.unshare}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="debate__pill debate__share-create"
                      onClick={handleShare}
                      disabled={isSharing}
                    >
                      <HugeiconsIcon icon={Link01Icon} size={15} strokeWidth={1.8} aria-hidden="true" />
                      {t.createShareLink}
                    </button>
                  )}
                </div>
              </section>
            </div>

            <button
              type="button"
              className="debate__more-toggle"
              onClick={toggleAdvanced}
              aria-expanded={isAdvancedOpen}
              aria-controls="chat-advanced"
            >
              <span className="debate__more-toggle-text">{d.advancedShort}</span>
              <HugeiconsIcon icon={ArrowRight01Icon} size={16} aria-hidden="true" />
            </button>
          </div>
        ))}
      </aside>

      <div className="chat__column" style={{ '--composer-h': `${composerHeight}px` }}>
        <section
          className="chat__main"
          ref={mainRef}
          onScroll={handleMainScroll}
          onWheel={handleMainWheel}
          onTouchStart={handleMainTouchStart}
          onTouchMove={handleMainTouchMove}
          onKeyDown={handleMainKeyDown}
          onPointerDown={handleMainPointerDown}
          onClick={handleMainClick}
          aria-busy={isRunning}
        >
          {discussion && (
            // запитання — перше повідомлення користувача, а не заголовок сторінки
            <header className="chat__row chat__row--right chat__row--user">
              <span className="chat__avatar" style={{ '--avatar': USER_COLOR }} aria-hidden="true">
                {userAvatar}
              </span>
              <div className="chat__body">
                <div className="chat__head">
                  <span className="chat__name">{questionMessage?.persona_name || t.you}</span>
                </div>
                <div className="chat__bubble" style={{ '--bubble': USER_COLOR }}>
                  <MessageMarkdown blocks={parseBlocks(discussion.question)} sources={sourcesById} />
                  {discussion.clarifications?.length > 0 && (
                    // відповіді на уточнення модератора перед стартом — частина запитання
                    <dl className="chat__clarifications" aria-label={t.clarifications}>
                      {discussion.clarifications.map((item) => (
                        <div key={item.question} className="chat__clarification">
                          <dt>{item.question}</dt>
                          <dd>{item.answer}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
                {discussion.attachments?.length > 0 && (
                  <div className="chat__attachments" role="list" aria-label={t.attachments}>
                    {discussion.attachments.map((file) => (
                      <span key={file.id} role="listitem">
                        <AttachmentChip name={file.name} kind={file.kind} title={file.preview || file.name} />
                      </span>
                    ))}
                  </div>
                )}
                <TopicNotice topic={discussion.safety} className="chat__topic" />
                {discussion.profile_used && (
                  // модератор і учасники знають про людину з «Про мене» — показуємо, що це враховано
                  <p className="chat__profile-note">
                    <HugeiconsIcon icon={IdentityCardIcon} size={14} aria-hidden="true" />
                    {t.profileUsed}
                  </p>
                )}
              </div>
            </header>
          )}

          {!discussion &&
            (loadError ? (
              <ErrorNotice
                kind={loadError.kind}
                text={loadError.text}
                actions={[{ label: t.retry, onClick: loadDiscussion }]}
                className="chat__error-card"
              />
            ) : (
              <div className="chat__empty" role="status">
                {t.loading}
              </div>
            ))}

          {renderedMessages.map((message, index) => (
            <ChatMessage
              key={message.id || `${speakerKeyOf(message)}-${message.seq}`}
              message={message}
              index={index}
              messages={renderedMessages}
              speakers={speakers}
              typing={message === typingMessage}
              streamed={message === typingMessage && streamedIds.has(message.id)}
              skipTyping={skipTyping}
              onTypingDone={handleTypingDone}
              onSkipTyping={() => setSkipTyping(true)}
              models={models}
              discussion={discussion}
              customNames={customNames}
              compact={compact}
              expanded={expandedIds.has(message.id)}
              onExpand={expandMessage}
              sourcesById={sourcesById}
              copiedId={copiedId}
              onCopy={handleCopyMessage}
              flashed={Boolean(flashId) && flashId === message.id}
              onJump={jumpToMessage}
              userAvatar={userAvatar}
              runRecord={runRecords.get(message.id)}
            />
          ))}

          {discussion?.finished_early && isFinished && !isRevealing && (
            <p className="chat__notice">{t.finishedEarly}</p>
          )}

          {summaryDecision && isFinished && !isRevealing && (
            <ChatSummary
              ref={summaryRef}
              discussion={discussion}
              summaryView={summaryView}
              sourcesById={sourcesById}
              animate={animateSummary}
              onExportMarkdown={handleExportMarkdown}
              onShare={shareUrl ? () => copyLink(shareUrl) : handleShare}
              isSharing={isSharing}
              onRepeat={handleRepeat}
              onDeepen={discussion.quick ? handleDeepen : undefined}
            />
          )}

          {discussion?.safety === 'crisis' && isFinished && !isRevealing && (
            // криза: замість висновку — люди, які допоможуть просто зараз
            <CrisisHelp className="chat__crisis" />
          )}


          {showThoughtLine && (
            <ThoughtLine
              working={isRunning}
              steps={traceSteps}
              activeCount={thinking?.length || 0}
              startedAt={runStartedAt}
              label={thoughtLabel}
              doneLabel={t.thoughtDone}
              glyph={document.documentElement.dataset.motion === 'reduced' ? STILL_GLYPH : THINKING_GLYPH}
              glyphBreath={false}
              openOnWork={false}
              fontSize={16}
              className="chat__thought"
            />
          )}
          {showThoughtLine && <NotifyOffer />}

        </section>

        {discussion && (
          <div
            className={`chat__composer ${isComposerSmall ? 'chat__composer--min' : ''}`}
            ref={composerRef}
          >
            <p className="sr-only" aria-live="polite">
              {liveText}
            </p>
            {showJump && (
              <button
                type="button"
                className="chat__jump"
                onClick={handleJumpToDecision}
                aria-label={summary ? t.jumpToDecision : t.jumpToLatest}
                title={summary ? t.jumpToDecision : t.jumpToLatest}
              >
                <HugeiconsIcon icon={ArrowDown02Icon} size={18} />
              </button>
            )}
            {isAwaitingClarify && (
              // питання модератора — просто над полем вводу, як у Claude
              <ClarifyCard
                questions={discussion.clarify_questions}
                answers={clarifyAnswers}
                onChange={(questionId, answer) =>
                  setClarifyAnswers((current) => ({ ...current, [questionId]: answer }))
                }
                onSubmit={() => submitClarify()}
                onSkip={() => submitClarify({ skip: true })}
                disabled={isAnswering}
              />
            )}
            {/* картка помилки виростає з-під поля вводу й зливається з ним в одне ціле */}
            <div className="chat__dock">
              {notice && (
                <div className="chat__dock-slot">
                  <ErrorNotice
                    kind={notice.kind}
                    text={notice.text}
                    who={notice.who}
                    actions={noticeButtons.map((button) =>
                      button === 'model'
                        ? { label: copy.errors.changeModel, onClick: openModelPanel }
                        : button === 'finish'
                          ? { label: t.finish, onClick: handleFinish }
                          : { label: retryLabel, onClick: handleResume }
                    )}
                    className="chat__error-card chat__error-card--docked"
                  />
                </div>
              )}
              {canAskOne && participantEntries.length > 0 && (
                // після висновку: питання всім (ще один раунд) чи одному учаснику;
                // вибір виринає, лише поки фокус у полі вводу (або на самих пігулках)
                <div className="chat__ask-reveal">
                  <div className="chat__ask" role="radiogroup" aria-label={t.askTo}>
                    <span className="chat__ask-label">{t.askTo}</span>
                    {[{ key: '', label: t.askAll }, ...participantEntries].map((item) => (
                      <button
                        key={item.key || 'all'}
                        type="button"
                        role="radio"
                        aria-checked={askTarget === item.key}
                        className={`chat__ask-chip ${askTarget === item.key ? 'chat__ask-chip--on' : ''}`}
                        style={item.color ? { '--chip': item.color } : undefined}
                        // клік не забирає фокус із поля — пігулки не ховаються посеред кліку
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => setAskTarget(item.key)}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <form className="debate__prompt chat__composer-box" onSubmit={handleSendNote}>
                {/* формат видно, але після старту дискусії його вже не змінити;
                    у тому ж меню — файли до уточнення, швидка відповідь і пошук */}
                <ModePicker value={discussion.mode} locked extras={composerExtras} />
                <div
                  className={`debate__composer${isNoteDragging ? ' debate__composer--drop' : ''}`}
                  inert={isComposerSmall}
                  // файл можна просто перетягнути на поле, як і в новому питанні
                  onDragOver={(e) => {
                    if (!e.dataTransfer?.types?.includes('Files') || noteLocked) return;
                    e.preventDefault();
                    setIsNoteDragging(true);
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget)) setIsNoteDragging(false);
                  }}
                  onDrop={(e) => {
                    if (!e.dataTransfer?.files?.length) return;
                    e.preventDefault();
                    setIsNoteDragging(false);
                    if (!noteLocked) addNoteFiles(e.dataTransfer.files);
                  }}
                >
                  {noteFiles.length > 0 && (
                    <div className="debate__files" aria-live="polite">
                      {noteFiles.map((file) => (
                        <AttachmentCard
                          key={file.key}
                          file={file}
                          title={
                            file.status === 'reading'
                              ? d.attachReading
                              : file.truncated ? d.attachTruncated : file.name
                          }
                          onRemove={isSending ? undefined : () => removeNoteFile(file)}
                          removeLabel={d.attachRemove(file.name)}
                        />
                      ))}
                    </div>
                  )}
                  <textarea
                    ref={noteRef}
                    className="debate__composer-input"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    onKeyDown={handleNoteKeyDown}
                    maxLength={MAX_NOTE}
                    rows={1}
                    placeholder={notePlaceholder}
                    disabled={noteLocked}
                    aria-label={noteHint}
                  />
                  <div className="debate__composer-bar">
                    <span className="debate__composer-count">
                      {note.length > 0 ? `${note.length} / ${MAX_NOTE}` : ''}
                    </span>
                    <input
                      ref={setNoteFileInput}
                      type="file"
                      accept={FILE_TYPES}
                      multiple
                      hidden
                      onChange={(e) => {
                        addNoteFiles(e.target.files);
                        e.target.value = '';
                      }}
                    />
                    {showStop ? (
                      // поки дискусія йде, а поле порожнє, кнопка відправки зупиняє її;
                      // щойно користувач почне писати — знову можна надіслати уточнення
                      <button
                        type="button"
                        className="debate__send debate__send--stop"
                        onClick={handleStop}
                        disabled={isStopped}
                        aria-label={isStopped ? t.stopping : t.stop}
                        title={isStopped ? t.stopping : t.stop}
                      >
                        {isStopped ? <span className="debate__send-spinner" /> : <StopIcon />}
                      </button>
                    ) : (
                      <button
                        type="submit"
                        className="debate__send"
                        disabled={!canSendNote}
                        aria-label={isSending ? t.noteSending : t.noteSend}
                        title={isSending ? t.noteSending : t.noteSend}
                      >
                        {isSending ? <span className="debate__send-spinner" /> : <ArrowUpIcon />}
                      </button>
                    )}
                  </div>
                </div>
                {/* згорнуте поле — кругла кнопка; тап повертає поле */}
                <button
                  type="button"
                  className="chat__composer-expand"
                  onClick={expandComposer}
                  aria-label={t.noteExpand}
                  title={t.noteExpand}
                  tabIndex={isComposerSmall ? 0 : -1}
                  aria-hidden={!isComposerSmall}
                >
                  <HugeiconsIcon icon={PencilEdit02Icon} size={20} strokeWidth={1.8} />
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
