/**
 * Точність порад за журналом: серед підсумованих рішень, де людина лишила
 * висновок Clarity без змін, — яка частка вийшла «Добре». Ті самі правила,
 * що й на сервері (discussions/journal.py, outcome_stats).
 */
export function journalStats(entries) {
  const reviewed = (entries || []).filter((entry) => entry.reviewed_at && entry.outcome);
  const count = (list, outcome) => list.filter((entry) => entry.outcome === outcome).length;
  const followed = reviewed.filter((entry) => entry.followed_advice === true);
  const followedGood = count(followed, 'good');
  return {
    total: reviewed.length,
    good: count(reviewed, 'good'),
    mixed: count(reviewed, 'mixed'),
    bad: count(reviewed, 'bad'),
    followed: followed.length,
    followedGood,
    rate: followed.length ? Math.round((100 * followedGood) / followed.length) : null,
  };
}
