import PropTypes from 'prop-types';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  ArrowTurnBackwardIcon,
  Copy01Icon,
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
  findReplyTarget,
  phaseLabel,
  speakerKeyOf,
  stanceLabel,
  stanceTone,
} from '../../utils/chatView';

const t = copy.chat;
// довша за це репліка одразу займає всю ширину, щоб не розширюватися під час появи
const WIDE_MESSAGE = 160;

/**
 * Одна репліка чату з роздільником етапу над нею й рядком «Аналізовано за …»
 * під останньою реплікою запуску. `typing` — репліка саме «друкується»,
 * `streamed` — її текст уже показали чернеткою, тож друкувати вдруге не треба;
 * `message.draft` — модель ще пише цю репліку.
 */
export default function ChatMessage({
  message,
  index,
  messages,
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
}) {
  const speakerKey = speakerKeyOf(message);
  const { color, side } = speakers.get(speakerKey) || { color: USER_COLOR, side: 'left' };
  const draft = Boolean(message.draft);
  const authorName =
    (message.role === 'ai' && customNames.get(message.persona_slug)) || message.persona_name;
  const messageModel =
    message.role === 'user' ? '' : modelNameOf(models, message.model_id);
  const searched = message.search_query || '';
  const previous = messages[index - 1];
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
  const replyTarget = findReplyTarget(messages, index);
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
              {text}
            </div>
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
  index: PropTypes.number.isRequired,
  messages: PropTypes.arrayOf(PropTypes.object).isRequired,
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
};
