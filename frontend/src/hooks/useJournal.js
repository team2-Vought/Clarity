import { useState } from 'react';

/**
 * «У журнал» — іконка в рядку дій під висновком і форма, що розкривається під
 * рядком, — щоб згодом Clarity спитала «Як воно?». Стан спільний: його тримає
 * `useJournal`, а кнопка й форма стоять у різних місцях картки.
 */
export function useJournal(discussion) {
  const [entry, setEntry] = useState(discussion.journal || null);
  const [open, setOpen] = useState(false);
  return { entry, setEntry, open, setOpen };
}
