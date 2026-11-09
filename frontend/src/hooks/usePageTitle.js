import { useEffect } from 'react';
import { copy } from '../copy';

/**
 * Заголовок вкладки браузера: «Назва · Clarity», без назви — просто «Clarity».
 * `exact` — заголовок як є (лендинг: «Clarity — …»).
 * Коли сторінка зникає, лишає просто «Clarity»: наступна сторінка поставить свій.
 */
export function usePageTitle(title, { exact = false } = {}) {
  useEffect(() => {
    if (exact) document.title = title;
    else document.title = title ? copy.common.pageTitle(title) : copy.appName;
    return () => {
      document.title = copy.appName;
    };
  }, [title, exact]);
}
