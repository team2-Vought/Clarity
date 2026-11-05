import { useCallback, useEffect, useId, useState } from 'react';
import PropTypes from 'prop-types';
import { HugeiconsIcon } from '@hugeicons/react';
import { Tick02Icon } from '@hugeicons/core-free-icons';
import { me, updateProfile } from '../api/auth';
import { setMyProfile } from '../hooks/useMyProfile';
import { useToasts } from '../hooks/useToasts';
import { Pills, Row, SwitchRow } from './SettingsControls';
import LoadError from './LoadError';
import { describeError } from '../utils/errorKind';
import { copy } from '../copy';

const t = copy.settings.about;

// ліміти довжини — ті самі, що перевіряє сервер (accounts/about.py)
const LIMITS = { location: 80, occupation: 120, family: 200, finances_note: 200, notes: 500 };
const VALUES_MAX = 5;
const AGES = ['under_18', '18_24', '25_34', '35_44', '45_54', '55_64', '65_plus'];
const FINANCES = ['tight', 'enough', 'savings', 'comfortable'];
const RISKS = ['cautious', 'balanced', 'bold'];
const VALUES = Object.keys(t.valueOptions);

const options = (keys, labels) => keys.map((key) => ({ value: key, label: labels[key] }));

function TextField({ label, value, onChange, placeholder, maxLength, multiline = false }) {
  const id = useId();
  const Tag = multiline ? 'textarea' : 'input';
  return (
    <div className="settings__input">
      <label className="settings__input-label" htmlFor={id}>
        {label}
      </label>
      <div className={`settings__key-field ${multiline ? 'settings__key-field--area' : ''}`}>
        <Tag
          id={id}
          className={multiline ? 'settings__textarea' : 'settings__key-input settings__key-input--plain'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          maxLength={maxLength}
          rows={multiline ? 3 : undefined}
        />
      </div>
    </div>
  );
}

TextField.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  placeholder: PropTypes.string,
  maxLength: PropTypes.number,
  multiline: PropTypes.bool,
};

/**
 * «Про мене»: хто людина, щоб поради були персональними. Зберігається
 * однією кнопкою — текстові поля посеред набору зберігати не варто.
 */
export default function AboutSettings() {
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState(null);
  // { kind, text } або null
  const [loadError, setLoadError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const { pushToast } = useToasts();

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const user = await me();
      setSaved(user.about);
      setDraft(user.about);
    } catch (err) {
      setLoadError(describeError(err, t.loadError));
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!justSaved) return undefined;
    const timer = setTimeout(() => setJustSaved(false), 2400);
    return () => clearTimeout(timer);
  }, [justSaved]);

  if (loadError) {
    return (
      <LoadError kind={loadError.kind} text={loadError.text} onRetry={load} className="settings__load-error" />
    );
  }

  if (!draft) {
    return (
      <div className="settings__skeleton" aria-hidden="true">
        <div className="settings__skeleton-card" />
        <div className="settings__skeleton-card" />
      </div>
    );
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const set = (key) => (value) => {
    setJustSaved(false);
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const toggleValue = (key) =>
    set('values')(
      draft.values.includes(key)
        ? draft.values.filter((item) => item !== key)
        : [...draft.values, key]
    );

  const save = async () => {
    setIsSaving(true);
    try {
      const user = await updateProfile({ about: draft });
      setSaved(user.about);
      setDraft(user.about);
      setMyProfile(user);
      setJustSaved(true);
    } catch (err) {
      const fields = err?.fieldErrors?.() || {};
      pushToast(fields.about || err?.message || copy.settings.saveError);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <p className="settings__footnote settings__footnote--lead">{t.lead}</p>

      <div className="settings__sheet">
        <SwitchRow
          title={t.enabled}
          hint={t.enabledHint}
          checked={draft.enabled}
          onChange={set('enabled')}
        />
      </div>

      <div className="settings__sheet settings__sheet--form">
        <TextField
          label={t.location}
          value={draft.location}
          onChange={set('location')}
          placeholder={t.locationPlaceholder}
          maxLength={LIMITS.location}
        />
        <Row title={t.age} stacked>
          <Pills
            label={t.age}
            value={draft.age}
            onChange={set('age')}
            options={options(AGES, t.ages)}
            clearable
          />
        </Row>
        <TextField
          label={t.occupation}
          value={draft.occupation}
          onChange={set('occupation')}
          placeholder={t.occupationPlaceholder}
          maxLength={LIMITS.occupation}
        />
        <TextField
          label={t.family}
          value={draft.family}
          onChange={set('family')}
          placeholder={t.familyPlaceholder}
          maxLength={LIMITS.family}
          multiline
        />
      </div>

      <div className="settings__sheet settings__sheet--form">
        <Row title={t.finances} stacked>
          <Pills
            label={t.finances}
            value={draft.finances}
            onChange={set('finances')}
            options={options(FINANCES, t.financesOptions)}
            clearable
          />
        </Row>
        <TextField
          label={t.financesNote}
          value={draft.finances_note}
          onChange={set('finances_note')}
          placeholder={t.financesNotePlaceholder}
          maxLength={LIMITS.finances_note}
        />
        <Row title={t.values} hint={t.valuesHint(VALUES_MAX)} stacked>
          <div className="settings__pills" role="group" aria-label={t.values}>
            {VALUES.map((key) => {
              const active = draft.values.includes(key);
              return (
                <button
                  key={key}
                  type="button"
                  role="checkbox"
                  aria-checked={active}
                  className={`settings__pill settings__pill--toggle ${active ? 'settings__pill--active' : ''}`}
                  onClick={() => toggleValue(key)}
                  disabled={!active && draft.values.length >= VALUES_MAX}
                >
                  {t.valueOptions[key]}
                </button>
              );
            })}
          </div>
        </Row>
        <Row title={t.risk} hint={draft.risk ? t.riskHints[draft.risk] : undefined} stacked>
          <Pills
            label={t.risk}
            value={draft.risk}
            onChange={set('risk')}
            options={options(RISKS, t.riskOptions)}
            clearable
          />
        </Row>
      </div>

      <div className="settings__sheet settings__sheet--form">
        <TextField
          label={t.notes}
          value={draft.notes}
          onChange={set('notes')}
          placeholder={t.notesPlaceholder}
          maxLength={LIMITS.notes}
          multiline
        />
      </div>

      <p className="settings__footnote">{t.privacy}</p>

      {/* поки є незбережене, кнопка тримається внизу екрана; інакше — просто наприкінці форми */}
      <div className={`settings__save-bar ${dirty ? 'settings__save-bar--sticky' : ''}`}>
        <span className="settings__save-status" role="status">
          {justSaved ? (
            <>
              <HugeiconsIcon icon={Tick02Icon} size={16} aria-hidden="true" />
              {t.saved}
            </>
          ) : (
            dirty && t.unsaved
          )}
        </span>
        <button
          type="button"
          className="settings__button settings__button--primary"
          onClick={save}
          disabled={!dirty || isSaving}
        >
          {isSaving ? t.saving : t.save}
        </button>
      </div>
    </>
  );
}
