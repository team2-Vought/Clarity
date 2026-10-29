import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useNavigate, useOutletContext, useSearchParams } from 'react-router-dom';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Analytics01Icon,
  ArrowUpRight01Icon,
  ComputerIcon,
  Delete02Icon,
  Key01Icon,
  Moon02Icon,
  PaintBoardIcon,
  SlidersHorizontalIcon,
  StarIcon,
  Sun03Icon,
  UserIcon,
  ViewIcon,
  ViewOffSlashIcon,
} from '@hugeicons/core-free-icons';
import ModelPicker from '../components/ModelPicker';
import ProfileSettings from '../components/ProfileSettings';
import ProviderLogo from '../components/ProviderLogo';
import { getToken } from '../api/client';
import {
  deleteProviderKey,
  fetchSettings,
  saveProviderKey,
  updatePreferences,
} from '../api/settings';
import { useToasts } from '../hooks/useToasts';
import { uk } from '../copy/uk';
import {
  isMac,
  readReducedMotion,
  readSendKey,
  writeReducedMotion,
  writeSendKey,
} from '../utils/devicePrefs';

const t = uk.settings;

const TABS = [
  { key: 'profile', icon: UserIcon },
  { key: 'models', icon: Key01Icon },
  { key: 'debate', icon: SlidersHorizontalIcon },
  { key: 'appearance', icon: PaintBoardIcon },
  { key: 'usage', icon: Analytics01Icon },
];

// де провайдер видає ключі — посилання «Де взяти ключ»
const KEY_URLS = {
  openai: 'https://platform.openai.com/api-keys',
  anthropic: 'https://console.anthropic.com/settings/keys',
  gemini: 'https://aistudio.google.com/apikey',
  groq: 'https://console.groq.com/keys',
  cerebras: 'https://cloud.cerebras.ai/',
  deepseek: 'https://platform.deepseek.com/api_keys',
  mistral: 'https://console.mistral.ai/api-keys',
  openrouter: 'https://openrouter.ai/keys',
};

// кольорова «печатка» провайдера без логотипа — з палітри застосунку, по колу
const MARK_TONES = ['peach', 'sky', 'lilac', 'pink'];

const MODE_LABELS = {
  open: uk.debate.modeOpen,
  yes_no: uk.debate.modeYesNo,
  choose_one: uk.debate.modeChooseOne,
};

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

function statusOf(provider) {
  if (provider.unreadable) return { kind: 'error', text: t.status.unreadable };
  if (provider.user_key) return { kind: 'on', text: t.status.user(provider.masked) };
  if (provider.server_key) return { kind: 'on', text: t.status.server };
  if (!provider.accepts_key && provider.available) return { kind: 'on', text: t.status.local };
  return { kind: 'off', text: t.status.none };
}

/** Пігулки-перемикачі — як раунди й вигляд чату на панелі нового чату. */
function Pills({ label, value, options, onChange, disabled = false, fill = false }) {
  return (
    <div
      className={`settings__pills ${fill ? 'settings__pills--fill' : ''}`}
      role="radiogroup"
      aria-label={label}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            className={`settings__pill ${active ? 'settings__pill--active' : ''}`}
            onClick={() => !active && onChange(option.value)}
            disabled={disabled}
          >
            {option.icon && <HugeiconsIcon icon={option.icon} size={16} aria-hidden="true" />}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// `wide` — елемент керування переноситься під підпис, коли не вміщається;
// `stacked` — завжди під підписом на всю ширину картки
function Row({ title, hint, children, wide = false, stacked = false }) {
  const modifier = stacked ? 'settings__row--stacked' : wide ? 'settings__row--wide' : '';
  return (
    <div className={`settings__row ${modifier}`}>
      <div className="settings__row-text">
        <span className="settings__row-title">{title}</span>
        {hint && <span className="settings__row-hint">{hint}</span>}
      </div>
      <div className="settings__row-control">{children}</div>
    </div>
  );
}

function SwitchRow({ title, hint, checked, onChange, disabled = false }) {
  const id = useId();
  return (
    <label className="settings__row settings__row--switch" htmlFor={id}>
      <span className="settings__row-text">
        <span className="settings__row-title">{title}</span>
        {hint && <span className="settings__row-hint">{hint}</span>}
      </span>
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="debate__switch-input"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

function ProviderCard({ provider, models, tone, defaultModel, onSaveKey, onRemoveKey, onMakeDefault }) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [isVisible, setIsVisible] = useState(false);
  const [error, setError] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const inputRef = useRef(null);
  const inputId = useId();
  const status = statusOf(provider);

  useEffect(() => {
    if (isEditing) inputRef.current?.focus({ preventScroll: true });
  }, [isEditing]);

  const close = () => {
    setIsEditing(false);
    setDraft('');
    setError('');
    setIsVisible(false);
  };

  const submit = async (e) => {
    e.preventDefault();
    const key = draft.trim();
    if (!key) {
      setError(t.keyPlaceholder);
      return;
    }
    setIsBusy(true);
    setError('');
    try {
      await onSaveKey(provider, key);
      close();
    } catch (err) {
      setError(err.fieldErrors?.().key || err.message || t.keyError);
    } finally {
      setIsBusy(false);
    }
  };

  const remove = async () => {
    setIsBusy(true);
    try {
      await onRemoveKey(provider);
      close();
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <li className={`settings__provider ${provider.available ? 'settings__provider--on' : ''}`}>
      <div className="settings__provider-head">
        <ProviderLogo
          provider={provider.id}
          className="settings__mark settings__mark--logo"
          fallback={
            <span className={`settings__mark settings__mark--${tone}`} aria-hidden="true">
              {provider.label.charAt(0)}
            </span>
          }
        />
        <div className="settings__provider-title">
          <h3 className="settings__provider-name">{provider.label}</h3>
          <span className={`settings__status settings__status--${status.kind}`}>
            <span className="settings__dot" aria-hidden="true" />
            <span className="settings__status-text">{status.text}</span>
            <span className="settings__status-count">· {t.modelsCount(models.length)}</span>
          </span>
        </div>
        {provider.accepts_key && !isEditing && (
          <button
            type="button"
            className="settings__button settings__button--soft"
            onClick={() => setIsEditing(true)}
          >
            <HugeiconsIcon icon={Key01Icon} size={16} aria-hidden="true" />
            <span>{provider.user_key || provider.unreadable ? t.changeKey : t.addKey}</span>
          </button>
        )}
      </div>

      <div className={`settings__key ${isEditing ? 'settings__key--open' : ''}`} inert={!isEditing}>
        <form className="settings__key-form" onSubmit={submit} noValidate>
          <label className="settings__sr-only" htmlFor={inputId}>
            {t.keyLabel(provider.label)}
          </label>
          <div className={`settings__key-field ${error ? 'settings__key-field--error' : ''}`}>
            <input
              ref={inputRef}
              id={inputId}
              className="settings__key-input"
              type={isVisible ? 'text' : 'password'}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setError('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') close();
              }}
              placeholder={t.keyPlaceholder}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={Boolean(error)}
              aria-describedby={`${inputId}-hint`}
              disabled={isBusy}
            />
            <button
              type="button"
              className="settings__icon-button"
              onClick={() => setIsVisible((visible) => !visible)}
              aria-label={isVisible ? t.hideKey : t.showKey}
              aria-pressed={isVisible}
            >
              <HugeiconsIcon icon={isVisible ? ViewOffSlashIcon : ViewIcon} size={18} aria-hidden="true" />
            </button>
          </div>
          <div className="settings__key-actions">
            <button type="submit" className="settings__button settings__button--primary" disabled={isBusy}>
              {isBusy ? t.savingKey : t.saveKey}
            </button>
            <button type="button" className="settings__button" onClick={close} disabled={isBusy}>
              {t.cancel}
            </button>
            {(provider.user_key || provider.unreadable) && (
              <button
                type="button"
                className="settings__button settings__button--danger"
                onClick={remove}
                disabled={isBusy}
                aria-label={t.removeKeyNamed(provider.label)}
              >
                <HugeiconsIcon icon={Delete02Icon} size={16} aria-hidden="true" />
                <span>{t.removeKey}</span>
              </button>
            )}
            {KEY_URLS[provider.id] && (
              <a
                className="settings__link"
                href={KEY_URLS[provider.id]}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t.getKey}
                <HugeiconsIcon icon={ArrowUpRight01Icon} size={14} aria-hidden="true" />
              </a>
            )}
          </div>
          <p className="settings__key-hint" id={`${inputId}-hint`} role={error ? 'alert' : undefined}>
            {error || (provider.server_key ? `${t.keyPrivacy} ${t.serverAlsoHint}` : t.keyPrivacy)}
          </p>
        </form>
      </div>

      {models.length > 0 && (
        <ul className="settings__models">
          {models.map((model) => {
            const isDefault = model.id === defaultModel;
            return (
              <li
                key={model.id}
                className={`settings__model ${model.available ? '' : 'settings__model--off'}`}
              >
                <div className="settings__model-text">
                  <span className="settings__model-name">
                    {model.label || model.model}
                    {isDefault && <span className="settings__badge">{t.isDefault}</span>}
                    {!model.available && (
                      <span className="settings__badge settings__badge--muted">{t.modelUnavailable}</span>
                    )}
                  </span>
                  {model.notes && <span className="settings__model-notes">{model.notes}</span>}
                </div>
                {model.available && (
                  <button
                    type="button"
                    className={`settings__star ${isDefault ? 'settings__star--active' : ''}`}
                    onClick={() => onMakeDefault(isDefault ? '' : model.id)}
                    aria-label={t.makeDefault(model.label || model.model)}
                    aria-pressed={isDefault}
                    title={t.makeDefault(model.label || model.model)}
                  >
                    <HugeiconsIcon icon={StarIcon} size={18} aria-hidden="true" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

function UsageMeter({ title, used, limit }) {
  const share = limit ? Math.min(1, used / limit) : 0;
  const tone = share >= 1 ? 'full' : share >= 0.8 ? 'high' : 'ok';
  return (
    <div className="settings__meter">
      <div className="settings__meter-head">
        <span className="settings__row-title">{title}</span>
        <span className="settings__meter-value">
          {limit ? t.usageOf(used, limit) : t.usageUnlimited(used)}
        </span>
      </div>
      {limit > 0 && (
        <>
          <div
            className={`settings__meter-track settings__meter-track--${tone}`}
            role="meter"
            aria-label={title}
            aria-valuemin={0}
            aria-valuemax={limit}
            aria-valuenow={used}
          >
            <span className="settings__meter-fill" style={{ '--share': share }} />
          </div>
          <span className="settings__row-hint">{t.usageLeft(Math.max(0, limit - used))}</span>
        </>
      )}
    </div>
  );
}

function SettingsSkeleton() {
  return (
    <div className="settings__skeleton" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="settings__skeleton-card" />
      ))}
    </div>
  );
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const { themeMode, setThemeMode } = useOutletContext();
  const { pushToast } = useToasts();
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('tab');
  const tab = TABS.some((item) => item.key === requested) ? requested : TABS[0].key;

  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [sendKey, setSendKey] = useState(readSendKey);
  const [reducedMotion, setReducedMotion] = useState(readReducedMotion);
  const modKey = isMac() ? '⌘' : 'Ctrl';

  const load = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      setData(await fetchSettings());
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
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load, navigate]);

  const selectTab = (key) => {
    setSearchParams(key === TABS[0].key ? {} : { tab: key }, { replace: true });
  };

  // стрілки перемикають розділи, як у звичайних вкладках
  const handleTabsKeyDown = (e) => {
    const forward = ['ArrowDown', 'ArrowRight'].includes(e.key);
    const back = ['ArrowUp', 'ArrowLeft'].includes(e.key);
    if (!forward && !back) return;
    e.preventDefault();
    const index = TABS.findIndex((item) => item.key === tab);
    const next = TABS[(index + (forward ? 1 : -1) + TABS.length) % TABS.length];
    selectTab(next.key);
    e.currentTarget.querySelector(`#settings-tab-${next.key}`)?.focus();
  };

  // зміна застосовується одразу, а якщо сервер не прийняв — повертається назад
  const savePreference = async (changes) => {
    const previous = data;
    setData((current) => ({ ...current, preferences: { ...current.preferences, ...changes } }));
    try {
      setData(await updatePreferences(changes));
    } catch (err) {
      setData(previous);
      pushToast(err?.message || t.saveError);
    }
  };

  const handleSaveKey = async (provider, key) => {
    const result = await saveProviderKey(provider.id, key);
    setData(result);
    pushToast(result.verified === null ? t.keySavedUnverified(provider.label) : t.keySaved(provider.label));
  };

  const handleRemoveKey = async (provider) => {
    try {
      setData(await deleteProviderKey(provider.id));
      pushToast(t.keyRemoved(provider.label));
    } catch (err) {
      pushToast(err?.message || t.saveError);
    }
  };

  const changeSendKey = (value) => {
    setSendKey(value);
    writeSendKey(value);
  };

  const changeMotion = (value) => {
    setReducedMotion(value);
    writeReducedMotion(value);
  };

  const models = data?.models || [];
  const availableModels = models.filter((model) => model.available);
  const prefs = data?.preferences || {};
  // збережена модель могла стати недоступною (ключ видалено) — тоді «автоматично»
  const chosenDefault = availableModels.some((model) => model.id === prefs.default_model)
    ? prefs.default_model
    : '';
  const limits = data?.limits || { min_ai: 2, max_ai: 5, max_rounds: 3 };
  // провайдери без жодної моделі (Ollama й custom без налаштувань) — лише приміткою внизу
  const providers = (data?.providers || []).filter((provider) => provider.models > 0);
  const shownProviders =
    filter === 'available' ? providers.filter((provider) => provider.available) : providers;

  const renderModels = () => (
    <>
      <div className="settings__sheet">
        <Row title={t.defaultModel} hint={t.defaultModelHint} wide>
          <ModelPicker
            models={availableModels}
            value={chosenDefault}
            onChange={(value) => savePreference({ default_model: value })}
            label={t.defaultModel}
            autoLabel={t.defaultModelAuto}
            disabled={!availableModels.length}
          />
        </Row>
      </div>

      <div className="settings__toolbar">
        <span className="settings__count">{t.availableCount(availableModels.length, models.length)}</span>
        <Pills
          label={t.filterLabel}
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: t.filterAll },
            { value: 'available', label: t.filterAvailable },
          ]}
        />
      </div>

      {shownProviders.length ? (
        <ul className="settings__providers">
          {shownProviders.map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              tone={MARK_TONES[providers.indexOf(provider) % MARK_TONES.length]}
              models={models.filter((model) => model.provider_id === provider.id)}
              defaultModel={chosenDefault}
              onSaveKey={handleSaveKey}
              onRemoveKey={handleRemoveKey}
              onMakeDefault={(value) => savePreference({ default_model: value })}
            />
          ))}
        </ul>
      ) : (
        <p className="settings__empty">{t.noAvailable}</p>
      )}
      <p className="settings__footnote">{t.localNote}</p>
    </>
  );

  const renderDebate = () => (
    <>
      <div className="settings__sheet">
        <Row title={t.modeLabel} hint={uk.debate.modeHints[prefs.default_mode]} stacked>
          <Pills
            fill
            label={t.modeLabel}
            value={prefs.default_mode}
            onChange={(value) => savePreference({ default_mode: value })}
            options={(data?.modes || []).map((mode) => ({
              value: mode.value,
              label: MODE_LABELS[mode.value] || mode.label,
            }))}
          />
        </Row>
        <Row title={t.roundsLabel} hint={t.roundsHint}>
          <Pills
            label={t.roundsLabel}
            value={prefs.default_rounds}
            onChange={(value) => savePreference({ default_rounds: value })}
            options={range(1, limits.max_rounds).map((value) => ({ value, label: String(value) }))}
          />
        </Row>
        <Row title={t.participantsLabel} hint={t.participantsHint}>
          <Pills
            label={t.participantsLabel}
            value={prefs.default_participants}
            onChange={(value) => savePreference({ default_participants: value })}
            options={range(limits.min_ai, limits.max_ai).map((value) => ({ value, label: String(value) }))}
          />
        </Row>
        <SwitchRow
          title={t.webSearchLabel}
          hint={t.webSearchHint}
          checked={Boolean(prefs.web_search)}
          onChange={(value) => savePreference({ web_search: value })}
        />
      </div>
      <p className="settings__footnote">{t.debateLead}</p>
    </>
  );

  const renderAppearance = () => (
    <>
      <div className="settings__sheet">
        <Row title={t.themeLabel} stacked>
          <Pills
            fill
            label={t.themeLabel}
            value={themeMode}
            onChange={setThemeMode}
            options={[
              { value: 'light', label: t.themeLight, icon: Sun03Icon },
              { value: 'dark', label: t.themeDark, icon: Moon02Icon },
              { value: 'system', label: t.themeSystem, icon: ComputerIcon },
            ]}
          />
        </Row>
        <Row
          title={t.sendLabel}
          hint={sendKey === 'enter' ? t.sendHintEnter : t.sendHintModEnter}
        >
          <Pills
            label={t.sendLabel}
            value={sendKey}
            onChange={changeSendKey}
            options={[
              { value: 'enter', label: t.sendEnter },
              { value: 'mod-enter', label: t.sendModEnter(modKey) },
            ]}
          />
        </Row>
        <SwitchRow
          title={t.motionLabel}
          hint={t.motionHint}
          checked={reducedMotion}
          onChange={changeMotion}
        />
      </div>
      <p className="settings__footnote">{t.appearanceLead}</p>
    </>
  );

  const renderUsage = () => {
    const usage = data?.usage || {};
    return (
      <>
        <div className="settings__sheet">
          <UsageMeter title={t.usageDiscussions} used={usage.discussions || 0} limit={usage.discussions_limit || 0} />
          <UsageMeter title={t.usageReplies} used={usage.replies || 0} limit={usage.replies_limit || 0} />
        </div>
        <p className="settings__footnote">{t.usageLead} {t.usageKeysNote}</p>
      </>
    );
  };

  // профіль і інтерфейс не залежать від /api/settings/
  const needsData = tab !== 'appearance' && tab !== 'profile';
  let content;
  if (needsData && isLoading && !data) content = <SettingsSkeleton />;
  else if (needsData && error && !data) {
    content = (
      <div className="settings__error" role="alert">
        <p>{error}</p>
        <button type="button" className="settings__button settings__button--primary" onClick={load}>
          {t.retry}
        </button>
      </div>
    );
  } else if (tab === 'profile') content = <ProfileSettings />;
  else if (tab === 'debate') content = renderDebate();
  else if (tab === 'appearance') content = renderAppearance();
  else if (tab === 'usage') content = renderUsage();
  else content = renderModels();

  // коротка підказка праворуч на картці розділу
  const usage = data?.usage;
  const tabAside = {
    models: data ? `${availableModels.length}/${models.length}` : '',
    usage: usage?.replies_limit ? `${usage.replies}/${usage.replies_limit}` : '',
  };

  return (
    <div className="settings">
      <h1 className="settings__sr-only">{t.title}</h1>

      <aside className="settings__side">
        <div
          className="settings__tabs"
          role="tablist"
          aria-label={t.sections}
          aria-orientation="vertical"
          onKeyDown={handleTabsKeyDown}
        >
          {TABS.map((item) => {
            const active = item.key === tab;
            return (
              <button
                key={item.key}
                id={`settings-tab-${item.key}`}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls="settings-panel"
                tabIndex={active ? 0 : -1}
                className={`settings__tab ${active ? 'settings__tab--active' : ''}`}
                onClick={() => selectTab(item.key)}
              >
                <HugeiconsIcon icon={item.icon} size={18} aria-hidden="true" />
                <span className="settings__tab-label">{t.tabs[item.key]}</span>
                {tabAside[item.key] && <span className="settings__tab-aside">{tabAside[item.key]}</span>}
              </button>
            );
          })}
        </div>
      </aside>

      <div className="settings__main">
        <section
          key={tab}
          id="settings-panel"
          className="settings__content"
          role="tabpanel"
          aria-labelledby={`settings-tab-${tab}`}
          aria-busy={needsData && isLoading}
        >
          {content}
        </section>
      </div>
    </div>
  );
}
