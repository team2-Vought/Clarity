// Іконки не зникають, коли смуга іконок «відривається» й стає карткою меню:
// кожна іконка картки (лого, пункти, кнопки внизу) стартує точно там і такого
// розміру, як у смузі, і пливе на своє місце — а при закритті повертається.
// Так само їде й підсвітка активного пункту. Підписи проявляються окремо (CSS).
//
// Сама картка змінює форму через clip-path, тож макет її вмісту завжди
// остаточний — досить порахувати зсув і масштаб від смуги до картки (FLIP).

const ICONS = '.sidebar__brand img, .sidebar__item > svg, .sidebar__control > svg';
const PILL = '.sidebar__item--active';

// Розкриття — справжня пружина (згасаючі коливання, ζ = 0.5): стартує м'яко,
// перелітає місце на ~16% і кілька разів ледь хитається. Крива cubic-bezier із
// різким стартом проходила майже весь шлях за кілька кадрів — і виглядала стрибком.
const SPRING = 'linear(0, 0.029, 0.105, 0.215, 0.343, 0.48, 0.615, 0.741, 0.854, 0.95, 1.027, 1.086, 1.127, 1.151, 1.162, 1.162, 1.153, 1.137, 1.117, 1.095, 1.073, 1.052, 1.033, 1.016, 1.003, 0.992, 0.984, 0.98, 0.977, 0.977, 0.978, 0.981, 0.984, 0.988, 0.992, 0.996, 1)';
// backwards — поки іконка чекає своєї черги, вона вже стоїть на місці в смузі
const OPEN = { duration: 720, easing: SPRING, fill: 'backwards' };
// для браузерів без linear()
const OPEN_FALLBACK = 'cubic-bezier(0.45, 0, 0.25, 1.3)';
// іконки рушають хвилею зверху вниз
const OPEN_STAGGER = 13;
// закриття теж желейне: легкий замах назад, тоді переліт за місце в смузі й повернення
const CLOSE = { duration: 345, easing: 'cubic-bezier(0.5, -0.15, 0.3, 1.3)', fill: 'forwards' };
// коли картку вже сховано (visibility з затримкою 0.35s у debate.css), анімації
// закриття прибираємо: інакше вони тримали б іконки на місцях смуги, і наступне
// відкриття стартувало б поверх них — у Safari іконки тоді просто стрибали
const CLOSE_CLEANUP = 420;

// анімація з пружиною; там, де linear() ще не підтримується, — з запасною кривою
const animate = (element, keyframes, timing) => {
  try {
    return element.animate(keyframes, timing);
  } catch (error) {
    if (timing.easing !== SPRING) throw error;
    return element.animate(keyframes, { ...timing, easing: OPEN_FALLBACK });
  }
};

const reducedMotion = () =>
  document.documentElement.dataset.motion === 'reduced'
  || Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

// зсув і масштаб, що ставлять елемент картки (layout) на місце rect
const placeAt = (rect, layout) => ({
  transformOrigin: '0 0',
  transform: `translate(${rect.left - layout.left}px, ${rect.top - layout.top}px) scale(${rect.width / layout.width})`,
});

const AT_HOME = { transformOrigin: '0 0', transform: 'none' };

const pillFrame = (rect, layout, radius) => ({
  left: `${rect.left - layout.left}px`,
  top: `${rect.top - layout.top}px`,
  width: `${rect.width}px`,
  height: `${rect.height}px`,
  borderRadius: radius,
});

// де підсвітка зараз (з урахуванням анімації, що триває), у координатах екрана
const currentPillRect = (pill, layout) => {
  const style = getComputedStyle(pill, '::before');
  const left = parseFloat(style.left) || 0;
  const top = parseFloat(style.top) || 0;
  return {
    left: layout.left + left,
    top: layout.top + top,
    width: parseFloat(style.width) || layout.width,
    height: parseFloat(style.height) || layout.height,
    radius: style.borderTopLeftRadius,
  };
};

/**
 * Запускає перетікання іконок між смугою (`rail`) і карткою (`drawer`).
 * `store` — ref зі списком анімацій попереднього руху: якщо той ще триває
 * (швидке повторне натискання), новий рух стартує з поточного положення.
 */
export function morphSidebar(rail, drawer, opening, store) {
  const previous = store.current;
  const interrupted = previous.some((animation) => animation.playState === 'running');
  store.current = [];

  const railIcons = rail ? [...rail.querySelectorAll(ICONS)] : [];
  const icons = drawer ? [...drawer.querySelectorAll(ICONS)] : [];
  const railPill = rail?.querySelector(PILL);
  const pill = drawer?.querySelector(PILL);

  // поточне положення — до скасування попередніх анімацій
  const current = icons.map((icon) => icon.getBoundingClientRect());
  const pillLayout = pill?.getBoundingClientRect();
  const pillNow = pill && interrupted ? currentPillRect(pill, pillLayout) : null;
  previous.forEach((animation) => animation.cancel());

  // на телефоні смуги немає (display: none) — картка просто виростає від краю
  const railVisible = railIcons.length && railIcons[0].getBoundingClientRect().width > 0;
  if (!railVisible || railIcons.length !== icons.length || reducedMotion()) return;

  const timing = opening ? OPEN : CLOSE;

  icons.forEach((icon, i) => {
    const layout = icon.getBoundingClientRect();
    const docked = railIcons[i].getBoundingClientRect();
    if (!layout.width || !docked.width) return;
    const start = interrupted ? placeAt(current[i], layout) : opening ? placeAt(docked, layout) : AT_HOME;
    const end = opening ? AT_HOME : placeAt(docked, layout);
    const delay = opening && !interrupted ? i * OPEN_STAGGER : 0;
    store.current.push(animate(icon, [start, end], { ...timing, delay }));
  });

  if (pill && railPill) {
    const docked = railPill.getBoundingClientRect();
    const dockedFrame = pillFrame(docked, pillLayout, getComputedStyle(railPill).borderTopLeftRadius);
    const homeFrame = pillFrame(pillLayout, pillLayout, getComputedStyle(pill).borderTopLeftRadius);
    const start = pillNow
      ? pillFrame(pillNow, pillLayout, pillNow.radius)
      : opening ? dockedFrame : homeFrame;
    try {
      store.current.push(
        animate(pill, [start, opening ? homeFrame : dockedFrame], { ...timing, pseudoElement: '::before' })
      );
    } catch {
      // без анімації псевдоелементів підсвітка просто стоїть на місці
    }
  }

  // кожне наступне відкриття стартує з чистого стану — як найперше
  if (!opening) {
    const closing = store.current;
    const card = drawer.querySelector('.sidebar--drawer');
    const cleanUp = () => {
      if (store.current !== closing) return; // меню вже знову відкривають
      // поки картку ще видно (браузер пригальмував), іконки лишаються в смузі
      if (card && getComputedStyle(card).visibility !== 'hidden') {
        window.setTimeout(cleanUp, 100);
        return;
      }
      closing.forEach((animation) => animation.cancel());
      store.current = [];
    };
    window.setTimeout(cleanUp, CLOSE_CLEANUP);
  }
}
