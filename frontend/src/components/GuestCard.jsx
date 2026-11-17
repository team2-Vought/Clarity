import PropTypes from 'prop-types';
import { useNavigate } from 'react-router-dom';
import { useMyProfile } from '../hooks/useMyProfile';
import { isGuestSession } from '../api/client';
import { copy } from '../copy';

const t = copy.guest;

/** Гість без реєстрації (accounts/guest.py): нагадуємо, що дискусію можна зберегти в акаунт. */
export default function GuestCard({ where = 'home' }) {
  const navigate = useNavigate();
  const { isGuest } = useMyProfile();
  // до відповіді /me — позначка з цього пристрою, щоб картка не блимала
  if (!(isGuest || isGuestSession())) return null;
  const text = where === 'chat' ? t.chatText : where === 'settings' ? t.settingsText : t.homeText;
  return (
    <section className="debate__due debate__due--guest" aria-label={t.label}>
      <span className="debate__due-label">{t.label}</span>
      <p className="debate__due-text">{text}</p>
      <div className="debate__due-foot">
        <button type="button" className="debate__due-later debate__due-later--push" onClick={() => navigate('/login')}>
          {t.signIn}
        </button>
        <button type="button" className="debate__due-tell" onClick={() => navigate('/register')}>
          {t.create}
        </button>
      </div>
    </section>
  );
}

GuestCard.propTypes = {
  where: PropTypes.oneOf(['home', 'chat', 'settings']),
};
