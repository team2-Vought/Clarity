import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  ArrowDown01Icon,
  ArrowDown02Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowTurnBackwardIcon,
  Copy01Icon,
  Download04Icon,
  FileExportIcon,
  Link01Icon,
  Loading03Icon,
  RepeatIcon,
  Share08Icon,
  Search01Icon,
  Tick02Icon,
} from '@hugeicons/core-free-icons';
import {
  fetchDiscussion,
  fetchModels,
  fetchPersonas,
  postNote,
  runDiscussion,
  shareDiscussion,
  stopDiscussion,
  unshareDiscussion,
  updateDiscussion,
} from '../api/discussions';
import { useToasts } from '../hooks/useToasts';
import {
  ArrowUpIcon,
  AvatarIcon,
  CloseIcon,
  StopIcon,
} from '../components/DebateIcons';
import ModePicker from '../components/ModePicker';
import ModelPicker from '../components/ModelPicker';
import PanelToggle from '../components/PanelToggle';
import ThoughtLine from '../components/ThoughtLine';
import MessageMarkdown, { InlineText } from '../components/MessageMarkdown';
import ParagraphReveal from '../components/ParagraphReveal';
import SummaryDetails from '../components/SummaryDetails';
import { uk } from '../copy/uk';
import { TRAIT_COLORS, roleIcon } from '../utils/debateOptions';
import { citedIds, inlinePlain, parseBlocks, plainText } from '../utils/markdown';
import { downloadSummaryPdf } from '../utils/summaryPdf';
import { describeSummary, summaryDetailSteps } from '../utils/summary';
import {
  USER_COLOR,
  buildSpeakers,
  duplicateFinalId,
  findReplyTarget,
  phaseLabel,
  speakerKeyOf,
  stanceLabel,
  stanceTone,
} from '../utils/chatView';
import { discussionMarkdown, downloadText, markdownFileName } from '../utils/exportMarkdown';

const t = uk.chat;
const d = uk.debate;

const STICK_THRESHOLD = 96;
// довша за це репліка одразу займає всю ширину, щоб не розширюватися під час появи
const WIDE_MESSAGE = 160;
const JUMP_THRESHOLD = 400;
// частка відстані до низу, яку чат проходить за кадр: великий стрибок висоти
// стає м'яким доїздом (~0,3 с), а рівний ріст тексту — майже без відставання
const FOLLOW_EASE = 0.16;

const prefersReducedMotion = () =>
  Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
// Дискусію виконує сервер; сторінка лише опитує стан.
const POLL_MS = 2000;
// Скільки разів поспіль можна «підштовхнути» раннер, якщо сервер його втратив
// (перезапуск процесу), перш ніж показати помилку.
const MAX_KICKS = 3;
const MAX_NOTE = 1000;
const CITATION_RE = /(\[\d+\])/g;
const COMPACT_KEY = 'clarity:chat-compact';

// Закритий бейдж «Уточнень залишилось» пам'ятаємо для дискусії й кількості:
// після нового уточнення число змінюється, і бейдж з'являється знову.
const hintStorageKey = (id, left) => `clarity:followup-hint:${id}:${left}`;

const isHintDismissed = (key) => {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
};

const domainOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

const faviconOf = (url) => {
  const domain = domainOf(url);
  return domain ? `https://icons.duckduckgo.com/ip3/${domain}.ico` : '';
};

function SourceFavicon({ url }) {
  const [failed, setFailed] = useState(false);
  const src = faviconOf(url);
  if (!src || failed) {
    return (
      <span className="chat__source-icon chat__source-icon--letter" aria-hidden="true">
        {(domainOf(url)[0] || '?').toUpperCase()}
      </span>
    );
  }
  return (
    <img
      className="chat__source-icon"
      src={src}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

// Згорнуто — рядок із кількома логотипами, розгорнуто — список посилань
function SourceList({ sources, query = '', compact = false }) {
  return (
    <details className={`chat__sources ${compact ? 'chat__sources--compact' : ''}`}>
      <summary>
        <span className="chat__sources-icons" aria-hidden="true">
          {sources.slice(0, 4).map((source) => (
            <SourceFavicon key={source.id} url={source.url} />
          ))}
        </span>
        {`${t.sources} · ${sources.length}`}
        <HugeiconsIcon icon={ArrowDown01Icon} size={14} className="chat__sources-chevron" />
      </summary>
      <ol>
        {query && <li className="chat__sources-query">{t.searchedFor(query)}</li>}
        {sources.map((source) => (
          <li key={source.id}>
            <a href={source.url} target="_blank" rel="noopener noreferrer" title={source.title}>
              <SourceFavicon url={source.url} />
              <span className="chat__source-title">{source.title || domainOf(source.url)}</span>
              <span className="chat__source-domain">{domainOf(source.url)}</span>
            </a>
          </li>
        ))}
      </ol>
    </details>
  );
}

const readCompact = () => {
  try {
    return localStorage.getItem(COMPACT_KEY) === '1';
  } catch {
    return false;
  }
};

const modelNameOf = (models, id) => {
  const model = models.find((item) => item.id === id);
  return model ? model.label || model.model : '';
};

// Колонка карти позицій: вступ, раунд або відповідь на Devil (після
// уточнення синтез і Devil проходять ще раз, тож відповідей може бути кілька).
const snippetOf = (content) =>
  plainText(content).replace(CITATION_RE, '').replace(/\s+/g, ' ').trim().slice(0, 220);

// Джерела, які стосуються репліки: додані її пошуком і процитовані в тексті
const messageSources = (message, sourcesById) => {
  const ids = [...(message.source_ids || []), ...citedIds(message.content)];
  return [...new Set(ids)].map((sourceId) => sourcesById.get(sourceId)).filter(Boolean);
};

const mergeMessages = (current, incoming) => {
  if (!incoming?.length) return current || [];
  const known = new Set((current || []).map((message) => message.id));
  const fresh = incoming.filter((message) => !known.has(message.id));
  if (fresh.length === 0) return current;
  return [...(current || []), ...fresh].sort((a, b) => a.seq - b.seq);
};

const lastSeqOf = (discussion) =>
  (discussion?.messages || []).reduce((max, message) => Math.max(max, message.seq || 0), 0);

// Коротка цитата тези в кроці індикатора — обрізана по слову
const shortQuote = (text, limit = 60) => {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const cut = clean.length > limit ? `${clean.slice(0, limit - 1).replace(/\s+\S*$/, '')}…` : clean;
  return `«${cut}»`;
};

// Зроблений крок: хто говорив, кому відповідав і з якою тезою
const doneStep = (message) => {
  const who = message.reply_to ? `${message.persona_name} → ${message.reply_to}` : message.persona_name;
  const thesis = shortQuote(message.thesis);
  return thesis ? `${who} · ${thesis}` : who;
};

// Поточний крок із сервера: над чим саме зараз думає кожен AI
const thinkingStep = (item) =>
  item.text.startsWith('→') ? `${item.name} ${item.text}` : `${item.name} · ${item.text}`;



export default function ChatPage() {
  const { id } = useParams();
  const [discussion, setDiscussion] = useState(null);
  const [personas, setPersonas] = useState([]);
  const [models, setModels] = useState([]);
  const [defaultModel, setDefaultModel] = useState('');
  const [activeSlug, setActiveSlug] = useState('');
  const [actionError, setActionError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [copyState, setCopyState] = useState('');
  const [pdfState, setPdfState] = useState('');
  const [note, setNote] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [pollTick, setPollTick] = useState(0);
  // на телефоні бічна панель — висувна, відкривається кнопкою «≡»
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const { panelCollapsed = false, registerPanelToggle } = useOutletContext() ?? {};

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
  const kicksRef = useRef(0);
  const progressRef = useRef(0);
  const mainRef = useRef(null);
  const stickToBottomRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const touchYRef = useRef(0);
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
  const [dismissedHints, setDismissedHints] = useState(() => new Set());
  const advancedRef = useRef(null);
  const [composerHeight, setComposerHeight] = useState(0);
  // «Лише тези»: AI-репліки стиснуті до головної думки, повний текст — за кліком
  const [compact, setCompact] = useState(readCompact);
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const navigate = useNavigate();
  const { pushToast } = useToasts();
  const [isSharing, setIsSharing] = useState(false);

  const applyState = useCallback((data, { replaceMessages = false } = {}) => {
    if (!data) return;
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
        setActionError(err.message || t.errorAdvance);
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
      const idle = !data.is_running && !data.is_finished && !data.stop_requested;
      if (idle && data.status !== 'failed') startRunner(data.id);
    } catch (err) {
      setLoadError(err.message || t.loadError);
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
  // Опитуємо, доки сервер працює або має працювати (раннер ще стартує).
  const shouldPoll = Boolean(discussion) && (isRunning || (!isFinished && !isFailed && !isStopped));
  const discussionId = discussion?.id;

  useEffect(() => {
    discussionRef.current = discussion;
  });

  useEffect(() => {
    if (!discussionId || !shouldPoll) return undefined;
    const controller = new AbortController();
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
        const idle = !data.is_running && !data.is_finished && !data.stop_requested;
        if (idle && data.status !== 'failed') {
          if (kicksRef.current < MAX_KICKS) {
            kicksRef.current += 1;
            await startRunner(discussionId);
          } else {
            setActionError(t.stopped);
          }
        }
      } catch (err) {
        if (err?.name !== 'AbortError') setActionError(err.message || t.errorAdvance);
      } finally {
        if (!controller.signal.aborted) setPollTick((tick) => tick + 1);
      }
    }, POLL_MS);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [discussionId, shouldPoll, pollTick, applyState, startRunner]);

  useEffect(() => {
    if (!discussion?.title) return undefined;
    const previous = document.title;
    document.title = `${discussion.title} · ${uk.appName}`;
    return () => {
      document.title = previous;
    };
  }, [discussion?.title]);

  const messages = discussion?.messages;
  const questionMessage = useMemo(
    () => (messages || []).find((message) => message.role === 'user'),
    [messages]
  );
  const summary = discussion?.final_summary || null;
  const summaryView = describeSummary(summary);
  const {
    decision: summaryDecision,
    confirmed: summaryConfirmed,
    confidence: summaryConfidence,
    agreement,
    lists: summaryLists,
  } = summaryView;
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
        role: personaInfo.get(persona.slug)?.name || '',
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
  const runStartedAt = Date.parse(currentRun?.start.created_at) || undefined;
  const pendingMessage =
    revealedCount < visibleMessages.length ? visibleMessages[revealedCount] : null;
  const typingMessage = pendingMessage && pendingMessage.role !== 'user' ? pendingMessage : null;
  const isRevealing = Boolean(typingMessage);
  const shownMessages = visibleMessages.slice(0, revealedCount + 1);
  const queuedCount = visibleMessages.length - revealedCount;
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
  const showThoughtLine = participantNames.length > 0 && !isRevealing && isRunning && !isFinished;

  // Завершені запуски лишають у чаті згорнутий рядок «Аналізовано за …» після
  // своєї останньої репліки — розгорнувши його, видно, що саме аналізували.
  // Тривалість — за часом сервера: від питання чи уточнення до останньої репліки.
  const runRecords = useMemo(() => {
    const records = new Map();
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
  }, [runs, isRunning, isFinished, isFailed, isStopped, hiddenFinalId]);

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
  };

  const handleMainTouchStart = (e) => {
    touchYRef.current = e.touches[0]?.clientY ?? 0;
  };

  // палець рухається донизу — вміст їде вгору, тобто користувач гортає назад
  const handleMainTouchMove = (e) => {
    const y = e.touches[0]?.clientY ?? 0;
    if (y > touchYRef.current + 2) releaseBottom();
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
    try {
      applyState(await stopDiscussion(discussion.id));
    } catch (err) {
      setActionError(err.message || t.errorAdvance);
    }
  };

  const handleResume = () => {
    if (!discussion) return;
    kicksRef.current = 0;
    startRunner(discussion.id);
  };

  const saveModels = async (changes) => {
    if (!discussion || isSaving) return;
    setIsSaving(true);
    try {
      const data = await updateDiscussion(discussion.id, changes);
      applyState(data);
      setActionError('');
    } catch (err) {
      setActionError(err.message || t.modelChangeError);
    } finally {
      setIsSaving(false);
    }
  };

  const followupsLeft = Math.max(
    0,
    (Number(discussion?.max_followups) || 0) - (Number(discussion?.followups) || 0)
  );
  const hintKey = hintStorageKey(discussion?.id, followupsLeft);
  const isHintVisible = !dismissedHints.has(hintKey) && !isHintDismissed(hintKey);

  const dismissHint = () => {
    setDismissedHints((current) => new Set(current).add(hintKey));
    try {
      localStorage.setItem(hintKey, '1');
    } catch {
      // без сховища бейдж просто з'явиться знову після перезавантаження
    }
  };
  // фінальний висновок уже пишеться: уточнення не потрапило б у нього й лишилося б без відповіді
  const isFinalWriting = discussion?.phase === 'final' && !isFinished;
  const notePlaceholder = isFinished
    ? t.followupPlaceholder
    : t.notePlaceholderByPhase[discussion?.phase] || t.notePlaceholder;
  const canSendNote =
    Boolean(discussion)
    && !isSending
    && !isFinalWriting
    && note.trim().length > 0
    && (!isFinished || followupsLeft > 0);
  const showStop = isRunning && !isSending && note.trim().length === 0;

  const handleSendNote = async (e) => {
    e.preventDefault();
    if (!canSendNote) return;
    setIsSending(true);
    try {
      const data = await postNote(discussion.id, note.trim());
      applyState({ ...data.discussion, messages: [data.message] });
      kicksRef.current = 0;
      setNote('');
      setActionError('');
      stickToBottomRef.current = true;
    } catch (err) {
      setActionError(err.message || t.noteError);
    } finally {
      setIsSending(false);
    }
  };

  const handleNoteKeyDown = (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    e.currentTarget.form?.requestSubmit();
  };


  const speakers = useMemo(
    () => buildSpeakers(messages, participantColors),
    [messages, participantColors]
  );


  const handleCopySummary = async () => {
    const lines = [discussion.question, ''];
    if (summary?.answer) lines.push(`${t.summaryAnswer}: ${inlinePlain(summary.answer)}`);
    lines.push(`${t.summaryDecision}: ${inlinePlain(summaryDecision)}`);
    if (summaryConfirmed === false && summary?.revision) {
      lines.push(`${t.summaryRevision}: ${inlinePlain(summary.revision)}`);
    }
    if (agreement) {
      lines.push(`${t.summaryAgreement}: ${t.summaryAgreementValue(agreement.agree, agreement.total)}`);
    }
    if (summaryConfidence !== null) lines.push(`${t.summaryConfidence}: ${summaryConfidence}%`);
    summaryLists.forEach(({ title, items }) => {
      lines.push('', `${title}:`, ...items.map((item) => `• ${inlinePlain(item)}`));
    });
    if (summary?.recommendation) {
      lines.push('', `${t.summaryNextStep}: ${inlinePlain(summary.recommendation)}`);
    }
    if (discussion.sources?.length) {
      lines.push('', `${t.sources}:`);
      discussion.sources.forEach((source) => lines.push(`[${source.id}] ${source.title} — ${source.url}`));
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopyState('done');
    } catch {
      setCopyState('error');
    }
    window.setTimeout(() => setCopyState(''), 2000);
  };

  const handleDownloadPdf = async () => {
    if (pdfState === 'busy') return;
    setPdfState('busy');
    try {
      await downloadSummaryPdf({
        question: discussion.question,
        summary: { ...summary, decision: summaryDecision, confirmed: summaryConfirmed, confidence: summaryConfidence },
        lists: summaryLists,
        sources: discussion.sources,
        t,
      });
      setPdfState('');
    } catch {
      setPdfState('error');
      window.setTimeout(() => setPdfState(''), 2500);
    }
  };

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
          webSearch: discussion.web_search,
          moderatorModel: discussion.moderator_model,
          devilModel: discussion.devil_model,
          personas: discussion.personas,
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
      setActionError(err.message || t.shareError);
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
      setActionError(err.message || t.shareError);
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

  // Частини результату проявляються по черзі, як абзаци реплік
  // дії й джерела проявляються після частин SummaryDetails
  let summaryIndex = summaryDetailSteps(summary, summaryView);
  const summaryStep = () => (animateSummary ? { '--i': summaryIndex++ } : undefined);

  const copyLabel = copyState === 'done' ? t.copied : copyState === 'error' ? t.copyError : t.copySummary;
  const pdfLabel = pdfState === 'busy' ? t.pdfPreparing : pdfState === 'error' ? t.pdfError : t.downloadPdf;

  const statusText = (() => {
    if (actionError) return actionError;
    if (isFailed) {
      // помилку прибирає сервер, коли користувач змінив модель
      if (!discussion.error_public && !discussion.error_code) return t.modelChanged;
      const base = discussion.error_public || t.errorAdvance;
      return discussion.retryable === false ? `${base} ${t.errorFixModel}` : base;
    }
    if (isStopped && isRunning) return t.stopping;
    if (isStopped && !isFinished) return t.stoppedByUser;
    return '';
  })();
  const canResume = !isFinished && !isRunning && (isFailed || isStopped || Boolean(actionError));
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
            className="debate__more"
            id="chat-advanced"
            ref={advancedRef}
            aria-labelledby="chat-more-title"
          >
            <div className="debate__cast-head">
              <button
                type="button"
                className="debate__more-back"
                onClick={toggleAdvanced}
                aria-label={d.backToCast}
                title={d.backToCast}
              >
                <HugeiconsIcon icon={ArrowLeft01Icon} size={18} aria-hidden="true" />
                <h2 id="chat-more-title" className="debate__cast-title">{d.advancedShort}</h2>
              </button>
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
              <span className="debate__more-toggle-text">
                {d.advancedShort}
                {(discussion.moderator_model || discussion.devil_model) && (
                  <small>{d.judgesCustomized}</small>
                )}
              </span>
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
          aria-busy={isRunning}
        >
          {discussion && (
            // запитання — перше повідомлення користувача, а не заголовок сторінки
            <header className="chat__row chat__row--right chat__row--user">
              <span className="chat__avatar" style={{ '--avatar': USER_COLOR }} aria-hidden="true">
                <AvatarIcon />
              </span>
              <div className="chat__body">
                <div className="chat__head">
                  <span className="chat__name">{questionMessage?.persona_name || t.you}</span>
                </div>
                <div className="chat__bubble" style={{ '--bubble': USER_COLOR }}>
                  <MessageMarkdown blocks={parseBlocks(discussion.question)} sources={sourcesById} />
                </div>
              </div>
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

          {shownMessages.map((message, index) => {
            const speakerKey = speakerKeyOf(message);
            const { color, side } = speakers.get(speakerKey) || { color: USER_COLOR, side: 'left' };
            const typing = message === typingMessage;
            const authorName = authorOf(message);
            const messageModel =
              message.role === 'user' ? '' : modelNameOf(models, message.model_id);
            const searched = message.search_query || '';
            const previous = shownMessages[index - 1];
            const divider = phaseLabel(message);
            const showDivider =
              divider
              && message.role !== 'user'
              && (!previous || phaseLabel(previous) !== divider);
            const showEarlyStop =
              showDivider && message.phase === 'synthesis' && discussion?.early_stop;
            // кілька реплік поспіль від одного автора — як у месенджері, без повтору імені
            const grouped =
              !showDivider && previous && speakerKeyOf(previous) === speakerKey && previous.role !== 'research';
            const replyTarget = findReplyTarget(shownMessages, index);
            const replyName = message.reply_to
              ? customNames.get(message.reply_to_slug) || message.reply_to
              : '';
            const stance =
              message.role === 'ai' ? stanceLabel(message, discussion?.mode, replyName) : '';
            const collapsed =
              compact
              && !typing
              && message.role === 'ai'
              && message.thesis
              && !expandedIds.has(message.id);
            const replyColor = replyTarget
              ? speakers.get(speakerKeyOf(replyTarget))?.color
              : undefined;
            const text = typing ? (
              <ParagraphReveal
                key={message.id}
                content={message.content}
                skip={skipTyping}
                onDone={handleTypingDone}
              >
                {(blocks, pending) => (
                  <MessageMarkdown blocks={blocks} sources={sourcesById} animate>
                    {pending && (
                      <span className="chat__pending" aria-hidden="true">
                        <span />
                        <span />
                      </span>
                    )}
                  </MessageMarkdown>
                )}
              </ParagraphReveal>
            ) : collapsed ? (
              <div className="chat__thesis">
                <p>
                  <InlineText text={message.thesis} sources={sourcesById} />
                </p>
                <button
                  type="button"
                  className="chat__expand"
                  onClick={() => expandMessage(message.id)}
                >
                  {t.expandMessage}
                </button>
              </div>
            ) : (
              <MessageMarkdown blocks={parseBlocks(message.content)} sources={sourcesById} />
            );
            const ownSources = typing ? [] : messageSources(message, sourcesById);
            const copyStatus =
              copiedId === message.id ? 'done' : copiedId === `error-${message.id}` ? 'error' : '';
            const copyMessageLabel =
              copyStatus === 'done' ? t.copied : copyStatus === 'error' ? t.copyError : t.copyMessage;
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
                {message.role === 'research' ? (
                  <div
                    className={`chat__system ${typing ? 'chat__row--enter' : ''}`}
                    onClick={typing ? () => setSkipTyping(true) : undefined}
                  >
                    <HugeiconsIcon icon={Search01Icon} size={14} className="chat__system-icon" />
                    {text}
                  </div>
                ) : (
                  <div
                    id={message.id ? `message-${message.id}` : undefined}
                    className={[
                      'chat__row',
                      `chat__row--${side}`,
                      `chat__row--${message.role}`,
                      grouped && 'chat__row--grouped',
                      typing && 'chat__row--enter',
                      flashId && flashId === message.id && 'chat__row--flash',
                    ].filter(Boolean).join(' ')}
                  >
                    <span
                      className="chat__avatar"
                      style={{ '--avatar': color }}
                      aria-hidden="true"
                    >
                      {/* іконка ролі розрізняє учасників не лише кольором — та сама, що в складі команди */}
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
                      {!grouped && (
                        <div className="chat__head">
                          <span className="chat__name">{authorName}</span>
                          {messageModel && <span className="chat__model">{messageModel}</span>}
                          {stance && (
                            <span className="chat__stance" data-stance={stanceTone(message.stance)}>
                              {stance}
                            </span>
                          )}
                        </div>
                      )}
                      <div
                        className={[
                          'chat__bubble',
                          typing && 'chat__bubble--typing',
                          (message.content || '').length > WIDE_MESSAGE && 'chat__bubble--wide',
                        ].filter(Boolean).join(' ')}
                        style={{ '--bubble': color }}
                        onClick={typing ? () => setSkipTyping(true) : undefined}
                        title={typing ? t.skipTyping : undefined}
                      >
                        {replyName && (
                          <button
                            type="button"
                            className="chat__quote"
                            style={replyColor ? { '--quote': replyColor } : undefined}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (replyTarget) jumpToMessage(replyTarget.id);
                            }}
                            disabled={!replyTarget}
                            aria-label={t.jumpToReply(replyName)}
                          >
                            <span className="chat__quote-name">
                              <HugeiconsIcon icon={ArrowTurnBackwardIcon} size={13} />
                              {replyName}
                            </span>
                            {replyTarget && (
                              <span className="chat__quote-text">{snippetOf(replyTarget.content)}</span>
                            )}
                          </button>
                        )}
                        {text}
                      </div>
                      {!typing && (
                        <div className="chat__actions">
                          <button
                            type="button"
                            className="chat__icon-button chat__copy"
                            onClick={() => handleCopyMessage(message)}
                            aria-label={copyMessageLabel}
                            title={copyMessageLabel}
                          >
                            <HugeiconsIcon icon={copyStatus === 'done' ? Tick02Icon : Copy01Icon} size={16} />
                          </button>
                          {ownSources.length > 0 ? (
                            <SourceList sources={ownSources} query={searched} compact />
                          ) : (
                            searched && (
                              <span className="chat__search" title={t.searchedFor(searched)}>
                                <HugeiconsIcon icon={Search01Icon} size={12} />
                                {t.searchedFor(searched)}
                              </span>
                            )
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {!typing && runRecords.has(message.id) && (
                  <ThoughtLine
                    working={false}
                    steps={runRecords.get(message.id).steps}
                    elapsed={runRecords.get(message.id).seconds}
                    label={t.advancing}
                    doneLabel={t.thoughtDone}
                    glyph="sparkle"
                    fontSize={16}
                    className="chat__thought chat__thought--done"
                  />
                )}
              </Fragment>
            );
          })}

          {summaryDecision && isFinished && !isRevealing && (
            <section
              className={`chat__summary ${animateSummary ? 'chat__summary--enter' : ''}`}
              ref={summaryRef}
              aria-label={t.summary}
            >
              <SummaryDetails
                summary={summary}
                view={summaryView}
                sources={sourcesById}
                animate={animateSummary}
              />
              <div className="chat__summary-actions" style={summaryStep()}>
                <button
                  type="button"
                  className="chat__icon-button"
                  onClick={handleCopySummary}
                  aria-label={copyLabel}
                  title={copyLabel}
                >
                  <HugeiconsIcon icon={copyState === 'done' ? Tick02Icon : Copy01Icon} size={18} />
                </button>
                <button
                  type="button"
                  className="chat__icon-button"
                  onClick={handleDownloadPdf}
                  disabled={pdfState === 'busy'}
                  aria-label={pdfLabel}
                  title={pdfLabel}
                >
                  <HugeiconsIcon
                    icon={pdfState === 'busy' ? Loading03Icon : Download04Icon}
                    size={18}
                    className={pdfState === 'busy' ? 'chat__icon-spin' : undefined}
                  />
                </button>
                <button
                  type="button"
                  className="chat__icon-button"
                  onClick={handleExportMarkdown}
                  aria-label={t.exportMarkdown}
                  title={t.exportMarkdown}
                >
                  <HugeiconsIcon icon={FileExportIcon} size={18} />
                </button>
                <button
                  type="button"
                  className="chat__icon-button"
                  onClick={shareUrl ? () => copyLink(shareUrl) : handleShare}
                  disabled={isSharing}
                  aria-label={t.shareAction}
                  title={t.shareAction}
                >
                  <HugeiconsIcon icon={Share08Icon} size={18} />
                </button>
                <button
                  type="button"
                  className="chat__icon-button"
                  onClick={handleRepeat}
                  aria-label={t.repeat}
                  title={t.repeat}
                >
                  <HugeiconsIcon icon={RepeatIcon} size={18} />
                </button>
              </div>
              {(copyState === 'error' || pdfState === 'error') && (
                <p className="chat__summary-note" role="alert">
                  {copyState === 'error' ? t.copyError : t.pdfError}
                </p>
              )}
              {discussion?.sources?.length > 0 && (
                <div style={summaryStep()}>
                  <SourceList sources={discussion.sources} />
                </div>
              )}
            </section>
          )}


          {showThoughtLine && (
            <ThoughtLine
              working={isRunning}
              steps={traceSteps}
              activeCount={thinking?.length || 0}
              startedAt={runStartedAt}
              label={t.advancing}
              doneLabel={t.thoughtDone}
              glyph="sparkle"
              fontSize={16}
              className="chat__thought"
            />
          )}

          {statusText && (
            <div className="chat__error-block" role="alert" aria-live="polite">
              <p className="debate__error">{statusText}</p>
              {canResume && (
                <button type="button" className="chat__advance" onClick={handleResume}>
                  {t.resume}
                </button>
              )}
            </div>
          )}


        </section>

        {discussion && (
          <form className="chat__composer" ref={composerRef} onSubmit={handleSendNote}>
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
            {queuedCount > 1 && (
              <button type="button" className="chat__reveal-all" onClick={revealAll}>
                {t.revealAll(queuedCount)}
              </button>
            )}
            {isFinalWriting && <p className="chat__composer-hint">{t.noteWaitFinal}</p>}
            {isFinished && isHintVisible && (
              <p className="chat__composer-hint">
                <span>{followupsLeft > 0 ? t.followupsLeft(followupsLeft) : t.followupsDone}</span>
                <button
                  type="button"
                  className="chat__composer-hint-close"
                  onClick={dismissHint}
                  aria-label={t.hideHint}
                  title={t.hideHint}
                >
                  <CloseIcon />
                </button>
              </p>
            )}
            <div className="debate__composer chat__composer-box">
              {/* режим видно, але після старту дискусії його вже не змінити */}
              <ModePicker value={discussion.mode} locked />
              <textarea
                ref={noteRef}
                className="debate__composer-input"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={handleNoteKeyDown}
                maxLength={MAX_NOTE}
                rows={1}
                placeholder={notePlaceholder}
                disabled={isSending || isFinalWriting || (isFinished && followupsLeft === 0)}
                aria-label={notePlaceholder}
              />
              <div className="debate__composer-bar">
                <span className="debate__composer-count">
                  {note.length > 0 ? `${note.length} / ${MAX_NOTE}` : ''}
                </span>
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
          </form>
        )}
      </div>
    </div>
  );
}
