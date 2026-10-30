import { describe, expect, it } from 'vitest';
import { discussionMarkdown, markdownFileName } from './exportMarkdown';

const labels = {
  exportTitle: 'Дискусія',
  summary: 'Підсумок',
  summaryAnswer: 'Відповідь',
  summaryDecision: 'Рішення',
  summaryRevision: 'Що змінилось',
  summaryPros: 'Переваги',
  summaryCons: 'Недоліки',
  summaryRisks: 'Ризики',
  summaryDissent: 'Окремі думки',
  summaryNextStep: 'Що робити далі',
  summaryPlan: 'План на тиждень',
  summaryTriggers: 'Коли варто передумати',
  sources: 'Джерела',
};

const discussion = {
  title: 'Чи переїжджати?',
  question: 'Чи переїжджати?\nДеталі',
  messages: [
    { id: '1', role: 'user', persona_name: 'Оля', content: 'Чи переїжджати?\nДеталі' },
    { id: '2', role: 'ai', phase: 'opening', persona_name: 'Логік', content: 'Так, **варто**.', stance: 'так' },
    { id: '3', role: 'ai', phase: 'debate', round: 1, persona_name: 'Скептик', reply_to: 'Логік', content: 'Ні.' },
  ],
  final_summary: { decision: 'Переїжджати', answer: 'так', pros: ['Робота'], cons: [] },
  sources: [{ id: 1, title: 'Статистика', url: 'https://example.com' }],
};

describe('discussionMarkdown', () => {
  it('builds the full protocol with phases, replies and summary', () => {
    const text = discussionMarkdown(discussion, {
      labels,
      phaseLabel: (m) => (m.phase === 'opening' ? 'Вступ' : `Раунд ${m.round}`),
      authorOf: (m) => m.persona_name,
    });
    expect(text).toContain('# Чи переїжджати?');
    expect(text).toContain('> Деталі');
    expect(text).toContain('## Вступ');
    expect(text).toContain('**Скептик** → Логік');
    expect(text).toContain('**Рішення:** Переїжджати');
    expect(text).toContain('- Робота');
    expect(text).not.toContain('Недоліки');
    expect(text).toContain('1. [Статистика](https://example.com)');
    // запитання не дублюється окремою реплікою
    expect(text.match(/Деталі/g)).toHaveLength(1);
  });
});

describe('план дій у Markdown', () => {
  it('нумерує кроки й перелічує, коли варто передумати', () => {
    const text = discussionMarkdown(
      {
        ...discussion,
        final_summary: {
          decision: 'Переїжджати',
          recommendation: 'Порахувати бюджет',
          next_steps: ['Порахувати бюджет', 'Подзвонити рієлтору'],
          change_triggers: ['Якщо оренда дорожча — переглянути'],
        },
      },
      { labels, phaseLabel: () => '', authorOf: (m) => m.persona_name }
    );
    expect(text).toContain('**План на тиждень:**\n\n1. Порахувати бюджет\n2. Подзвонити рієлтору');
    expect(text).toContain('- Якщо оренда дорожча — переглянути');
    expect(text).not.toContain('Що робити далі');
  });
});

describe('markdownFileName', () => {
  it('drops characters that are not allowed in file names', () => {
    expect(markdownFileName('Що краще: A/B?')).toBe('Що краще A B.md');
    expect(markdownFileName('')).toBe('clarity.md');
  });
});
