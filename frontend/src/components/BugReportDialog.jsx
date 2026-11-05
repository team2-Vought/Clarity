import { useEffect, useId, useRef, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Bug02Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  IdeaIcon,
  MoreHorizontalCircle01Icon,
  SparklesIcon,
} from '@hugeicons/core-free-icons';
import { Pills } from './SettingsControls';
import { getSession } from '../api/client';
import { me } from '../api/auth';
import { sendBugReport } from '../api/support';
import { copy } from '../copy';
import { collectContext } from '../utils/diagnostics';
import {
  DESCRIPTION_MAX,
  DESCRIPTION_MIN,
  OPEN_BUG_REPORT_EVENT,
  REPORT_KINDS,
  currentDiscussionId,
  looksLikeEmail,
} from '../utils/bugReport';

const t = copy.report;
const KIND_ICONS = {
  bug: Bug02Icon,
  ai_answer: SparklesIcon,
  idea: IdeaIcon,
  other: MoreHorizontalCircle01Icon,
};

const INITIAL = {
  kind: 'bug',
  description: '',
  email: '',
  replyToAccount: true,
  attachDiscussion: false,
  includeTech: true,
};

// технічні дані — рядками «назва: значення», як вони підуть на сервер
const techRows = (context) =>
  Object.entries(context)
    .filter(([key]) => key !== 'errors')
    .map(([key, value]) => [key, String(value)]);

/**
 * «Знайшли баги?» — звернення про баг, дивну відповідь AI чи ідею.
 * Технічні дані людина бачить і може вимкнути; дискусію додаємо лише з її згоди.
 * Чернетка опису не зникає, якщо закрити діалог і відкрити знову.
 */
export default function BugReportDialog() {
  const dialogRef = useRef(null);
  const textareaRef = useRef(null);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(INITIAL);
  const [opened, setOpened] = useState({ discussionId: null, messageId: null, crash: false, context: {} });
  const [accountEmail, setAccountEmail] = useState('');
  const [showTech, setShowTech] = useState(false);
  const [status, setStatus] = useState('idle');
  const [reference, setReference] = useState('');
  const [error, setError] = useState('');
  const [touched, setTouched] = useState(false);
  const [website, setWebsite] = useState('');

  const signedIn = Boolean(getSession());

  useEffect(() => {
    const show = (event) => {
      const detail = event.detail || {};
      const discussionId = currentDiscussionId();
      // знімок технічних даних — у момент відкриття, поки діалог сам нічого не змінив
      setOpened({
        discussionId,
        messageId: discussionId ? detail.messageId || null : null,
        crash: Boolean(detail.crash),
        context: collectContext(),
      });
      setForm((current) => {
        const fresh = status === 'sent' ? INITIAL : current;
        return {
          ...fresh,
          kind: REPORT_KINDS.includes(detail.kind) ? detail.kind : fresh.kind,
          description: detail.text && !fresh.description.trim() ? detail.text : fresh.description,
          // звернення про конкретну репліку без дискусії не зрозуміти
          attachDiscussion: Boolean(discussionId && detail.messageId) || fresh.attachDiscussion,
        };
      });
      if (status === 'sent') {
        setStatus('idle');
        setReference('');
        setTouched(false);
      }
      setError('');
      setOpen(true);
    };
    window.addEventListener(OPEN_BUG_REPORT_EVENT, show);
    return () => window.removeEventListener(OPEN_BUG_REPORT_EVENT, show);
  }, [status]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
      // курсор — у кінець опису, щоб одразу дописувати
      const area = textareaRef.current;
      if (area) {
        area.focus();
        area.setSelectionRange(area.value.length, area.value.length);
      }
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
  }, [open]);

  // пошта акаунта — для «Можна відповісти на …»
  useEffect(() => {
    if (!open || !signedIn || accountEmail) return undefined;
    let alive = true;
    me()
      .then((user) => alive && setAccountEmail(user?.email || ''))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [open, signedIn, accountEmail]);

  const update = (changes) => setForm((current) => ({ ...current, ...changes }));
  const close = () => setOpen(false);

  const description = form.description.trim();
  const tooShort = description.length < DESCRIPTION_MIN;
  const emailInvalid = !signedIn && form.email.trim() !== '' && !looksLikeEmail(form.email);
  const sending = status === 'sending';
  const errors = opened.context.errors || [];
  const replyPossible = signedIn ? form.replyToAccount : looksLikeEmail(form.email);

  const submit = async (event) => {
    event?.preventDefault();
    setTouched(true);
    if (tooShort || emailInvalid || sending) {
      textareaRef.current?.focus();
      return;
    }
    setStatus('sending');
    setError('');
    try {
      const data = await sendBugReport({
        kind: form.kind,
        description,
        page: window.location.pathname,
        email: signedIn ? '' : form.email.trim(),
        replyToAccount: signedIn && form.replyToAccount,
        discussion: form.attachDiscussion ? opened.discussionId : null,
        message: form.attachDiscussion ? opened.messageId : null,
        context: form.includeTech ? opened.context : {},
        website,
      });
      setReference(data?.reference || '');
      setStatus('sent');
      setForm(INITIAL);
      setShowTech(false);
    } catch (err) {
      setStatus('idle');
      setError(err?.message || t.error);
    }
  };

  const descriptionError = touched && tooShort ? t.tooShort(DESCRIPTION_MIN) : '';

  return (
    <dialog
      ref={dialogRef}
      className="report-dialog"
      aria-labelledby={`${id}-title`}
      onClose={close}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="report-dialog__head">
        <h2 id={`${id}-title`} className="report-dialog__title">
          {status === 'sent' ? t.thanksTitle : t.title}
        </h2>
        <button type="button" className="report-dialog__close" onClick={close} aria-label={t.close}>
          <HugeiconsIcon icon={Cancel01Icon} size={22} aria-hidden="true" />
        </button>
      </div>

      {status === 'sent' ? (
        <div className="report-dialog__body report-dialog__thanks" role="status">
          <HugeiconsIcon icon={CheckmarkCircle02Icon} size={44} className="report-dialog__thanks-icon" aria-hidden="true" />
          {reference && <p className="report-dialog__reference">{t.thanksReference(reference)}</p>}
          <p className="report-dialog__lead">{replyPossible ? t.thanksReply : t.thanksNoReply}</p>
          <div className="report-dialog__actions">
            <button
              type="button"
              className="report-dialog__button"
              onClick={() => {
                setStatus('idle');
                setReference('');
                setTouched(false);
                setTimeout(() => textareaRef.current?.focus(), 0);
              }}
            >
              {t.another}
            </button>
            <button type="button" className="report-dialog__button report-dialog__button--primary" onClick={close}>
              {t.close}
            </button>
          </div>
        </div>
      ) : (
        <form className="report-dialog__body" onSubmit={submit} noValidate>
          <p className="report-dialog__lead">{t.lead}</p>
          {opened.crash && <p className="report-dialog__notice">{t.crashNote}</p>}

          <div className="report-dialog__field">
            <span className="report-dialog__label" aria-hidden="true">{t.kindLabel}</span>
            <Pills
              label={t.kindLabel}
              value={form.kind}
              onChange={(kind) => update({ kind })}
              options={REPORT_KINDS.map((kind) => ({ value: kind, label: t.kinds[kind], icon: KIND_ICONS[kind] }))}
            />
          </div>

          <div className="report-dialog__field">
            <div className="report-dialog__label-row">
              <label className="report-dialog__label" htmlFor={`${id}-text`}>{t.descriptionLabel}</label>
              <span className="report-dialog__counter" aria-hidden="true">
                {t.counter(form.description.length, DESCRIPTION_MAX)}
              </span>
            </div>
            <textarea
              ref={textareaRef}
              id={`${id}-text`}
              className="report-dialog__input report-dialog__input--area"
              rows={5}
              maxLength={DESCRIPTION_MAX}
              value={form.description}
              placeholder={t.placeholders[form.kind]}
              onChange={(e) => update({ description: e.target.value })}
              onBlur={() => form.description && setTouched(true)}
              onKeyDown={(e) => {
                // Ctrl/⌘ + Enter надсилає; звичайний Enter — новий рядок
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(e);
              }}
              aria-invalid={Boolean(descriptionError)}
              aria-describedby={descriptionError ? `${id}-text-error` : undefined}
              required
            />
            {descriptionError && (
              <p id={`${id}-text-error`} className="report-dialog__error">{descriptionError}</p>
            )}
          </div>

          {opened.discussionId && (
            <label className="report-dialog__check">
              <input
                type="checkbox"
                checked={form.attachDiscussion}
                onChange={(e) => update({ attachDiscussion: e.target.checked })}
              />
              <span>
                <span className="report-dialog__check-title">{t.attachDiscussion}</span>
                <span className="report-dialog__hint">
                  {opened.messageId ? t.attachedMessage : t.attachDiscussionHint}
                </span>
              </span>
            </label>
          )}

          {signedIn ? (
            <label className="report-dialog__check">
              <input
                type="checkbox"
                checked={form.replyToAccount}
                onChange={(e) => update({ replyToAccount: e.target.checked })}
              />
              <span className="report-dialog__check-title">
                {t.replyLabel(accountEmail || '…')}
              </span>
            </label>
          ) : (
            <div className="report-dialog__field">
              <label className="report-dialog__label" htmlFor={`${id}-email`}>
                {t.emailLabel} <span className="report-dialog__optional">({t.emailOptional})</span>
              </label>
              <input
                id={`${id}-email`}
                type="email"
                className="report-dialog__input"
                value={form.email}
                placeholder={t.emailPlaceholder}
                autoComplete="email"
                onChange={(e) => update({ email: e.target.value })}
                aria-invalid={emailInvalid}
                aria-describedby={emailInvalid ? `${id}-email-error` : undefined}
              />
              {emailInvalid && (
                <p id={`${id}-email-error`} className="report-dialog__error">{t.emailInvalid}</p>
              )}
            </div>
          )}

          <div className="report-dialog__tech">
            <label className="report-dialog__check">
              <input
                type="checkbox"
                checked={form.includeTech}
                onChange={(e) => update({ includeTech: e.target.checked })}
              />
              <span>
                <span className="report-dialog__check-title">{t.techLabel}</span>
                <span className="report-dialog__hint">
                  {t.techHint}
                  {errors.length > 0 && ` · ${t.techErrors(errors.length)}`}
                </span>
              </span>
            </label>
            {form.includeTech && (
              <button
                type="button"
                className="report-dialog__link"
                aria-expanded={showTech}
                aria-controls={`${id}-tech`}
                onClick={() => setShowTech((value) => !value)}
              >
                {showTech ? t.techHide : t.techShow}
              </button>
            )}
            {form.includeTech && showTech && (
              <dl id={`${id}-tech`} className="report-dialog__tech-list">
                {techRows(opened.context).map(([key, value]) => (
                  <div key={key} className="report-dialog__tech-row">
                    <dt>{key}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
                {errors.map((item) => (
                  <div key={`${item.at}-${item.message}`} className="report-dialog__tech-row report-dialog__tech-row--error">
                    <dt>{item.kind}</dt>
                    <dd>{item.message}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>

          {/* пастка для ботів: людина її не бачить і не може в неї потрапити */}
          <input
            type="text"
            name="website"
            className="report-dialog__trap"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />

          {error && <p className="report-dialog__error" role="alert">{error}</p>}

          <div className="report-dialog__actions">
            <button type="button" className="report-dialog__button" onClick={close}>
              {t.cancel}
            </button>
            <button
              type="submit"
              className="report-dialog__button report-dialog__button--primary"
              disabled={sending}
              aria-disabled={sending}
            >
              {sending ? t.sending : t.send}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
