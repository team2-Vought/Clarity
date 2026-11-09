import PropTypes from 'prop-types';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowRight01Icon, Cancel01Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import { orderBranches } from '../tree/treeModel';
import { copy } from '../../copy';

const t = copy.tree;

/**
 * Розділ висновку «Розглянуті шляхи»: з чого команда обирала. Обраний шлях —
 * з галочкою, альтернативи — звичайним текстом, відкинуті — сірим. Клік по шляху
 * відкриває дерево рішень одразу з його деталями. Поки дерева ще немає — один
 * рядок, що пропонує його скласти.
 */
export default function TreePaths({ tree, onOpen }) {
  const branches = orderBranches(tree?.branches);

  return (
    <section className="chat__summary-group chat__summary-group--paths">
      <h4 className="chat__summary-label">{t.pathsTitle}</h4>
      {branches.length > 0 ? (
        <>
          <ul className="chat__paths">
            {branches.map((branch) => (
              <li key={branch.id}>
                <button
                  type="button"
                  className={`chat__path chat__path--${branch.status}`}
                  onClick={() => onOpen(branch.id)}
                  aria-haspopup="dialog"
                >
                  <span className="chat__path-mark" aria-hidden="true">
                    {branch.status === 'chosen' && <HugeiconsIcon icon={Tick02Icon} size={14} strokeWidth={2.4} />}
                    {branch.status === 'rejected' && <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={2.4} />}
                  </span>
                  <span className="chat__path-title">
                    {branch.title}
                    {branch.status !== 'alternative' && (
                      <span className="chat__path-status">{t.pathStatus[branch.status]}</span>
                    )}
                  </span>
                  {branch.fit !== null && branch.fit !== undefined && (
                    <span className="chat__path-fit" title={t.fit}>
                      <span className="chat__summary-meter" aria-hidden="true">
                        <span style={{ width: `${branch.fit}%` }} />
                      </span>
                      <span className="chat__path-fit-value">
                        {branch.fit}%<span className="sr-only">{` — ${t.fit}`}</span>
                      </span>
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="chat__paths-open" onClick={() => onOpen('')} aria-haspopup="dialog">
            {t.pathsOpen}
            <HugeiconsIcon icon={ArrowRight01Icon} size={16} aria-hidden="true" />
          </button>
        </>
      ) : (
        <button type="button" className="chat__paths-open" onClick={() => onOpen('')} aria-haspopup="dialog">
          {t.pathsEmpty}
          <HugeiconsIcon icon={ArrowRight01Icon} size={16} aria-hidden="true" />
        </button>
      )}
    </section>
  );
}

TreePaths.propTypes = {
  tree: PropTypes.shape({ branches: PropTypes.array }),
  onOpen: PropTypes.func.isRequired,
};
