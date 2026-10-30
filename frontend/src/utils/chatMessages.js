import { citedIds, plainText } from './markdown';

// Стан чату: злиття опитувань, чернетки, кроки індикатора «Аналізуємо…».

const CITATION_RE = /(\[\d+\])/g;

export const modelNameOf = (models, id) => {
  const model = models.find((item) => item.id === id);
  return model ? model.label || model.model : '';
};

// Колонка карти позицій: вступ, раунд або відповідь на Devil (після
// уточнення синтез і Devil проходять ще раз, тож відповідей може бути кілька).
export const snippetOf = (content) =>
  plainText(content).replace(CITATION_RE, '').replace(/\s+/g, ' ').trim().slice(0, 220);

// Джерела, які стосуються репліки: додані її пошуком і процитовані в тексті
export const messageSources = (message, sourcesById) => {
  const ids = [...(message.source_ids || []), ...citedIds(message.content)];
  return [...new Set(ids)].map((sourceId) => sourcesById.get(sourceId)).filter(Boolean);
};

export const mergeMessages = (current, incoming) => {
  if (!incoming?.length) return current || [];
  const known = new Set((current || []).map((message) => message.id));
  const fresh = incoming.filter((message) => !known.has(message.id));
  if (fresh.length === 0) return current;
  return [...(current || []), ...fresh].sort((a, b) => a.seq - b.seq);
};

// Репліки, які моделі ще пишуть, — у вигляді повідомлень для спільного рендеру
export const draftMessagesOf = (discussion) =>
  (discussion?.live?.drafts || []).map((draft) => ({
    id: `draft-${draft.slug}`,
    draft: true,
    role: 'ai',
    persona_slug: draft.slug,
    persona_name: draft.name,
    phase: draft.phase,
    round: draft.round,
    reply_to: draft.reply_to || '',
    reply_to_slug: draft.reply_to_slug || '',
    content: draft.text,
  }));

export const lastSeqOf = (discussion) =>
  (discussion?.messages || []).reduce((max, message) => Math.max(max, message.seq || 0), 0);

// Коротка цитата тези в кроці індикатора — обрізана по слову
export const shortQuote = (text, limit = 60) => {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const cut = clean.length > limit ? `${clean.slice(0, limit - 1).replace(/\s+\S*$/, '')}…` : clean;
  return `«${cut}»`;
};

// Зроблений крок: хто говорив, кому відповідав і з якою тезою
export const doneStep = (message) => {
  const who = message.reply_to ? `${message.persona_name} → ${message.reply_to}` : message.persona_name;
  const thesis = shortQuote(message.thesis);
  return thesis ? `${who} · ${thesis}` : who;
};

// Поточний крок із сервера: над чим саме зараз думає кожен AI
export const thinkingStep = (item) =>
  item.text.startsWith('→') ? `${item.name} ${item.text}` : `${item.name} · ${item.text}`;

// Модератор поставив питання й чекає відповідей — раннер навмисно стоїть
export const awaitsClarify = (data) => data?.phase === 'clarify' && data?.clarify_questions?.length > 0;

// Дискусія ще не завершена, але сервер нічого не виконує — треба запустити раннер
export const isIdle = (data) =>
  !data.is_running
  && !data.is_finished
  && !data.stop_requested
  && data.status !== 'failed'
  && !awaitsClarify(data);
