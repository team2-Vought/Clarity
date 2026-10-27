/** Відповідь на уточнення модератора: власний текст, якщо заповнений, інакше обраний варіант. */
export function answerOf(answer) {
  return (answer?.custom || '').trim() || answer?.option || '';
}
