import { useId } from 'react';

// Логотип Clarity — п'ять пелюсток-капсул від світлого ядра (той самий малюнок,
// що й assets/logo-thinking.svg). Пелюстка задана вздовж +x від ядра (322, 325),
// а на місце її ставить поворот.
const CORE = { x: 322, y: 325 };

const PETALS = [
  { key: 'p1', angle: 180, fill: 'lav', opacity: 0.82 },
  { key: 'p5', angle: 0, fill: 'lav', opacity: 0.82 },
  { key: 'p2', angle: -140, fill: 'rose', opacity: 0.8 },
  { key: 'p4', angle: -40, fill: 'teal', opacity: 0.8 },
  { key: 'p3', angle: -90, fill: 'olive', opacity: 0.86 },
];

// порядок, у якому пелюстки по черзі «тягнуться» назовні — хвилею зліва направо
const GROW_ORDER = ['p1', 'p2', 'p3', 'p4', 'p5'];

/**
 * Поки модератор складає дерево: логотип «думає» — пелюстки по черзі тягнуться
 * назовні й ловлять відблиск. Сам логотип стоїть на місці. Уся анімація — CSS
 * (styles/tree.css), тож «Менше анімації» показує його нерухомим.
 */
export default function LogoTreeGrowing() {
  // id градієнтів унікальні: SVG вбудовано в сторінку, а не в <img>
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const id = (name) => `${uid}-${name}`;

  return (
    <svg className="logo-tree" viewBox="-30 -40 704 490" aria-hidden="true">
      <defs>
        <linearGradient id={id('lav')} x1="0" x2="1">
          <stop offset="0" stopColor="#f4f2ff" />
          <stop offset="0.45" stopColor="#d4d4ea" />
          <stop offset="1" stopColor="#bfc0db" />
        </linearGradient>
        <linearGradient id={id('rose')} x1="0" x2="1">
          <stop offset="0" stopColor="#fbe4ea" />
          <stop offset="0.5" stopColor="#e6c3c9" />
          <stop offset="1" stopColor="#cfa8ae" />
        </linearGradient>
        <linearGradient id={id('olive')} x1="0" x2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.4" stopColor="#f3f0d9" />
          <stop offset="1" stopColor="#d5d1b2" />
        </linearGradient>
        <linearGradient id={id('teal')} x1="0" x2="1">
          <stop offset="0" stopColor="#e6fbff" />
          <stop offset="0.5" stopColor="#cbe6ea" />
          <stop offset="1" stopColor="#b3d1d6" />
        </linearGradient>
        <linearGradient id={id('shine')} x1="0" x2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.7" stopColor="#fff" stopOpacity="0.9" />
          <stop offset="1" stopColor="#fff" stopOpacity="0.4" />
        </linearGradient>
        <radialGradient id={id('core')}>
          <stop offset="0" stopColor="#fff" />
          <stop offset="0.75" stopColor="#fff" stopOpacity="0.85" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={id('halo')}>
          <stop offset="0" stopColor="#fff" />
          <stop offset="0.58" stopColor="#fff" />
          <stop offset="0.79" stopColor="#fff" stopOpacity="0.5" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>

      <g className="logo-tree__flower">
        {PETALS.map((petal) => (
          <g
            key={petal.key}
            className="logo-tree__petal"
            transform={`rotate(${petal.angle} ${CORE.x} ${CORE.y})`}
            style={{ '--n': GROW_ORDER.indexOf(petal.key) }}
          >
            <g className="logo-tree__body">
              <rect
                x="226"
                y="229"
                width="412"
                height="192"
                rx="96"
                fill={`url(#${id(petal.fill)})`}
                fillOpacity={petal.opacity}
                stroke="#fff"
                strokeOpacity="0.7"
                strokeWidth="2"
              />
              <rect className="logo-tree__shine" x="226" y="229" width="412" height="192" rx="96" fill={`url(#${id('shine')})`} />
            </g>
          </g>
        ))}
        <circle className="logo-tree__halo" cx={CORE.x} cy={CORE.y} r="140" fill={`url(#${id('halo')})`} />
        <circle className="logo-tree__core" cx={CORE.x} cy={CORE.y} r="80" fill={`url(#${id('core')})`} />
      </g>
    </svg>
  );
}
