import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowRight01Icon } from '@hugeicons/core-free-icons';
import { ConfidenceRing, FitMeter, Supporters } from './parts';
import { STATUS_ICONS, orderBranches } from './treeModel';
import { stanceLabelOf } from '../../utils/treeView';
import { copy } from '../../copy';

const t = copy.tree;

// плавна S-крива між правим краєм одного вузла й лівим краєм іншого
const curve = (x1, y1, x2, y2) => {
  const dx = Math.max(24, (x2 - x1) * 0.5);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
};

/**
 * Схема: питання ліворуч, від нього — шляхи, від кожного шляху — розвилки
 * «якщо…, то…». Вузли — звичайна розмітка (текст переноситься, фокус працює),
 * а лінії між ними малює SVG поверх, за виміряними позиціями вузлів.
 * На вузькому екрані CSS складає все в стовпчик, і лінії малює вже він.
 */
export default function DecisionTreeMap({ tree, colorOf, activeId, selectedId, onActivate, onSelect }) {
  const mapRef = useRef(null);
  const rootRef = useRef(null);
  const nodeRefs = useRef(new Map());
  const [links, setLinks] = useState([]);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const branches = useMemo(() => orderBranches(tree.branches), [tree.branches]);
  // «Так» / «Ні» / варіант; у вільному режимі відповідь — ціле рішення, її тут немає
  const answer = stanceLabelOf(tree.answer, tree.mode);
  const hasConfidence = tree.confidence !== null && tree.confidence !== undefined;

  const setNode = (id) => (el) => {
    if (el) nodeRefs.current.set(id, el);
    else nodeRefs.current.delete(id);
  };

  const measure = useCallback(() => {
    const map = mapRef.current;
    const root = rootRef.current;
    if (!map || !root) return;
    // у стовпчику ліній немає — їх замінює рамка зліва
    if (getComputedStyle(map).getPropertyValue('--tree-links').trim() === 'none') {
      setLinks([]);
      return;
    }
    const origin = map.getBoundingClientRect();
    const place = (el) => {
      const rect = el.getBoundingClientRect();
      return {
        left: rect.left - origin.left + map.scrollLeft,
        right: rect.right - origin.left + map.scrollLeft,
        middle: rect.top - origin.top + map.scrollTop + rect.height / 2,
      };
    };
    const from = place(root);
    const next = [];
    branches.forEach((branch) => {
      const node = nodeRefs.current.get(branch.id);
      if (!node) return;
      const at = place(node);
      next.push({
        id: branch.id,
        branch: branch.id,
        status: branch.status,
        d: curve(from.right, from.middle, at.left, at.middle),
        end: [at.left, at.middle],
      });
      branch.outcomes.forEach((outcome) => {
        const leaf = nodeRefs.current.get(outcome.id);
        if (!leaf) return;
        const to = place(leaf);
        next.push({
          id: outcome.id,
          branch: branch.id,
          status: branch.status,
          tone: outcome.tone,
          d: curve(at.right, at.middle, to.left, to.middle),
          end: [to.left, to.middle],
        });
      });
    });
    setBox({ width: map.scrollWidth, height: map.scrollHeight });
    setLinks(next);
  }, [branches]);

  useLayoutEffect(() => {
    measure();
    const map = mapRef.current;
    if (!map || typeof ResizeObserver === 'undefined') return undefined;
    // висота карток змінюється, коли догружається шрифт чи змінюється ширина
    const observer = new ResizeObserver(() => measure());
    observer.observe(map);
    nodeRefs.current.forEach((el) => observer.observe(el));
    document.fonts?.ready?.then(measure).catch(() => {});
    return () => observer.disconnect();
  }, [measure]);

  // підсвічений шлях: наведений чи відкритий; решта трохи тьмяніє
  const focus = activeId || selectedId;
  const dim = (branchId) => Boolean(focus) && focus !== branchId;

  return (
    <div className="tree-map" ref={mapRef} role="group" aria-label={t.mapLabel}>
      {links.length > 0 && (
        <svg
          className="tree-map__links"
          width={box.width}
          height={box.height}
          viewBox={`0 0 ${box.width} ${box.height}`}
          aria-hidden="true"
        >
          {links.map((link, index) => (
            <g
              key={link.id}
              className={[
                'tree-link',
                `tree-link--${link.status}`,
                link.tone && `tree-link--leaf tree-link--${link.tone}`,
                dim(link.branch) && 'tree-link--dim',
                focus === link.branch && 'tree-link--focus',
              ].filter(Boolean).join(' ')}
              style={{ '--i': index }}
            >
              <path className="tree-link__line" d={link.d} pathLength="1" />
              <circle className="tree-link__port" cx={link.end[0]} cy={link.end[1]} r="3.5" />
            </g>
          ))}
        </svg>
      )}

      <div className="tree-root" ref={rootRef} style={{ gridRow: `1 / span ${branches.length}` }}>
        <span className="tree-root__label">{t.question}</span>
        <p className="tree-root__question">{tree.root}</p>
        {(answer || hasConfidence) && (
          <div className="tree-root__foot">
            {answer ? (
              <span className="tree-root__answer">
                <span className="tree-root__answer-label">{t.answer}</span>
                <span className="tree-root__answer-value">{answer}</span>
              </span>
            ) : (
              <span className="tree-root__confidence-label">{t.confidence}</span>
            )}
            <ConfidenceRing value={tree.confidence} size={44} />
          </div>
        )}
      </div>

      {branches.map((branch, index) => {
        const open = selectedId === branch.id;
        return (
          <div
            key={branch.id}
            className={`tree-row ${dim(branch.id) ? 'tree-row--dim' : ''}`}
            style={{ gridRow: index + 1, '--i': index }}
          >
            <button
              type="button"
              ref={setNode(branch.id)}
              className={[
                'tree-branch',
                `tree-branch--${branch.status}`,
                open && 'tree-branch--open',
              ].filter(Boolean).join(' ')}
              onClick={() => onSelect(open ? '' : branch.id)}
              onMouseEnter={() => onActivate(branch.id)}
              onMouseLeave={() => onActivate('')}
              onFocus={() => onActivate(branch.id)}
              onBlur={() => onActivate('')}
              aria-expanded={open}
              aria-controls="tree-detail"
              aria-label={t.openBranch(branch.title)}
            >
              <span className="tree-branch__status">
                <HugeiconsIcon icon={STATUS_ICONS[branch.status]} size={14} strokeWidth={2} aria-hidden="true" />
                {t.status[branch.status]}
              </span>
              <span className="tree-branch__title">{branch.title}</span>
              {branch.summary && <span className="tree-branch__summary">{branch.summary}</span>}
              <span className="tree-branch__foot">
                <Supporters people={branch.supporters} colorOf={colorOf} />
                <FitMeter value={branch.fit} compact />
                <HugeiconsIcon icon={ArrowRight01Icon} size={16} className="tree-branch__more" aria-hidden="true" />
              </span>
            </button>

            {branch.outcomes.length > 0 && (
              <ul className="tree-outcomes">
                {branch.outcomes.map((outcome) => (
                  // розвилка веде до свого шляху: клік відкриває його деталі (з клавіатури — кнопка шляху)
                  <li
                    key={outcome.id}
                    ref={setNode(outcome.id)}
                    className={`tree-outcome tree-outcome--${outcome.tone}`}
                    onClick={() => onSelect(branch.id)}
                    onMouseEnter={() => onActivate(branch.id)}
                    onMouseLeave={() => onActivate('')}
                  >
                    <span className="tree-outcome__dot" aria-hidden="true" />
                    <span className="sr-only">{t.tone[outcome.tone]}: </span>
                    {outcome.condition && <span className="tree-outcome__if">{outcome.condition}</span>}
                    {outcome.result && <span className="tree-outcome__then">{outcome.result}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

DecisionTreeMap.propTypes = {
  tree: PropTypes.shape({
    root: PropTypes.string,
    mode: PropTypes.string,
    answer: PropTypes.string,
    confidence: PropTypes.number,
    branches: PropTypes.arrayOf(PropTypes.object).isRequired,
  }).isRequired,
  colorOf: PropTypes.func.isRequired,
  activeId: PropTypes.string,
  selectedId: PropTypes.string,
  onActivate: PropTypes.func.isRequired,
  onSelect: PropTypes.func.isRequired,
};
