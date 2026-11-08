import { memo, useLayoutEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  ArrowTurnBackwardIcon,
  Copy01Icon,
  HighlighterIcon,
  Search01Icon,
  Tick02Icon,
} from '@hugeicons/core-free-icons';
import MessageMarkdown, { InlineText } from '../MessageMarkdown';
import ParagraphReveal from '../ParagraphReveal';
import ThoughtLine from '../ThoughtLine';
import { SourceList } from './Sources';
import { STILL_GLYPH } from './thoughtGlyphs';
import { copy } from '../../copy';
import { roleIcon } from '../../utils/debateOptions';
import { parseBlocks } from '../../utils/markdown';
import { messageSources, modelNameOf, snippetOf } from '../../utils/chatMessages';
import {
  USER_COLOR,
  phaseLabel,
  speakerKeyOf,
  stanceLabel,
  stanceTone,
} from '../../utils/chatView';
import AttachmentChip from '../AttachmentChip';
import MarkMenu from './MarkMenu';
import { highlightAtPoint, locateHighlights, paintHighlights } from '../../utils/highlights';

const t = copy.chat;
const m = copy.marks;
export const MARKABLE_ROLES = ['ai', 'moderator', 'devil'];
const NO_HIGHLIGHTS = [];
// довша за це репліка одразу займає всю ширину, щоб не розширюватися під час появи
const WIDE_MESSAGE = 160;

/**
 * Одна репліка чату з роздільником етапу над нею й рядком «Аналізовано за …»
 * під останньою реплікою запуску. `typing` — репліка саме «друкується»,
 * `streamed` — її текст уже показали чернеткою, тож друкувати вдруге не треба;
 * `message.draft` — модель ще пише цю репліку. `previous` — репліка над цією,
 * `replyTarget` — та, на яку відповідають.
 *
 * Обгорнута в memo: чат опитує сервер щосекунди-дві й перемальовується з кожною
 * літерою в полі вводу, а незмінні репліки при цьому не рендеряться заново.
 */
function ChatMessage({
  message,
  previous,
  replyTarget = null,
  speakers,
  typing = false,
  streamed = false,
  skipTyping = false,
  onTypingDone,
  onSkipTyping,
  models,
  discussion,
  customNames,
  compact = false,
  expanded = false,
  onExpand,
  sourcesById,
  copiedId = null,
  onCopy,
  flashed = false,
  onJump,
  userAvatar,
  runRecord,
  onReact,
  onOpenHighlight,
  onExplain,
  onReportWrong,
  onShowMarks,
  tip = null,
}) {
  const speakerKey = speakerKeyOf(message);
  const { color, side } = speakers.get(speakerKey) || { color: USER_COLOR, side: 'left' };
  const draft = Boolean(message.draft);
  const authorName =
    (message.role === 'ai' && customNames.get(message.persona_slug)) || message.persona_name;
  const messageModel =
    message.role === 'user' ? '' : modelNameOf(models, message.model_id);
  const searched = message.search_query || '';
  const divider = phaseLabel(message);
  const showDivider =
    divider
    && message.role !== 'user'
    && (!previous || phaseLabel(previous) !== divider);
  const showEarlyStop =
    showDivider
    && message.phase === 'synthesis'
    && (discussion?.early_stop || discussion?.until_consensus);
  // кілька реплік поспіль від одного автора — як у месенджері, без повтору імені
  const grouped =
    !showDivider && previous && speakerKeyOf(previous) === speakerKey && previous.role !== 'research';
  const replyName = message.reply_to
    ? customNames.get(message.reply_to_slug) || message.reply_to
    : '';
  const stance =
    message.role === 'ai' ? stanceLabel(message, discussion?.mode, replyName) : '';
  const collapsed =
    compact
    && !typing
    && !draft
    && message.role === 'ai'
    && message.thesis
    && !expanded;
  const replyColor = replyTarget
    ? speakers.get(speakerKeyOf(replyTarget))?.color
    : undefined;
  const text = draft ? (
    <MessageMarkdown blocks={parseBlocks(message.content)} sources={sourcesById}>
      <span className="chat__pending chat__pending--short" aria-hidden="true">
        <span />
      </span>
    </MessageMarkdown>
  ) : typing ? (
    <ParagraphReveal
      key={message.id}
      content={message.content}
      skip={skipTyping || streamed}
      onDone={onTypingDone}
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
        onClick={() => onExpand(message.id)}
      >
        {t.expandMessage}
      </button>
    </div>
  ) : (
    <MessageMarkdown blocks={parseBlocks(message.content)} sources={sourcesById} />
  );
  const ownSources = typing || draft ? [] : messageSources(message, sourcesById);
  // позначки й виділення — лише для готових реплік AI у власній дискусії
  const markable =
    Boolean(onReact) && MARKABLE_ROLES.includes(message.role) && !typing && !draft && Boolean(message.id);
  const highlights = (markable && message.highlights) || NO_HIGHLIGHTS;
  const contentRef = useRef(null);
  const locatedRef = useRef([]);

  // знаходимо виділення в показаному тексті й віддаємо їх спільній підсвітці;
  // у стислому вигляді (лише тези) повного тексту немає — тоді й підсвічувати нічого
  useLayoutEffect(() => {
    const key = message.id;
    if (!markable || collapsed || !contentRef.current || !highlights.length) {
      locatedRef.current = [];
      paintHighlights(key, []);
      return undefined;
    }
    locatedRef.current = locateHighlights(contentRef.current, highlights);
    paintHighlights(key, locatedRef.current);
    return () => paintHighlights(key, []);
  }, [markable, collapsed, highlights, message.id, message.content]);

  // клік по вже виділеному фрагменту відкриває його: значення, нотатка, «Прибрати»
  const handleContentClick = (event) => {
    if (!markable || !onOpenHighlight || !locatedRef.current.length) return;
    const selection = window.getSelection?.();
    if (selection && !selection.isCollapsed) return;
    const found = highlightAtPoint(contentRef.current, locatedRef.current, event.clientX, event.clientY);
    if (!found) return;
    const item = locatedRef.current.find((entry) => entry.highlight.id === found.id);
    onOpenHighlight(message, found, item?.range.getBoundingClientRect() || null);
  };
  const copyStatus =
    copiedId === message.id ? 'done' : copiedId === `error-${message.id}` ? 'error' : '';
  const copyMessageLabel =
    copyStatus === 'done' ? t.copied : copyStatus === 'error' ? t.copyError : t.copyMessage;
  return (
    <>
      {showEarlyStop && (
        <p className="chat__notice">
          {!discussion.until_consensus
            ? t.earlyStop(discussion.current_round)
            : discussion.early_stop
              ? t.consensusReached(discussion.current_round)
              : t.consensusMissed(discussion.current_round)}
        </p>
      )}
      {showDivider && (
        <div className="chat__divider" role="separator">
          <span>{divider}</span>
        </div>
      )}
      {message.role === 'research' ? (
        <div
          className={`chat__system ${typing ? 'chat__row--enter' : ''}`}
          onClick={typing ? onSkipTyping : undefined}
        >
          <HugeiconsIcon icon={Search01Icon} size={14} className="chat__system-icon" />
          {text}
        </div>
      ) : (
        <div
          id={message.id && !draft ? `message-${message.id}` : undefined}
          className={[
            'chat__row',
            `chat__row--${side}`,
            `chat__row--${message.role}`,
            grouped && 'chat__row--grouped',
            ((typing && !streamed) || draft) && 'chat__row--enter',
            flashed && 'chat__row--flash',
          ].filter(Boolean).join(' ')}
        >
          <span
            className="chat__avatar"
            style={{ '--avatar': color }}
            aria-hidden="true"
          >
            {/* іконка ролі розрізняє учасників не лише кольором — та сама, що в складі команди */}
            {message.role === 'user' ? (
              userAvatar
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
                typing && !streamed && 'chat__bubble--typing',
                draft && 'chat__bubble--draft',
                (message.content || '').length > WIDE_MESSAGE && 'chat__bubble--wide',
              ].filter(Boolean).join(' ')}
              style={{ '--bubble': color }}
              onClick={typing ? onSkipTyping : undefined}
              title={typing ? t.skipTyping : undefined}
            >
              {replyName && (
                <button
                  type="button"
                  className="chat__quote"
                  style={replyColor ? { '--quote': replyColor } : undefined}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (replyTarget) onJump(replyTarget.id);
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
              <div
                ref={contentRef}
                className="chat__content"
                data-marks-root={markable ? message.id : undefined}
                onClick={markable ? handleContentClick : undefined}
              >
                {text}
              </div>
            </div>
            {/* файли, додані до уточнення, — під ним, як під самим питанням */}
            {message.attachments?.length > 0 && (
              <div className="chat__attachments" role="list" aria-label={t.attachments}>
                {message.attachments.map((file) => (
                  <span key={file.id} role="listitem">
                    <AttachmentChip name={file.name} kind={file.kind} title={file.preview || file.name} />
                  </span>
                ))}
              </div>
            )}
            {!typing && !draft && (
              <div className="chat__actions">
                <button
                  type="button"
                  className="chat__icon-button chat__copy"
                  onClick={() => onCopy(message)}
                  aria-label={copyMessageLabel}
                  title={copyMessageLabel}
                >
                  <HugeiconsIcon icon={copyStatus === 'done' ? Tick02Icon : Copy01Icon} size={16} />
                </button>
                {markable && (
                  <MarkMenu
                    mark={message.reaction || ''}
                    onChange={(next) => onReact(message, next)}
                    onExplain={onExplain ? () => onExplain(message) : undefined}
                    onReport={onReportWrong ? () => onReportWrong(message) : undefined}
                  />
                )}
                {highlights.length > 0 && (
                  <button
                    type="button"
                    className="chat__marks-count"
                    onClick={() => onShowMarks?.(message.id)}
                    title={m.panelTitle}
                  >
                    <HugeiconsIcon icon={HighlighterIcon} size={14} aria-hidden="true" />
                    {m.hasHighlights(highlights.length)}
                  </button>
                )}
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
            {markable && tip}
          </div>
        </div>
      )}
      {!typing && !draft && runRecord && (
        <ThoughtLine
          working={false}
          steps={runRecord.steps}
          elapsed={runRecord.seconds}
          label={t.advancing}
          doneLabel={t.thoughtDone}
          glyph={STILL_GLYPH}
          fontSize={16}
          className="chat__thought chat__thought--done"
        />
      )}
    </>
  );
}

ChatMessage.propTypes = {
  message: PropTypes.object.isRequired,
  previous: PropTypes.object,
  replyTarget: PropTypes.object,
  speakers: PropTypes.instanceOf(Map).isRequired,
  typing: PropTypes.bool,
  streamed: PropTypes.bool,
  skipTyping: PropTypes.bool,
  onTypingDone: PropTypes.func,
  onSkipTyping: PropTypes.func,
  models: PropTypes.arrayOf(PropTypes.object).isRequired,
  discussion: PropTypes.object,
  customNames: PropTypes.instanceOf(Map).isRequired,
  compact: PropTypes.bool,
  expanded: PropTypes.bool,
  onExpand: PropTypes.func,
  sourcesById: PropTypes.instanceOf(Map).isRequired,
  copiedId: PropTypes.string,
  onCopy: PropTypes.func,
  flashed: PropTypes.bool,
  onJump: PropTypes.func,
  userAvatar: PropTypes.node,
  runRecord: PropTypes.shape({
    steps: PropTypes.arrayOf(PropTypes.string),
    seconds: PropTypes.number,
  }),
  onReact: PropTypes.func,
  onOpenHighlight: PropTypes.func,
  onExplain: PropTypes.func,
  onReportWrong: PropTypes.func,
  onShowMarks: PropTypes.func,
  tip: PropTypes.node,
};

export default memo(ChatMessage);
