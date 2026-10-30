import PropTypes from 'prop-types';
import { copy } from '../../copy';

const t = copy.chat;

/** Матриця критеріїв: середні бали учасників і зважений підсумок — чому переміг цей варіант. */
export default function MatrixTable({ matrix }) {
  if (!matrix?.rows?.length) return null;
  const best = Math.max(...matrix.rows.map((row) => row.total));
  return (
    <section className="chat__summary-group chat__summary-group--matrix">
      <h4 className="chat__summary-label">{t.matrixTitle}</h4>
      <div className="chat__matrix-scroll">
        <table className="chat__matrix">
          <thead>
            <tr>
              <th scope="col">{t.matrixOption}</th>
              {matrix.criteria.map((item) => (
                <th key={item.name} scope="col">
                  {item.name}
                  <small>{t.matrixWeight(item.weight)}</small>
                </th>
              ))}
              <th scope="col">{t.matrixTotal}</th>
            </tr>
          </thead>
          <tbody>
            {matrix.rows.map((row) => {
              const winner = row.option === matrix.winner;
              return (
                <tr key={row.option} className={winner ? 'chat__matrix-winner' : undefined}>
                  <th scope="row">
                    {row.option}
                    {winner && <span className="chat__matrix-badge">{t.matrixWinner}</span>}
                  </th>
                  {row.scores.map((score, index) => (
                    <td key={matrix.criteria[index].name} style={{ '--score': (score || 0) / 10 }}>
                      {score ?? '—'}
                    </td>
                  ))}
                  <td className="chat__matrix-total" style={{ '--share': best ? row.total / best : 0 }}>
                    {row.total}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="chat__matrix-hint">{t.matrixHint(matrix.participants)}</p>
    </section>
  );
}

MatrixTable.propTypes = {
  matrix: PropTypes.shape({
    criteria: PropTypes.arrayOf(PropTypes.shape({ name: PropTypes.string, weight: PropTypes.number })),
    rows: PropTypes.arrayOf(
      PropTypes.shape({
        option: PropTypes.string,
        scores: PropTypes.arrayOf(PropTypes.number),
        total: PropTypes.number,
      })
    ),
    winner: PropTypes.string,
    participants: PropTypes.number,
  }),
};
