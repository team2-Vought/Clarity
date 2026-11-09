import { getSession } from '../api/client';

// увійшли — «додому» означає до нової дискусії, інакше — на лендинг
export const homePath = () => (getSession() ? '/home' : '/');
