import { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { useOutletContext } from 'react-router-dom';
import { PanelIcon } from './DebateIcons';
import { uk } from '../copy/uk';

const t = uk.debate;
const PHONE_QUERY = '(max-width: 639px)';

const matchesPhone = () => {
  try {
    return window.matchMedia(PHONE_QUERY).matches;
  } catch {
    return false;
  }
};

/**
 * Кнопка в куті області чату: на десктопі згортає / розгортає панель
 * налаштувань, на телефоні відкриває висувну панель. Саме перемикання
 * робить Layout — стан згорнутості спільний для головної й чату.
 * `phoneOpen` — чи відкрита висувна панель (для aria-expanded на телефоні).
 */
export default function PanelToggle({ controls, phoneOpen = false }) {
  const { panelCollapsed = false, togglePanel } = useOutletContext() ?? {};
  const [isPhone, setIsPhone] = useState(matchesPhone);

  useEffect(() => {
    let query;
    try {
      query = window.matchMedia(PHONE_QUERY);
    } catch {
      return undefined;
    }
    const update = () => setIsPhone(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  const expanded = isPhone ? phoneOpen : !panelCollapsed;
  const label = expanded ? t.hideSettings : t.showSettings;

  return (
    <button
      type="button"
      className="debate__panel-toggle"
      onClick={() => togglePanel?.()}
      aria-label={label}
      title={label}
      aria-expanded={expanded}
      aria-controls={controls}
    >
      <PanelIcon />
    </button>
  );
}

PanelToggle.propTypes = {
  controls: PropTypes.string.isRequired,
  phoneOpen: PropTypes.bool,
};
