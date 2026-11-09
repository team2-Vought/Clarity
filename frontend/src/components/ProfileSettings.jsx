import { useCallback, useEffect, useId, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { useNavigate } from 'react-router-dom';
import { HugeiconsIcon } from '@hugeicons/react';
import { Camera01Icon, Delete02Icon, ViewIcon, ViewOffSlashIcon } from '@hugeicons/core-free-icons';
import { changePassword, deleteAccount, me, updateProfile } from '../api/auth';
import { downloadAccountExport } from '../utils/accountExport';
import { setMyProfile } from '../hooks/useMyProfile';
import { useToasts } from '../hooks/useToasts';
import { validateEmail, validatePassword } from '../utils/validate';
import LoadError from './LoadError';
import { describeError } from '../utils/errorKind';
import { copy, locale } from '../copy';

const t = copy.settings.profile;

const EMPTY = {
  name: '',
  email: '',
  current_password: '',
  password: '',
  confirm_password: '',
};

const AVATAR_SIZE = 256;
const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const AVATAR_MAX_FILE = 10 * 1024 * 1024;

/** Обрізає по центру в квадрат і стискає до 256×256 — сервер зберігає вже готовий data URL. */
async function toAvatar(file) {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  const draw = () =>
    ctx.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      AVATAR_SIZE,
      AVATAR_SIZE,
    );
  draw();
  const webp = canvas.toDataURL('image/webp', 0.86);
  if (webp.startsWith('data:image/webp')) return webp;
  // без WebP (старий Safari) — JPEG на білому, бо прозорість він не тримає
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
  draw();
  return canvas.toDataURL('image/jpeg', 0.86);
}

const formatJoined = (value) => {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
};

function Input({ label, error, type = 'text', inputRef, ...props }) {
  const id = useId();
  const [isVisible, setIsVisible] = useState(false);
  const isPassword = type === 'password';
  return (
    <div className="settings__input">
      <label className="settings__input-label" htmlFor={id}>
        {label}
      </label>
      <div className={`settings__key-field ${error ? 'settings__key-field--error' : ''}`}>
        <input
          ref={inputRef}
          id={id}
          className="settings__key-input settings__key-input--plain"
          type={isPassword && isVisible ? 'text' : type}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          spellCheck={false}
          {...props}
        />
        {isPassword && (
          <button
            type="button"
            className="settings__icon-button"
            onClick={() => setIsVisible((visible) => !visible)}
            aria-label={isVisible ? copy.field.hidePassword : copy.field.showPassword}
            aria-pressed={isVisible}
          >
            <HugeiconsIcon icon={isVisible ? ViewOffSlashIcon : ViewIcon} size={18} aria-hidden="true" />
          </button>
        )}
      </div>
      {error && (
        <span className="settings__input-error" id={`${id}-error`} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

Input.propTypes = {
  label: PropTypes.string.isRequired,
  error: PropTypes.string,
  type: PropTypes.string,
  inputRef: PropTypes.object,
};

/** Рядок з кнопкою «Змінити», під яким плавно розкривається форма. */
function EditRow({ title, value, hint, open, onOpen, onClose, onSubmit, busy, submitLabel, danger, openLabel, children }) {
  const formRef = useRef(null);

  useEffect(() => {
    if (open) formRef.current?.querySelector('input')?.focus({ preventScroll: true });
  }, [open]);

  return (
    <div className={`settings__edit ${danger ? 'settings__edit--danger' : ''}`}>
      <div className="settings__row">
        <div className="settings__row-text">
          <span className="settings__edit-label">{title}</span>
          {value && <span className="settings__edit-value">{value}</span>}
          {hint && <span className="settings__row-hint">{hint}</span>}
        </div>
        {!open && (
          <div className="settings__row-control">
            <button
              type="button"
              className={`settings__button ${danger ? 'settings__button--danger' : ''}`}
              onClick={onOpen}
              aria-label={danger ? undefined : t.editNamed(title)}
            >
              {danger && <HugeiconsIcon icon={Delete02Icon} size={16} aria-hidden="true" />}
              <span>{openLabel || t.edit}</span>
            </button>
          </div>
        )}
      </div>
      <div className={`settings__key ${open ? 'settings__key--open' : ''}`} inert={!open}>
        <form
          ref={formRef}
          className="settings__key-form settings__edit-form"
          onSubmit={onSubmit}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
          }}
          noValidate
        >
          {children}
          <div className="settings__key-actions">
            <button
              type="submit"
              className={`settings__button ${danger ? 'settings__button--danger-solid' : 'settings__button--primary'}`}
              disabled={busy}
            >
              {submitLabel}
            </button>
            <button type="button" className="settings__button" onClick={onClose} disabled={busy}>
              {copy.settings.cancel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

ProfileSettings.propTypes = {
  section: PropTypes.oneOf(['profile', 'security']),
  children: PropTypes.node,
};

EditRow.propTypes = {
  title: PropTypes.string.isRequired,
  value: PropTypes.string,
  hint: PropTypes.string,
  open: PropTypes.bool.isRequired,
  onOpen: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
  onSubmit: PropTypes.func.isRequired,
  busy: PropTypes.bool,
  submitLabel: PropTypes.string.isRequired,
  danger: PropTypes.bool,
  openLabel: PropTypes.string,
  children: PropTypes.node,
};

/**
 * Дані акаунта у двох вкладках, але з одним станом форм:
 * `profile` — аватар, ім'я й пошта; `security` — пароль, вкладені `children`
 * (сесії й експорт) і видалення акаунта наприкінці.
 */
export default function ProfileSettings({ section = 'profile', children = null }) {
  const navigate = useNavigate();
  const { pushToast } = useToasts();
  const [user, setUser] = useState(null);
  // { kind, text } або null
  const [loadError, setLoadError] = useState(null);
  // відкрита лише одна форма: 'name' | 'email' | 'password' | 'delete'
  const [editing, setEditing] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [isBusy, setIsBusy] = useState(false);
  const [isAvatarBusy, setIsAvatarBusy] = useState(false);
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setUser(await me());
    } catch (err) {
      setLoadError(describeError(err, t.loadError));
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (user) setMyProfile(user);
  }, [user]);

  const open = (key) => {
    setEditing(key);
    setErrors({});
    setForm({ ...EMPTY, name: key === 'name' ? user.name : '' });
  };

  const close = () => {
    setEditing('');
    setErrors({});
    setForm(EMPTY);
  };

  const bind = (field) => ({
    value: form[field],
    onChange: (e) => {
      setForm((current) => ({ ...current, [field]: e.target.value }));
      setErrors((current) => ({ ...current, [field]: '' }));
    },
    disabled: isBusy,
  });

  // локальна перевірка → запит; помилки полів з сервера лягають під свої поля
  const run = (validate, action) => async (e) => {
    e.preventDefault();
    const found = validate();
    if (Object.values(found).some(Boolean)) {
      setErrors(found);
      return;
    }
    setIsBusy(true);
    try {
      await action();
    } catch (err) {
      const fields = err?.fieldErrors?.() || {};
      if (Object.keys(fields).length) setErrors(fields);
      else pushToast(err?.message || copy.settings.saveError);
    } finally {
      setIsBusy(false);
    }
  };

  const saveAvatar = async (avatar, message) => {
    setIsAvatarBusy(true);
    try {
      setUser(await updateProfile({ avatar }));
      pushToast(message, 'success');
    } catch (err) {
      pushToast(err?.fieldErrors?.().avatar || err?.message || copy.settings.saveError);
    } finally {
      setIsAvatarBusy(false);
    }
  };

  const pickAvatar = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!AVATAR_TYPES.includes(file.type)) return pushToast(t.avatarType);
    if (file.size > AVATAR_MAX_FILE) return pushToast(t.avatarTooBig);
    let avatar;
    try {
      avatar = await toAvatar(file);
    } catch {
      return pushToast(t.avatarUnreadable);
    }
    await saveAvatar(avatar, t.avatarSaved);
  };

  const submitName = run(
    () => {
      const name = form.name.trim();
      return { name: !name ? t.required : name.length < 2 ? t.nameShort : '' };
    },
    async () => {
      setUser(await updateProfile({ name: form.name }));
      close();
      pushToast(t.nameSaved, 'success');
    },
  );

  // акаунт, створений через Google, пароля не має: поточний пароль не питаємо
  const hasPassword = user?.has_password !== false;

  const submitEmail = run(
    () => {
      const email = form.email.trim();
      return {
        email: !email
          ? t.required
          : !validateEmail(email)
            ? t.emailInvalid
            : email.toLowerCase() === user.email
              ? t.sameEmail
              : '',
        current_password: !hasPassword || form.current_password ? '' : t.required,
      };
    },
    async () => {
      // пошта зміниться після підтвердження з листа на нову адресу
      const data = await updateProfile({ email: form.email, current_password: form.current_password });
      setUser(data);
      close();
      pushToast(t.emailSent(data.email_pending || form.email.trim()), 'success');
    },
  );

  const submitPassword = run(
    () => ({
      current_password: !hasPassword || form.current_password ? '' : t.required,
      password: validatePassword(form.password) || '',
      confirm_password: !form.confirm_password
        ? t.required
        : form.confirm_password !== form.password
          ? t.mismatch
          : '',
    }),
    async () => {
      await changePassword(form);
      setUser((current) => ({ ...current, has_password: true }));
      close();
      pushToast(t.passwordSaved, 'success');
    },
  );

  const submitDelete = run(
    () => ({ password: !hasPassword || form.password ? '' : t.required }),
    async () => {
      await deleteAccount(form.password);
      navigate('/', { replace: true });
    },
  );

  if (!user) {
    if (!loadError) {
      return (
        <div className="settings__skeleton" aria-hidden="true">
          <div className="settings__skeleton-card" />
          <div className="settings__skeleton-card" />
        </div>
      );
    }
    return (
      <LoadError kind={loadError.kind} text={loadError.text} onRetry={load} className="settings__load-error" />
    );
  }

  const joined = formatJoined(user.date_joined);
  const rowProps = (key) => ({
    open: editing === key,
    onOpen: () => open(key),
    onClose: close,
    busy: isBusy,
  });

  if (section === 'security') {
    return (
      <>
        <div className="settings__sheet">
          <EditRow
            {...rowProps('password')}
            title={t.passwordLabel}
            value={hasPassword ? '••••••••' : t.passwordNone}
            onSubmit={submitPassword}
            submitLabel={isBusy ? t.saving : t.save}
          >
            {hasPassword && (
              <Input
                label={t.currentPasswordLabel}
                type="password"
                autoComplete="current-password"
                error={errors.current_password}
                {...bind('current_password')}
              />
            )}
            <Input
              label={t.newPasswordLabel}
              type="password"
              autoComplete="new-password"
              error={errors.password}
              {...bind('password')}
            />
            <Input
              label={t.confirmPasswordLabel}
              type="password"
              autoComplete="new-password"
              error={errors.confirm_password}
              {...bind('confirm_password')}
            />
            <p className="settings__key-hint">
              {t.passwordRules} {hasPassword ? t.passwordHint : t.passwordSetHint}
            </p>
          </EditRow>
        </div>
        {children}

        <div className="settings__sheet settings__sheet--quiet">
          <EditRow
            {...rowProps('delete')}
            danger
            title={t.deleteLabel}
            hint={t.deleteHint}
            openLabel={t.deleteOpen}
            onSubmit={submitDelete}
            submitLabel={isBusy ? t.deleting : t.deleteSubmit}
          >
            {hasPassword && (
              <Input
                label={t.currentPasswordLabel}
                type="password"
                autoComplete="current-password"
                error={errors.password}
                {...bind('password')}
              />
            )}
            <p className="settings__key-hint">
              {t.deleteExportHint}{' '}
              <button
                type="button"
                className="settings__link-button"
                onClick={() =>
                  downloadAccountExport().catch((err) => pushToast(err?.message || copy.settings.saveError))
                }
              >
                {t.deleteExport}
              </button>
            </p>
            <p className="settings__key-hint">{hasPassword ? t.deleteConfirmHint : t.deleteConfirmNoPassword}</p>
          </EditRow>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="settings__identity">
        <button
          type="button"
          className={`settings__avatar ${isAvatarBusy ? 'settings__avatar--busy' : ''}`}
          onClick={() => fileRef.current?.click()}
          disabled={isAvatarBusy}
          aria-label={user.avatar ? t.avatarChange : t.avatarUpload}
        >
          {user.avatar ? (
            <img className="settings__avatar-image" src={user.avatar} alt="" />
          ) : (
            <span aria-hidden="true">{user.name.trim().charAt(0).toUpperCase()}</span>
          )}
          <span className="settings__avatar-badge" aria-hidden="true">
            <HugeiconsIcon icon={Camera01Icon} size={14} />
          </span>
        </button>
        <input ref={fileRef} type="file" accept={AVATAR_TYPES.join(',')} onChange={pickAvatar} hidden />
        <div className="settings__identity-text">
          <h2 className="settings__identity-name">{user.name}</h2>
          {joined && <span className="settings__identity-meta">{t.joined(joined)}</span>}
        </div>
        {/* без фото його додає сама аватарка зі значком камери — окрема кнопка
            лише дублювала б її; з фото поруч «Змінити» й «Прибрати» */}
        {user.avatar && (
          <div className="settings__identity-actions">
            <button
              type="button"
              className="settings__button settings__button--soft"
              onClick={() => fileRef.current?.click()}
              disabled={isAvatarBusy}
            >
              {t.avatarChange}
            </button>
            <button
              type="button"
              className="settings__button"
              onClick={() => saveAvatar('', t.avatarRemoved)}
              disabled={isAvatarBusy}
            >
              {t.avatarRemove}
            </button>
          </div>
        )}
      </div>

      <div className="settings__sheet">
        <EditRow
          {...rowProps('name')}
          title={t.nameLabel}
          value={user.name}
          onSubmit={submitName}
          submitLabel={isBusy ? t.saving : t.save}
        >
          <Input label={t.nameLabel} autoComplete="name" maxLength={40} error={errors.name} {...bind('name')} />
        </EditRow>

        <EditRow
          {...rowProps('email')}
          title={t.emailLabel}
          value={user.email}
          onSubmit={submitEmail}
          submitLabel={isBusy ? t.saving : t.save}
        >
          <Input label={t.newEmailLabel} type="email" autoComplete="email" error={errors.email} {...bind('email')} />
          {hasPassword && (
            <>
              <Input
                label={t.currentPasswordLabel}
                type="password"
                autoComplete="current-password"
                error={errors.current_password}
                {...bind('current_password')}
              />
              <p className="settings__key-hint">{t.emailConfirmHint}</p>
            </>
          )}
        </EditRow>
      </div>
    </>
  );
}
