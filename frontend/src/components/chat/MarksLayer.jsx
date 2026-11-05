import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import PropTypes from 'prop-types';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  BubbleChatQuestionIcon,
  Copy01Icon,
  Delete02Icon,
  NoteEditIcon,
  Tick02Icon,
} from '@hugeicons/core-free-icons';
import { copy } from '../../copy';
import { HIGHLIGHT_COLORS, describeSelection, shortQuote } from '../../utils/highlights';

const t = copy.marks;
const EDGE = 8;
const GAP = 10;
// поки людина тягне виділення, панель не смикаємо — чекаємо, доки вона відпустить
const SETTLE_MS = 220;

const isCoarse = () => Boolean(window.matchMedia?.('(pointer: coarse)').matches);

const rootOf = (node) => {
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  return element?.closest?.('[data-marks-root]') || null;
};

/**
 * Над прямокутником (на телефоні — під ним, щоб не накрити системне меню виділення),
 * у межах екрана.
 */
const placeNear = (rect, box, preferBelow) => {
  if (!box) return null;
  const width = box.offsetWidth;
  const height = box.offsetHeight;
  // фрагмента не видно (відкрили з «Моїх позначок» у стислому вигляді) — по центру екрана
  if (!rect || (!rect.width && !rect.height)) {
    return {
      top: Math.max(EDGE, (window.innerHeight - height) / 2),
      left: Math.max(EDGE, (window.innerWidth - width) / 2),
    };
  }
  const above = rect.top - GAP - height;
  const below = rect.bottom + GAP;
  const fitsAbove = above >= EDGE;
  const fitsBelow = below + height <= window.innerHeight - EDGE;
  const top = (preferBelow ? fitsBelow || !fitsAbove : !fitsAbove && fitsBelow)
    ? Math.min(below, window.innerHeight - EDGE - height)
    : Math.max(EDGE, above);
  const center = rect.left + rect.width / 2;
  const left = Math.max(EDGE, Math.min(center - width / 2, window.innerWidth - EDGE - width));
  return { top, left };
};

function ColorDot({ color }) {
  return <span className={`marks__dot marks__dot--${color}`} aria-hidden="true" />;
}

ColorDot.propTypes = { color: PropTypes.string.isRequired };

/**
 * Панель над виділеним текстом репліки AI: три значення виділення, нотатка,
 * «Спитати» й «Копіювати». Та сама панель, розгорнута, — редактор уже
 * виділеного фрагмента (клік по ньому в репліці чи в «Моїх позначках»).
 */
export default function MarksLayer({ editing, locate, onCloseEdit, onCreate, onUpdate, onDelete, onAsk }) {
  const [pending, setPending] = useState(null);
  const [copied, setCopied] = useState(false);
  const [place, setPlace] = useState(null);
  // портал — усередину .app-shell, щоб діяли змінні теми
  const host = document.querySelector('.app-shell') || document.body;
  const boxRef = useRef(null);
  const pointerDownRef = useRef(false);
  const timerRef = useRef(null);
  const noteId = useId();

  const readSelection = useCallback(() => {
    const selection = window.getSelection?.();
    if (!selection || selection.isCollapsed || !selection.rangeCount) {
      setPending(null);
      return;
    }
    const range = selection.getRangeAt(0);
    const root = rootOf(range.startContainer);
    // лише в межах однієї репліки: фрагмент, що зачепив дві, не прив'язати до жодної
    if (!root || root !== rootOf(range.endContainer)) {
      setPending(null);
      return;
    }
    const info = describeSelection(root, range);
    if (!info) {
      setPending(null);
      return;
    }
    const rects = range.getClientRects();
    // на кілька рядків — прив'язуємось до першого рядка (зверху) чи останнього (знизу)
    const rect = isCoarse() ? rects[rects.length - 1] : rects[0];
    setPending({ messageId: root.dataset.marksRoot, info, rect: rect || range.getBoundingClientRect() });
  }, []);

  useEffect(() => {
    const schedule = () => {
      clearTimeout(timerRef.current);
      if (pointerDownRef.current) return;
      timerRef.current = setTimeout(readSelection, SETTLE_MS);
    };
    const down = (e) => {
      if (boxRef.current?.contains(e.target)) return;
      pointerDownRef.current = true;
    };
    const up = () => {
      if (!pointerDownRef.current) return;
      pointerDownRef.current = false;
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(readSelection, 10);
    };
    const reposition = () => {
      if (window.getSelection?.()?.isCollapsed === false) readSelection();
    };
    document.addEventListener('selectionchange', schedule);
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointerup', up, true);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      clearTimeout(timerRef.current);
      document.removeEventListener('selectionchange', schedule);
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointerup', up, true);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [readSelection]);

  const mode = editing ? 'edit' : pending ? 'new' : null;
  const editMessageId = editing?.message.id;
  const editHighlight = editing?.highlight;

  // редактор тримається біля свого фрагмента й тоді, коли чат прокручують
  useLayoutEffect(() => {
    if (!mode) return undefined;
    if (mode === 'new') {
      setPlace(placeNear(pending.rect, boxRef.current, isCoarse()));
      return undefined;
    }
    const update = () => setPlace(placeNear(locate(editMessageId, editHighlight), boxRef.current, false));
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [mode, pending, locate, editMessageId, editHighlight]);

  // Escape і клік поза панеллю закривають її
  useEffect(() => {
    if (!mode) return undefined;
    const handleKey = (e) => {
      if (e.key !== 'Escape') return;
      if (mode === 'edit') onCloseEdit();
      else {
        setPending(null);
        window.getSelection?.()?.removeAllRanges();
      }
    };
    const handleDown = (e) => {
      if (mode === 'edit' && !boxRef.current?.contains(e.target)) onCloseEdit();
    };
    document.addEventListener('keydown', handleKey);
    document.addEventListener('mousedown', handleDown);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleDown);
    };
  }, [mode, onCloseEdit]);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  const clearSelection = () => {
    setPending(null);
    window.getSelection?.()?.removeAllRanges();
  };

  const create = async (color, withNote = false) => {
    if (!pending) return;
    const { messageId, info } = pending;
    clearSelection();
    await onCreate(messageId, info, color, withNote);
  };

  const copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  if (!mode || !host) return null;

  // кнопки не забирають виділення: mousedown на них не скидає його
  const keepSelection = (e) => e.preventDefault();
  const style = place ? { top: place.top, left: place.left } : { top: -9999, left: -9999 };

  if (mode === 'new') {
    return createPortal(
      <div
        ref={boxRef}
        className="marks__toolbar"
        role="toolbar"
        aria-label={t.toolbarLabel}
        style={style}
        onMouseDown={keepSelection}
      >
        {HIGHLIGHT_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            className="marks__tool"
            onClick={() => create(color)}
            aria-label={t.highlightAs(t.colors[color])}
            title={t.highlightAs(t.colors[color])}
          >
            <ColorDot color={color} />
            <span className="marks__tool-label">{t.colors[color]}</span>
          </button>
        ))}
        <span className="marks__divider" aria-hidden="true" />
        <button
          type="button"
          className="marks__tool marks__tool--icon"
          onClick={() => create('important', true)}
          aria-label={t.noteLabel}
          title={t.noteLabel}
        >
          <HugeiconsIcon icon={NoteEditIcon} size={18} aria-hidden="true" />
        </button>
        {onAsk && (
          <button
            type="button"
            className="marks__tool marks__tool--icon"
            onClick={() => {
              const { messageId, info } = pending;
              clearSelection();
              onAsk(messageId, info.quote);
            }}
            aria-label={t.askAria}
            title={t.askAria}
          >
            <HugeiconsIcon icon={BubbleChatQuestionIcon} size={18} aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          className="marks__tool marks__tool--icon"
          onClick={() => copyText(pending.info.quote)}
          aria-label={copied ? t.copied : t.copy}
          title={copied ? t.copied : t.copy}
        >
          <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} size={18} aria-hidden="true" />
        </button>
      </div>,
      host
    );
  }

  const { message, highlight } = editing;
  return createPortal(
    <HighlightEditor
      key={highlight.id}
      boxRef={boxRef}
      style={style}
      highlight={highlight}
      noteId={noteId}
      focusNote={Boolean(editing.focusNote)}
      copied={copied}
      onColor={(color) => onUpdate(message, highlight, { color })}
      onSaveNote={(note) => onUpdate(message, highlight, { note })}
      onDelete={() => {
        onCloseEdit();
        onDelete(message, highlight);
      }}
      onAsk={onAsk ? () => {
        onCloseEdit();
        onAsk(message.id, highlight.quote);
      } : undefined}
      onCopy={() => copyText(highlight.quote)}
      onClose={onCloseEdit}
    />,
    host
  );
}

function HighlightEditor({
  boxRef,
  style,
  highlight,
  noteId,
  focusNote,
  copied,
  onColor,
  onSaveNote,
  onDelete,
  onAsk,
  onCopy,
  onClose,
}) {
  const [note, setNote] = useState(highlight.note || '');
  const noteRef = useRef(null);
  const firstRef = useRef(null);
  const changed = note.trim() !== (highlight.note || '');

  // фокус — у нотатку, якщо її просили додати, інакше на вибране значення
  useEffect(() => {
    const target = focusNote ? noteRef.current : firstRef.current;
    target?.focus({ preventScroll: true });
  }, [focusNote]);

  const save = (e) => {
    e?.preventDefault();
    if (changed) onSaveNote(note.trim());
    onClose();
  };

  return (
    <form
      ref={boxRef}
      className="marks__editor"
      role="dialog"
      aria-label={t.editLabel}
      style={style}
      onSubmit={save}
    >
      <p className={`marks__quote marks__quote--${highlight.color}`}>«{shortQuote(highlight.quote, 160)}»</p>
      <div className="marks__colors" role="radiogroup" aria-label={t.editLabel}>
        {HIGHLIGHT_COLORS.map((color) => {
          const active = highlight.color === color;
          return (
            <button
              key={color}
              ref={active ? firstRef : undefined}
              type="button"
              role="radio"
              aria-checked={active}
              className={`marks__color ${active ? 'marks__color--active' : ''}`}
              onClick={() => !active && onColor(color)}
            >
              <ColorDot color={color} />
              {t.colors[color]}
            </button>
          );
        })}
      </div>
      <label className="marks__note-label" htmlFor={noteId}>{t.noteLabel}</label>
      <textarea
        ref={noteRef}
        id={noteId}
        className="marks__note"
        rows={2}
        maxLength={500}
        value={note}
        placeholder={t.notePlaceholder}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) save(e);
        }}
      />
      <div className="marks__editor-actions">
        <button type="button" className="marks__icon" onClick={onDelete} aria-label={t.remove} title={t.remove}>
          <HugeiconsIcon icon={Delete02Icon} size={18} aria-hidden="true" />
        </button>
        <button type="button" className="marks__icon" onClick={onCopy} aria-label={copied ? t.copied : t.copy} title={copied ? t.copied : t.copy}>
          <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} size={18} aria-hidden="true" />
        </button>
        {onAsk && (
          <button type="button" className="marks__icon" onClick={onAsk} aria-label={t.askAria} title={t.askAria}>
            <HugeiconsIcon icon={BubbleChatQuestionIcon} size={18} aria-hidden="true" />
          </button>
        )}
        <button type="submit" className="marks__save">
          {t.noteSave}
        </button>
      </div>
    </form>
  );
}

HighlightEditor.propTypes = {
  boxRef: PropTypes.object.isRequired,
  style: PropTypes.object.isRequired,
  highlight: PropTypes.object.isRequired,
  noteId: PropTypes.string.isRequired,
  focusNote: PropTypes.bool,
  copied: PropTypes.bool,
  onColor: PropTypes.func.isRequired,
  onSaveNote: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
  onAsk: PropTypes.func,
  onCopy: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};

MarksLayer.propTypes = {
  editing: PropTypes.shape({
    message: PropTypes.object.isRequired,
    highlight: PropTypes.object.isRequired,
    focusNote: PropTypes.bool,
  }),
  // де зараз на екрані фрагмент: (messageId, highlight) => DOMRect | null
  locate: PropTypes.func.isRequired,
  onCloseEdit: PropTypes.func.isRequired,
  onCreate: PropTypes.func.isRequired,
  onUpdate: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
  onAsk: PropTypes.func,
};
