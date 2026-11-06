import { useId } from 'react';
import PropTypes from 'prop-types';
import { HugeiconsIcon } from '@hugeicons/react';
import { ViewIcon } from '@hugeicons/core-free-icons';
import { Pills, Row, SwitchRow } from './SettingsControls';
import { copy } from '../copy';
import { useVision } from '../hooks/useVision';
import {
  TEXT_SCALES,
  VISION_PRESET,
  getVision,
  isVisionActive,
  setVisionMode,
  updateVision,
} from '../utils/vision';

const t = copy.vision;

// усі опції пресету збігаються — тоді головний перемикач «увімкнено»
const matchesPreset = (prefs) => Object.keys(VISION_PRESET).every((key) => prefs[key] === VISION_PRESET[key]);

/** Набір налаштувань для зору: у діалозі поверх будь-якої сторінки й у «Налаштуваннях». */
// `showMaster` — плашка «Режим для слабозорих» з одним перемикачем; у швидкому
// діалозі вона потрібна, а в «Налаштуваннях» — лише окремі параметри
export default function VisionPanel({ onAnnounce, showMaster = true }) {
  const prefs = useVision();
  const switchId = useId();
  const modeOn = matchesPreset(prefs);

  const toggleMode = (on) => {
    setVisionMode(on);
    onAnnounce?.(on ? t.modeOn : t.modeOff);
  };

  // «Скинути все» повертає й «Менше анімації», навіть якщо його вмикали окремо
  const resetAll = () => {
    setVisionMode(false);
    if (getVision().motion) updateVision({ motion: false });
    onAnnounce?.(t.modeOff);
  };

  return (
    <div className="vision-panel">
      {showMaster && (
        <label className="vision-panel__master" htmlFor={switchId}>
          <span className="vision-panel__master-icon" aria-hidden="true">
            <HugeiconsIcon icon={ViewIcon} size={24} />
          </span>
          <span className="vision-panel__master-text">
            <span className="vision-panel__master-title">{t.modeLabel}</span>
            <span className="vision-panel__master-hint">{t.modeHint}</span>
          </span>
          <input
            id={switchId}
            type="checkbox"
            role="switch"
            className="debate__switch-input"
            checked={modeOn}
            onChange={(e) => toggleMode(e.target.checked)}
          />
        </label>
      )}

      <section className="settings__sheet" aria-label={t.detailsLabel}>
        <Row title={t.scaleLabel} hint={t.scaleHint} stacked>
          <Pills
            fill
            label={t.scaleLabel}
            value={prefs.scale}
            onChange={(scale) => updateVision({ scale })}
            options={TEXT_SCALES.map((scale) => ({
              value: scale,
              label: `${scale} %`,
            }))}
          />
        </Row>
        <Row title={t.contrastLabel} hint={t.contrastHint} stacked>
          <Pills
            fill
            label={t.contrastLabel}
            value={prefs.contrast}
            onChange={(contrast) => updateVision({ contrast })}
            options={[
              { value: 'normal', label: t.contrastNormal },
              { value: 'high', label: t.contrastHigh },
            ]}
          />
        </Row>
        <Row title={t.fontLabel} hint={t.fontHint} stacked>
          <Pills
            fill
            label={t.fontLabel}
            value={prefs.font}
            onChange={(font) => updateVision({ font })}
            options={[
              { value: 'default', label: t.fontDefault },
              { value: 'readable', label: t.fontReadable },
            ]}
          />
        </Row>
        <SwitchRow
          title={t.spacingLabel}
          hint={t.spacingHint}
          checked={prefs.spacing}
          onChange={(spacing) => updateVision({ spacing })}
        />
        <SwitchRow
          title={t.linksLabel}
          hint={t.linksHint}
          checked={prefs.links}
          onChange={(links) => updateVision({ links })}
        />
        <SwitchRow
          title={t.focusLabel}
          hint={t.focusHint}
          checked={prefs.focus}
          onChange={(focus) => updateVision({ focus })}
        />
        <SwitchRow
          title={t.cursorLabel}
          hint={t.cursorHint}
          checked={prefs.cursor}
          onChange={(cursor) => updateVision({ cursor })}
        />
        <SwitchRow
          title={t.motionLabel}
          hint={t.motionHint}
          checked={prefs.motion}
          onChange={(motion) => updateVision({ motion })}
        />
      </section>

      <div className="vision-panel__foot">
        <span>{t.footnote}</span>
        <button
          type="button"
          className="vision-panel__reset"
          onClick={resetAll}
          disabled={!isVisionActive(prefs) && !prefs.motion}
        >
          {t.reset}
        </button>
      </div>
    </div>
  );
}

VisionPanel.propTypes = {
  onAnnounce: PropTypes.func,
  showMaster: PropTypes.bool,
};
