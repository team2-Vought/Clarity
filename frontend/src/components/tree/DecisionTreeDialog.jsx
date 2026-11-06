import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import PropTypes from 'prop-types';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowLeft02Icon } from '@hugeicons/core-free-icons';
import DecisionTreeMap from './DecisionTreeMap';
import TreeBranchDetail from './TreeBranchDetail';
import ThoughtPath from './ThoughtPath';
import LogoTreeGrowing from './LogoTreeGrowing';
import LoadError from '../LoadError';
import { buildDecisionTree, fetchDecisionTree } from '../../api/discussions';
import { describeError } from '../../utils/errorKind';
import { copy } from '../../copy';

const t = copy.tree;

// як часто питати, чи готове дерево: модель думає від кількох секунд до хвилин
const POLL_MS = 2500;

const wait = (ms, signal) =>
  new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      window.clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });

/** Поки модератор думає: з логотипа проростають гілки, підписи під ним змінюються. */
function TreeGrowing() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setStep((current) => (current + 1) % t.buildingSteps.length), 2600);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div className="tree-growing" role="status" aria-live="polite">
      <div className="tree-growing__art">
        <LogoTreeGrowing />
      </div>
      <p className="tree-growing__title">{t.building}</p>
      <p className="tree-growing__step" key={step}>{t.buildingSteps[step]}</p>
    </div>
  );
}

/**
 * Дерево рішень на всю область сторінки — поруч із сайдбаром, який лишається
 * видимим і робочим (меню, історія, налаштування). Якщо дерева ще немає —
 * просить модератора скласти й показує, як воно «проростає». Чат під деревом
 * на цей час inert, Escape спершу закриває деталі шляху, потім дерево.
 */
export default function DecisionTreeDialog({
  discussionId,
  initialTree = null,
  initialBranch = '',
  colorOf,
  onTree,
  onClose,
}) {
  const dialogRef = useRef(null);
  const titleRef = useRef(null);
  const abortRef = useRef(null);
  const [tree, setTree] = useState(initialTree);
  const [state, setState] = useState(initialTree ? 'ready' : 'building');
  const [error, setError] = useState(null);
  const [activeId, setActiveId] = useState('');
  // відкрили клацанням по шляху у висновку — одразу з його деталями
  const [selectedId, setSelectedId] = useState(initialTree ? initialBranch : '');
  // Escape читає актуальний стан, не підписуючись наново щоразу
  const selectedRef = useRef('');
  selectedRef.current = selectedId;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // дерево складається один раз; повтор — лише якщо скласти не вдалося
  const build = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState('building');
    setError(null);
    try {
      let data = await buildDecisionTree(discussionId, { signal: controller.signal });
      // модель складає дерево у фоні — питаємо, доки не буде готове
      while (data.state === 'building') {
        await wait(POLL_MS, controller.signal);
        data = await fetchDecisionTree(discussionId, { signal: controller.signal });
      }
      if (data.state === 'ready' && data.tree) {
        setTree(data.tree);
        setState('ready');
        onTree?.(data.tree);
        return;
      }
      setError({ kind: 'generic', text: data.error || t.loadError });
      setState('error');
    } catch (err) {
      if (err?.name === 'AbortError') return;
      setError(describeError(err, t.loadError));
      setState('error');
    }
  }, [discussionId, onTree]);

  useEffect(() => {
    const dialog = dialogRef.current;
    // немодальне: сайдбар поруч має лишатися клікабельним
    if (dialog && !dialog.open) {
      if (typeof dialog.show === 'function') dialog.show();
      else dialog.setAttribute('open', '');
    }
    // чат під деревом — поза фокусом і скрінрідером, поки дерево відкрите
    const covered = dialog?.parentElement
      ? [...dialog.parentElement.children].filter((el) => el !== dialog && !el.inert)
      : [];
    covered.forEach((el) => {
      el.inert = true;
    });
    const onKey = (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      // меню, відкрите поверх дерева, закривається своїм Escape
      if (document.querySelector('.app-shell__drawer--open')) return;
      event.preventDefault();
      if (selectedRef.current) setSelectedId('');
      else onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    // фокус — на заголовок, а не на першу кнопку: скрінрідер читає, що відкрилось
    titleRef.current?.focus({ preventScroll: true });
    if (!initialTree) build();
    return () => {
      abortRef.current?.abort();
      document.removeEventListener('keydown', onKey);
      covered.forEach((el) => {
        el.inert = false;
      });
    };
    // складаємо лише раз, коли вікно відкрилось
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = tree?.branches?.find((branch) => branch.id === selectedId) || null;

  return createPortal(
    <dialog
      ref={dialogRef}
      className="tree-dialog"
      aria-labelledby="tree-dialog-title"
    >
      {/* заголовок — для скрінрідера; на екрані замість шапки лише кнопка «Назад» */}
      <h2 id="tree-dialog-title" className="sr-only" ref={titleRef} tabIndex={-1}>
        {tree?.root ? `${t.title}: ${tree.root}` : t.title}
      </h2>
      <button type="button" className="tree-back" onClick={onClose}>
        <HugeiconsIcon icon={ArrowLeft02Icon} size={18} strokeWidth={2} aria-hidden="true" />
        <span>{t.back}</span>
      </button>

      <div className={`tree-dialog__body ${selected ? 'tree-dialog__body--detail' : ''}`}>
        <div className="tree-dialog__canvas">
          {state === 'building' && <TreeGrowing />}
          {state === 'error' && error && (
            <LoadError kind={error.kind} text={error.text} title={t.loadError} onRetry={build} />
          )}
          {state === 'ready' && tree && (
            <>
              <DecisionTreeMap
                tree={tree}
                colorOf={colorOf}
                activeId={activeId}
                selectedId={selectedId}
                onActivate={setActiveId}
                onSelect={setSelectedId}
              />
              <ThoughtPath steps={tree.path} colorOf={colorOf} />
            </>
          )}
        </div>
        {state === 'ready' && selected && (
          <>
            {/* на телефоні деталі — аркуш знизу, тло під ним закриває його */}
            <button
              type="button"
              className="tree-dialog__scrim"
              onClick={() => setSelectedId('')}
              aria-label={t.closeDetails}
              tabIndex={-1}
            />
            <TreeBranchDetail branch={selected} colorOf={colorOf} onClose={() => setSelectedId('')} />
          </>
        )}
      </div>
    </dialog>,
    // в області сторінки, а не поверх усього екрана: сайдбар лишається видно
    document.querySelector('.app-shell__main') || document.body
  );
}

DecisionTreeDialog.propTypes = {
  discussionId: PropTypes.string.isRequired,
  initialTree: PropTypes.object,
  initialBranch: PropTypes.string,
  colorOf: PropTypes.func.isRequired,
  onTree: PropTypes.func,
  onClose: PropTypes.func.isRequired,
};
