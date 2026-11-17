import { lang } from '../copy';

// Готові дискусії для галереї: справжні прогони рушія, збережені як JSON у
// public/examples/<slug>.<мова>.json (той самий формат, що й публічне посилання).
// Для кожної теми — мови, якими вона є: галерея показує лише теми мови інтерфейсу.
const EXAMPLES = {
  relocate: ['uk', 'en'],
  launch: ['uk', 'en'],
  masters: ['uk', 'en'],
  freelance: ['en'],
};

export const EXAMPLE_SLUGS = Object.keys(EXAMPLES).filter((slug) => EXAMPLES[slug].includes(lang));

export const isExample = (slug) => EXAMPLE_SLUGS.includes(slug);

/** Дискусія-приклад мовою інтерфейсу. */
export async function fetchExample(slug) {
  const res = await fetch(`/examples/${slug}.${lang}.json`);
  if (!res.ok) {
    const error = new Error(String(res.status));
    error.status = 404;
    throw error;
  }
  return res.json();
}
