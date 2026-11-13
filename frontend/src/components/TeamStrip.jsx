import { useEffect, useId, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowDown01Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import { TEAM_PRESETS, participantColor, roleIcon } from '../utils/debateOptions';
import { copy } from '../copy';

const t = copy.debate;

/** Три аватарки складу трикутником: одна згори, дві під нею. */
function PresetAvatars({ slugs }) {
  return (
    <span className="team-strip__triad" aria-hidden="true">
      {slugs.slice(0, 3).map((slug, index) => (
        <span key={slug} className="team-strip__triad-avatar" style={{ '--chip': participantColor(slug, index) }}>
          <HugeiconsIcon icon={roleIcon(slug)} size={12} strokeWidth={1.9} />
        </span>
      ))}
    </span>
  );
}

PresetAvatars.propTypes = {
  slugs: PropTypes.arrayOf(PropTypes.string).isRequired,
};

const sameTeam = (members, slugs) =>
  members.length === slugs.length && slugs.every((slug) => members.some((member) => member.key === slug));

/**
 * Команда одним рядком: аватарки й кількість учасників (імена — у підказці). Клік відкриває повні налаштування
 * учасників, а якщо передано `onPreset` — меню готових складів із пунктом
 * «Налаштувати вручну…».
 * Так головний екран лишається полем питання, а конструктор — за одним кліком.
 */
export default function TeamStrip({
  members,
  onOpen,
  onPreset,
  roleNames = {},
  hidden = false,
  disabled = false,
  className = '',
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef(null);

  // сховався (панель розгорнули) — меню не лишається висіти
  const [wasHidden, setWasHidden] = useState(hidden);
  if (wasHidden !== hidden) {
    setWasHidden(hidden);
    if (hidden) setIsMenuOpen(false);
  }

  useEffect(() => {
    if (!isMenuOpen) return undefined;
    const close = (event) => {
      if (event.type === 'keydown' ? event.key === 'Escape' : !rootRef.current?.contains(event.target)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [isMenuOpen]);

  if (!members.length) return null;
  const names = members.map((member) => member.label).join(' · ');

  return (
    // завжди в розмітці: поява й зникнення разом із панеллю — плавні
    <div
      className={`team-strip ${hidden ? 'team-strip--hidden' : ''} ${className}`}
      ref={rootRef}
      inert={hidden}
      aria-hidden={hidden || undefined}
    >
      {/* з готовими складами клік по рядку відкриває їх меню; без них — одразу панель */}
      <button
        type="button"
        className="team-strip__team"
        onClick={onPreset ? () => setIsMenuOpen((open) => !open) : onOpen}
        disabled={disabled}
        aria-label={onPreset ? t.teamPresetsFor(names) : t.teamOpen(names)}
        title={names}
        aria-haspopup={onPreset ? 'menu' : undefined}
        aria-expanded={onPreset ? isMenuOpen : undefined}
        aria-controls={onPreset ? menuId : undefined}
      >
        <span className="team-strip__avatars" aria-hidden="true">
          {members.map((member) => (
            <span key={member.key} className="team-strip__avatar" style={{ '--chip': member.color }}>
              <HugeiconsIcon icon={roleIcon(member.key)} size={15} strokeWidth={1.8} />
            </span>
          ))}
        </span>
        <span className="team-strip__names">{t.participantsCount(members.length)}</span>
        {onPreset && <HugeiconsIcon className="team-strip__chevron" icon={ArrowDown01Icon} size={14} aria-hidden="true" />}
      </button>
      {onPreset && (
        <div className="team-strip__presets">
          {/* меню завжди в розмітці — відкривається й закривається плавно, як інші */}
          <div
            className={`team-strip__menu ${isMenuOpen ? 'team-strip__menu--open' : ''}`}
            id={menuId}
            role="menu"
            aria-label={t.teamPresets}
            inert={!isMenuOpen}
          >
            {TEAM_PRESETS.map((preset) => {
              const active = sameTeam(members, preset.slugs);
              return (
                <button
                  key={preset.key}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  className={`team-strip__item ${active ? 'team-strip__item--active' : ''}`}
                  onClick={() => {
                    setIsMenuOpen(false);
                    onPreset(preset.slugs);
                  }}
                >
                  <PresetAvatars slugs={preset.slugs} />
                  <span className="team-strip__item-text">
                    <span className="team-strip__item-title">{t.presets[preset.key]}</span>
                    <span className="team-strip__item-roles">
                      {preset.slugs.map((slug) => roleNames[slug] || slug).join(' · ')}
                    </span>
                  </span>
                  {active && <HugeiconsIcon icon={Tick02Icon} size={16} aria-hidden="true" />}
                </button>
              );
            })}
            <button
              type="button"
              role="menuitem"
              className="team-strip__item team-strip__item--manual"
              onClick={() => {
                setIsMenuOpen(false);
                onOpen();
              }}
            >
              {t.teamCustomize}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

TeamStrip.propTypes = {
  members: PropTypes.arrayOf(
    PropTypes.shape({ key: PropTypes.string.isRequired, label: PropTypes.string.isRequired, color: PropTypes.string })
  ).isRequired,
  onOpen: PropTypes.func.isRequired,
  onPreset: PropTypes.func,
  roleNames: PropTypes.objectOf(PropTypes.string),
  hidden: PropTypes.bool,
  disabled: PropTypes.bool,
  className: PropTypes.string,
};
