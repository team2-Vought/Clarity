import { useEffect, useState } from 'react';

// та сама межа, що й у CSS: до 639px — телефонна розкладка
const PHONE_QUERY = '(max-width: 639px)';

const matchesPhone = () => {
  try {
    return window.matchMedia(PHONE_QUERY).matches;
  } catch {
    return false;
  }
};

// Чи зараз телефонна ширина; оновлюється, коли вікно перетинає межу.
export function useIsPhone() {
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

  return isPhone;
}
