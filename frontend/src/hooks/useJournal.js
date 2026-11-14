import { useState } from 'react';

/**
 * «У журнал» — іконка в рядку дій під висновком і форма, що розкривається під
 * рядком, — щоб згодом Clarity спитала «Як воно?». Стан спільний: його тримає
 * `useJournal`, а кнопка й форма стоять у різних місцях картки.
 */
export function useJournal(discussion, { openInitially = false } = {}) {
  const [entry, setEntry] = useState(discussion.journal || null);
  // з журналу («Записати рішення») форма відкривається одразу
  const [open, setOpen] = useState(openInitially && !discussion.journal);
  return { entry, setEntry, open, setOpen };
}
