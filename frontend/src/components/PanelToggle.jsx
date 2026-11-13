import PropTypes from 'prop-types';
import { useOutletContext } from 'react-router-dom';
import { HugeiconsIcon } from '@hugeicons/react';
import { SidebarLeftIcon, UserGroupIcon } from '@hugeicons/core-free-icons';
import { copy } from '../copy';
import { useIsPhone } from '../hooks/useIsPhone';
import TeamAvatars from './TeamAvatars';

const t = copy.debate;

/**
 * Кнопка в куті області чату: на десктопі згортає / розгортає панель
 * налаштувань, на телефоні відкриває висувну панель. Саме перемикання
 * робить Layout — стан згорнутості спільний для головної й чату.
 * `phoneOpen` — чи відкрита висувна панель (для aria-expanded на телефоні).
 */
export default function PanelToggle({ controls, phoneOpen = false, members = null }) {
  const { panelCollapsed = false, togglePanel } = useOutletContext() ?? {};
  const isPhone = useIsPhone();

  const expanded = isPhone ? phoneOpen : !panelCollapsed;
  const label = expanded ? t.hideSettings : t.showSettings;

  return (
    <button
      type="button"
      className={`debate__panel-toggle ${members ? 'debate__panel-toggle--team' : ''}`}
      onClick={() => togglePanel?.()}
      aria-label={label}
      title={members ? t.teamToggleHint : label}
      aria-expanded={expanded}
      aria-controls={controls}
    >
      {members ? (
        // у чаті — команда в ряд: до трьох аватарок, решта — «+N»
        <TeamAvatars members={members} layout="row" max={3} />
      ) : (
        // на телефоні панель — висувна «Учасники», тож і значок — люди, а не друге «меню»
        <HugeiconsIcon icon={isPhone ? UserGroupIcon : SidebarLeftIcon} size={20} strokeWidth={1.8} aria-hidden="true" />
      )}
    </button>
  );
}

PanelToggle.propTypes = {
  controls: PropTypes.string.isRequired,
  phoneOpen: PropTypes.bool,
  // учасники дискусії: замість значка панелі — їхні аватарки в ряд
  members: PropTypes.arrayOf(PropTypes.shape({ key: PropTypes.string.isRequired, color: PropTypes.string })),
};
