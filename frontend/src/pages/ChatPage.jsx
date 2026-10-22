import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useOutletContext, useParams } from 'react-router-dom';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  ArrowDown01Icon,
  ArrowDown02Icon,
  ArrowTurnBackwardIcon,
  Copy01Icon,
  Download04Icon,
  Loading03Icon,
  Search01Icon,
  Tick02Icon,
} from '@hugeicons/core-free-icons';
import {
  fetchDiscussion,
  fetchModels,
  fetchPersonas,
  postNote,
  runDiscussion,
  stopDiscussion,
  updateDiscussion,
} from '../api/discussions';
import {
  ArrowUpIcon,
  ChevronIcon,
  CloseIcon,
  StopIcon,
  UserPlusIcon,
} from '../components/DebateIcons';
import ModelPicker from '../components/ModelPicker';
import PanelToggle from '../components/PanelToggle';
import ThoughtLine from '../components/ThoughtLine';
import MessageMarkdown, { InlineText } from '../components/MessageMarkdown';
import ParagraphReveal from '../components/ParagraphReveal';
import { uk } from '../copy/uk';
import { TRAITS, TRAIT_COLORS } from '../utils/debateOptions';
import { citedIds, inlinePlain, parseBlocks, plainText } from '../utils/markdown';
import { downloadSummaryPdf } from '../utils/summaryPdf';

const t = uk.chat;
const d = uk.debate;

const DEVIL_COLOR = '#e5484d';
const MODERATOR_COLOR = '#fde3c6';
const USER_COLOR = '#f0f0f0';
const RESEARCH_COLOR = '#d6eefb';
const STICK_THRESHOLD = 96;
// довша за це репліка одразу займає всю ширину, щоб не розширюватися під час появи
const WIDE_MESSAGE = 160;
const JUMP_THRESHOLD = 400;
// Дискусію виконує сервер; сторінка лише опитує стан.
const POLL_MS = 2000;
// Скільки разів поспіль можна «підштовхнути» раннер, якщо сервер його втратив
// (перезапуск процесу), перш ніж показати помилку.
const MAX_KICKS = 3;
const MAX_NOTE = 1000;
const CITATION_RE = /(\[\d+\])/g;

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

const AvatarIcon = () => (
  <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
    <circle cx="20" cy="15" r="6" fill="#ffffff" />
    <path d="M7 36c1.2-7.6 6-11.5 13-11.5s11.8 3.9 13 11.5H7Z" fill="#ffffff" />
  </svg>
);

const listOf = (value) =>
  (Array.isArray(value) ? value : [])
    .map((item) => String(item ?? '').trim())
    .filter(Boolean);

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

const stanceText = (stance) => (stance ? t.stance[stance] || stance : '');
const stanceTone = (stance) =>
  stance === 'згода' ? 'agree' : stance === 'суперечка' ? 'disagree' : 'neutral';

const speakerKeyOf = (message) =>
  message.role === 'user' ? 'user' : message.persona_name || message.role;

const slugOf = (message) => (message.role === 'user' ? 'user' : message.persona_slug);

// Остання репліка того, кому відповідають, — для цитати над текстом
const findReplyTarget = (messages, index) => {
  const message = messages[index];
  if (!message.reply_to && !message.reply_to_slug) return null;
  for (let i = index - 1; i >= 0; i -= 1) {
    const candidate = messages[i];
    if (message.reply_to_slug ? slugOf(candidate) === message.reply_to_slug
      : candidate.persona_name === message.reply_to) {
      return candidate;
    }
  }
  return null;
};

const snippetOf = (content) =>
  plainText(content).replace(CITATION_RE, '').replace(/\s+/g, ' ').trim().slice(0, 220);

// Джерела, які стосуються репліки: додані її пошуком і процитовані в тексті
const messageSources = (message, sourcesById) => {
  const ids = [...(message.source_ids || []), ...citedIds(message.content)];
  return [...new Set(ids)].map((sourceId) => sourcesById.get(sourceId)).filter(Boolean);
};

const phaseLabel = (message) => {
  switch (message.phase) {
    case 'research':
      return t.phaseResearch;
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

const mergeMessages = (current, incoming) => {
  if (!incoming?.length) return current || [];
  const known = new Set((current || []).map((message) => message.id));
  const fresh = incoming.filter((message) => !known.has(message.id));
  if (fresh.length === 0) return current;
  return [...(current || []), ...fresh].sort((a, b) => a.seq - b.seq);
};

const lastSeqOf = (discussion) =>
  (discussion?.messages || []).reduce((max, message) => Math.max(max, message.seq || 0), 0);

// Порядок виступів зсувається щораунду — так само, як на сервері.
const rotate = (list, round) => {
  if (list.length === 0) return list;
  const shift = (Math.max(1, round) - 1) % list.length;
  return [...list.slice(shift), ...list.slice(0, shift)];
};



export default function ChatPage() {
  const { id } = useParams();
  const [discussion, setDiscussion] = useState(null);
  const [personas, setPersonas] = useState([]);
  const [models, setModels] = useState([]);
  const [defaultModel, setDefaultModel] = useState('');
  const [activeSlug, setActiveSlug] = useState('');
  const [scrollState, setScrollState] = useState({ overflow: false, left: false, right: false });
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
  const participantListRef = useRef(null);
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

  const messages = discussion?.messages;
  const questionMessage = useMemo(
    () => (messages || []).find((message) => message.role === 'user'),
    [messages]
  );
  const visibleMessages = useMemo(
    () => (messages || []).filter((message) => message !== questionMessage),
    [messages, questionMessage]
  );

  const sourcesById = useMemo(
    () => new Map((discussion?.sources || []).map((source) => [source.id, source])),
    [discussion?.sources]
  );

  const personaInfo = useMemo(
    () => new Map(personas.map((persona) => [persona.slug, persona])),
    [personas]
  );

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
          || personaInfo.get(persona.slug)?.name
          || t.fallbackParticipant(index + 1),
        role: personaInfo.get(persona.slug)?.name || '',
        model: persona.model || defaultModel || '',
        traits: Array.isArray(persona.traits) ? persona.traits : [],
        color: TRAIT_COLORS[index % TRAIT_COLORS.length],
      })),
    [discussion?.personas, defaultModel, personaInfo]
  );

  const participantColors = useMemo(
    () => new Map(participantEntries.map((participant) => [participant.key, participant.color])),
    [participantEntries]
  );

  const activeParticipant =
    participantEntries.find((participant) => participant.key === activeSlug)
    || participantEntries[0];
  const activeTraits = activeParticipant?.traits || [];

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
    () => participantEntries.map((participant) => participant.label),
    [participantEntries]
  );

  // Етапи дискусії: вступ і відповіді на Devil — паралельні, тож це один етап.
  // Після раннього консенсусу раунди, які пропустили, не показуємо.
  const plannedRounds = discussion?.early_stop
    ? Number(discussion?.current_round) || 1
    : Math.max(1, Number(discussion?.rounds) || 1);
  const hasResearch = Boolean(discussion?.web_search);

  const stagePlan = useMemo(() => {
    if (participantNames.length === 0) return [];
    const stages = hasResearch ? [t.stageResearch, t.stageOpening] : [t.stageOpening];
    for (let round = 1; round <= plannedRounds; round += 1) {
      rotate(participantNames, round).forEach((name) => stages.push(t.stageRound(round, name)));
    }
    stages.push(t.stageSynthesis, t.stageDevil, t.stageRebuttal, t.stageFinal);
    return stages;
  }, [participantNames, plannedRounds, hasResearch]);

  const currentStage = useMemo(() => {
    if (!discussion) return 0;
    const offset = hasResearch ? 1 : 0;
    const debateStart = offset + 1;
    const afterDebate = debateStart + plannedRounds * participantNames.length;
    switch (discussion.phase) {
      case 'research':
        return 0;
      case 'opening':
        return offset;
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
  }, [discussion, plannedRounds, participantNames.length, stagePlan.length, hasResearch]);

  const traceSteps = stagePlan.slice(
    0,
    isFinished ? stagePlan.length : Math.min(currentStage + 1, stagePlan.length)
  );
  const pendingMessage =
    revealedCount < visibleMessages.length ? visibleMessages[revealedCount] : null;
  const typingMessage = pendingMessage && pendingMessage.role !== 'user' ? pendingMessage : null;
  const isRevealing = Boolean(typingMessage);
  const shownMessages = visibleMessages.slice(0, revealedCount + 1);
  // поки репліка друкується, індикатор «Аналізуємо…» лише відволікав би
  // після завершення рядок «Готово» не потрібен — підсумок говорить сам за себе
  const showThoughtLine = stagePlan.length > 0 && !isRevealing && isRunning && !isFinished;

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

  const handleTypingDone = useCallback(() => {
    setRevealedCount((count) => count + 1);
    setSkipTyping(false);
  }, []);

  useEffect(() => {
    if (stickToBottomRef.current) scrollToBottom();
  }, [scrollToBottom, revealedCount, isRunning, actionError, isStopped, isRevealing]);

  // Поки йде генерація, вміст росте плавно (поява абзаців, висота бульбашки),
  // тож низ відстежується щокадру, а не за окремими подіями.
  useEffect(() => {
    if (!isRunning && !isRevealing) return undefined;
    let frame = 0;
    const tick = () => {
      const el = mainRef.current;
      if (el && stickToBottomRef.current && el.scrollHeight - el.clientHeight - el.scrollTop > 1) {
        el.scrollTop = el.scrollHeight;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [isRunning, isRevealing]);

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

  useEffect(() => {
    if (isRunning) setAnimateSummary(true);
  }, [isRunning]);

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
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
    setFlashId(messageId);
  };

  useEffect(() => {
    if (!flashId) return undefined;
    const timer = setTimeout(() => setFlashId(null), 1600);
    return () => clearTimeout(timer);
  }, [flashId]);

  const handleJumpToDecision = () => {
    const el = mainRef.current;
    if (!el) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const summaryEl = summaryRef.current;
    const top = summaryEl
      ? el.scrollTop + summaryEl.getBoundingClientRect().top - el.getBoundingClientRect().top - 16
      : el.scrollHeight;
    if (!summaryEl) stickToBottomRef.current = true;
    el.scrollTo({ top, behavior: reduced ? 'auto' : 'smooth' });
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
  const canSendNote =
    Boolean(discussion) && !isSending && note.trim().length > 0 && (!isFinished || followupsLeft > 0);
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

  const speakers = useMemo(() => {
    const map = new Map();
    let index = 0;
    (messages || []).forEach((message) => {
      const key = speakerKeyOf(message);
      if (map.has(key)) return;
      if (message.role === 'devil') {
        map.set(key, { color: DEVIL_COLOR, side: 'right' });
      } else if (message.role === 'moderator') {
        map.set(key, { color: MODERATOR_COLOR, side: 'left' });
      } else if (message.role === 'research') {
        map.set(key, { color: RESEARCH_COLOR, side: 'left' });
      } else if (message.role === 'user') {
        map.set(key, { color: USER_COLOR, side: 'right' });
      } else {
        map.set(key, {
          color:
            participantColors.get(message.persona_slug) ||
            TRAIT_COLORS[index % TRAIT_COLORS.length],
          side: index % 2 === 0 ? 'left' : 'right',
        });
        index += 1;
      }
    });
    return map;
  }, [messages, participantColors]);

  const summary = discussion?.final_summary || null;
  const summaryDecision = summary?.decision ? String(summary.decision) : '';
  const summaryConfirmed = typeof summary?.confirmed === 'boolean' ? summary.confirmed : null;
  const summaryConfidence = Number.isFinite(Number(summary?.confidence))
    && summary?.confidence !== null
    ? Math.max(0, Math.min(100, Math.round(Number(summary.confidence))))
    : null;
  const agreement = summary?.agreement?.total ? summary.agreement : null;
  const summaryLists = [
    { key: 'pros', title: t.summaryPros, items: listOf(summary?.pros) },
    { key: 'cons', title: t.summaryCons, items: listOf(summary?.cons) },
    { key: 'risks', title: t.summaryRisks, items: listOf(summary?.risks) },
    { key: 'dissent', title: t.summaryDissent, items: listOf(summary?.dissenting_points) },
  ].filter((list) => list.items.length > 0);

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

  // Частини результату проявляються по черзі, як абзаци реплік
  let summaryIndex = 0;
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
      <aside className="debate__form-panel chat__sidebar" id="chat-settings">
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
              {activeParticipant?.role && (
                <p className="debate__hint">{t.role(activeParticipant.role)}</p>
              )}
            </section>

            <section className="debate__section">
              <h2 className="debate__section-title">{d.aiModel}</h2>
              <ModelPicker
                models={models}
                value={activeParticipant?.model || ''}
                onChange={(modelId) =>
                  saveModels({ personas: [{ slug: activeParticipant.key, model: modelId }] })
                }
                disabled={!canEditModels || !activeParticipant}
              />
            </section>

            <section className="debate__section">
              <h2 className="debate__section-title">{d.character}</h2>
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

            <section className="debate__advanced" ref={advancedRef}>
              <button
                type="button"
                className={`debate__advanced-toggle ${isAdvancedOpen ? 'debate__advanced-toggle--open' : ''}`}
                onClick={() => setIsAdvancedOpen((open) => !open)}
                aria-expanded={isAdvancedOpen}
                aria-haspopup="dialog"
                aria-controls="chat-advanced"
              >
                <span className="debate__advanced-heading">
                  <span className="debate__section-title">{d.advanced}</span>
                  {(discussion.moderator_model || discussion.devil_model) && (
                    <span className="debate__advanced-summary">{d.judgesCustomized}</span>
                  )}
                </span>
                <span className="debate__model-chevron">
                  <ChevronIcon />
                </span>
              </button>
              <div
                id="chat-advanced"
                className={`debate__advanced-body ${isAdvancedOpen ? 'debate__advanced-body--open' : ''}`}
                inert={!isAdvancedOpen}
                aria-hidden={!isAdvancedOpen}
                role="dialog"
                aria-label={d.advanced}
              >
                <h3 className="debate__advanced-group">{d.advancedGeneral}</h3>
                <span className="debate__field-label">{d.moderatorModel}</span>
                <ModelPicker
                  models={models}
                  value={discussion.moderator_model || ''}
                  onChange={(modelId) => saveModels({ moderatorModel: modelId })}
                  disabled={!canEditModels}
                  label={d.moderatorModel}
                  autoLabel={d.autoModel}
                  compact
                />
                <span className="debate__field-label">{d.devilModel}</span>
                <ModelPicker
                  models={models}
                  value={discussion.devil_model || ''}
                  onChange={(modelId) => saveModels({ devilModel: modelId })}
                  disabled={!canEditModels}
                  label={d.devilModel}
                  autoLabel={d.autoModel}
                  compact
                />
                <p className="debate__hint">{d.judgesHint}</p>
              </div>
            </section>
          </>
        )}
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
            <header className="chat__prompt">
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

          {shownMessages.map((message, index) => {
            const speakerKey = speakerKeyOf(message);
            const { color, side } = speakers.get(speakerKey) || { color: USER_COLOR, side: 'left' };
            const typing = message === typingMessage;
            const authorName =
              (message.role === 'ai' && customNames.get(message.persona_slug))
              || message.persona_name;
            const stance = message.role === 'ai' ? stanceText(message.stance) : '';
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
                      <AvatarIcon />
                    </span>
                    <div className="chat__body">
                      {!grouped && (
                        <div className="chat__head">
                          <span className="chat__name">{authorName}</span>
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
              </Fragment>
            );
          })}

          {summaryDecision && isFinished && !isRevealing && (
            <section
              className={`chat__summary ${animateSummary ? 'chat__summary--enter' : ''}`}
              ref={summaryRef}
              aria-label={t.summary}
            >
              {summary?.answer && (
                <div className="chat__summary-item" style={summaryStep()}>
                  <span className="chat__summary-label">{t.summaryAnswer}</span>
                  <p>
                    <InlineText text={String(summary.answer)} sources={sourcesById} />
                  </p>
                </div>
              )}
              <div className="chat__summary-item" style={summaryStep()}>
                <span className="chat__summary-label">{t.summaryDecision}</span>
                <p>
                  <InlineText text={summaryDecision} sources={sourcesById} />
                </p>
              </div>
              {summaryConfirmed === false && summary?.revision && (
                <div className="chat__summary-item" style={summaryStep()}>
                  <span className="chat__summary-label">{t.summaryRevision}</span>
                  <p>
                    <InlineText text={String(summary.revision)} sources={sourcesById} />
                  </p>
                </div>
              )}
              {(agreement || summaryConfidence !== null) && (
                <div className="chat__summary-meta" style={summaryStep()}>
                  {agreement && (
                    <div className="chat__summary-item">
                      <span className="chat__summary-label">{t.summaryAgreement}</span>
                      <p>{t.summaryAgreementValue(agreement.agree, agreement.total)}</p>
                    </div>
                  )}
                  {summaryConfidence !== null && (
                    <div className="chat__summary-item" title={t.summaryConfidenceHint}>
                      <span className="chat__summary-label">{t.summaryConfidence}</span>
                      <p>{summaryConfidence}%</p>
                    </div>
                  )}
                </div>
              )}
              {summaryLists.length > 0 && (
                <table className="chat__summary-table">
                  <tbody>
                    {summaryLists.map(({ key, title, items }) => (
                      <tr key={key} style={summaryStep()}>
                        <th scope="row">
                          <span className="chat__summary-label">{title}</span>
                        </th>
                        <td>
                          <ul>
                            {items.map((item, itemIndex) => (
                              <li key={`${key}-${itemIndex}`}>
                                <InlineText text={item} sources={sourcesById} />
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {summary?.recommendation && (
                <div className="chat__summary-item" style={summaryStep()}>
                  <span className="chat__summary-label">{t.summaryNextStep}</span>
                  <p>
                    <InlineText text={String(summary.recommendation)} sources={sourcesById} />
                  </p>
                </div>
              )}
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
              <textarea
                ref={noteRef}
                className="debate__composer-input"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={handleNoteKeyDown}
                maxLength={MAX_NOTE}
                rows={1}
                placeholder={isFinished ? t.followupPlaceholder : t.notePlaceholder}
                disabled={isSending || (isFinished && followupsLeft === 0)}
                aria-label={isFinished ? t.followupPlaceholder : t.notePlaceholder}
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
