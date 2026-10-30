import { describe, expect, it } from 'vitest';
import { describeSummary, describeVerdict, summaryDetailSteps } from './summary';

const votes = (...stances) => stances.map((stance, index) => ({ name: `Учасник ${index + 1}`, stance }));

describe('describeVerdict', () => {
  it('«так/ні» дає одне слово-вердикт', () => {
    expect(describeVerdict({ answer: 'так' }, 'yes_no', [])).toEqual({ kind: 'yes_no', yes: true });
    expect(describeVerdict({ answer: 'Ні' }, 'yes_no', [])).toEqual({ kind: 'yes_no', yes: false });
  });

  it('без чіткої відповіді «так/ні» показується як стаття', () => {
    expect(describeVerdict({ answer: '' }, 'yes_no', [])).toEqual({ kind: 'open' });
  });

  it('варіанти рахують голоси учасників і виділяють переможця', () => {
    const verdict = describeVerdict(
      { answer: 'Львів', agreement: { total: 3, votes: votes('Львів', 'львів', 'Київ') } },
      'choose_one',
      ['Київ', 'Львів', 'Одеса']
    );
    expect(verdict).toEqual({
      kind: 'choice',
      hasVotes: true,
      total: 3,
      options: [
        { label: 'Київ', winner: false, votes: 1 },
        { label: 'Львів', winner: true, votes: 2 },
        { label: 'Одеса', winner: false, votes: 0 },
      ],
    });
  });

  it('у старих підсумках без голосів лишає варіанти без смужок', () => {
    const verdict = describeVerdict({ answer: 'Одеса' }, 'choose_one', ['Київ', 'Одеса']);
    expect(verdict.hasVotes).toBe(false);
    expect(verdict.options.find((option) => option.winner).label).toBe('Одеса');
  });

  it('вільна відповідь — стаття', () => {
    expect(describeVerdict({ decision: 'Робіть так.' }, 'open', [])).toEqual({ kind: 'open' });
  });
});

describe('summaryDetailSteps', () => {
  it('рахує ті самі блоки, що показує підсумок', () => {
    const summary = {
      decision: 'Так.',
      confirmed: false,
      revision: 'Змінено.',
      confidence: 70,
      pros: ['А'],
      cons: ['Б'],
      recommendation: 'Далі.',
    };
    // вердикт, рядок згоди й оцінки, розділи (перегляд, аргументи, наступний крок)
    expect(summaryDetailSteps(summary, describeSummary(summary))).toBe(3);
    expect(summaryDetailSteps({ decision: 'Так.' }, describeSummary({ decision: 'Так.' }))).toBe(1);
  });
});

describe('план дій у підсумку', () => {
  it('бере кроки на тиждень і тригери, відкидаючи порожні', () => {
    const view = describeSummary({
      decision: 'Переїжджати.',
      next_steps: ['Порахувати бюджет', ' ', 'Подзвонити рієлтору'],
      change_triggers: ['Якщо оренда дорожча за 15 000 — переглянути'],
    });
    expect(view.plan).toEqual(['Порахувати бюджет', 'Подзвонити рієлтору']);
    expect(view.triggers).toHaveLength(1);
    expect(summaryDetailSteps({ decision: 'Переїжджати.' }, view)).toBe(2);
  });

  it('старий підсумок без плану — порожні списки', () => {
    const view = describeSummary({ decision: 'Так.' });
    expect(view.plan).toEqual([]);
    expect(view.triggers).toEqual([]);
  });
});
