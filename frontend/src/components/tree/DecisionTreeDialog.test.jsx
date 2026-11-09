// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DecisionTreeDialog from './DecisionTreeDialog';
import { orderBranches } from './treeModel';
import { stanceLabelOf } from '../../utils/treeView';

vi.mock('../../api/discussions', () => ({ buildDecisionTree: vi.fn(), fetchDecisionTree: vi.fn() }));
const { buildDecisionTree, fetchDecisionTree } = await import('../../api/discussions');

const person = (slug, name) => ({ slug, name, color: '', avatar: '' });

const TREE = {
  root: 'Переїжджати до Львова?',
  mode: 'yes_no',
  answer: 'так',
  confidence: 78,
  branches: [
    {
      id: 'b2',
      title: 'Лишитися',
      status: 'rejected',
      summary: 'Без ризику, але й без росту.',
      fit: 30,
      supporters: [person('skeptic', 'Скептик')],
      pros: ['Без витрат'],
      cons: ['Зарплата не росте'],
      why: 'Підвищення ніхто не обіцяв.',
      outcomes: [],
    },
    {
      id: 'b1',
      title: 'Переїхати з підстраховкою',
      status: 'chosen',
      summary: 'Місяць віддалено, потім оренда.',
      fit: 82,
      supporters: [person('logician', 'Логік'), person('pragmatist', 'Прагматик')],
      pros: ['Зарплата +40%'],
      cons: ['Дві оренди місяць'],
      why: 'Віддалений місяць зняв ризик випробувального.',
      outcomes: [{ id: 'b1o1', condition: 'Якщо пройдете випробувальний', result: 'Ріст', tone: 'good' }],
    },
  ],
  path: [
    { stage: 'question', title: 'Гроші проти ризику', text: '', who: null },
    { stage: 'turn', title: 'Віддалений місяць', text: 'Спершу з дому.', who: person('pragmatist', 'Прагматик') },
  ],
};

const colorOf = () => '#eee';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('дерево рішень', () => {
  it('обраний шлях — першим, відкинуті — наприкінці', () => {
    expect(orderBranches(TREE.branches).map((b) => b.id)).toEqual(['b1', 'b2']);
  });

  it('відповідь «так/ні» в корені — мовою інтерфейсу, у вільному режимі її немає', () => {
    expect(stanceLabelOf('так', 'yes_no')).toBe('Так');
    expect(stanceLabelOf('Львів', 'choose_one')).toBe('Львів');
    expect(stanceLabelOf('Довге рішення', 'open')).toBe('');
  });

  it('показує готове дерево без запиту до сервера, а клік відкриває деталі шляху', async () => {
    render(<DecisionTreeDialog discussionId="d1" initialTree={TREE} colorOf={colorOf} onClose={() => {}} />);
    expect(buildDecisionTree).not.toHaveBeenCalled();
    expect(screen.getByText('Переїжджати до Львова?', { selector: '.tree-root__question' })).toBeInTheDocument();
    expect(screen.getByText('Хід думок')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Переїхати з підстраховкою/ }));
    const detail = screen.getByRole('complementary', { name: 'Деталі шляху' });
    expect(within(detail).getByText('Чому обрали')).toBeInTheDocument();
    expect(within(detail).getByText('Віддалений місяць зняв ризик випробувального.')).toBeInTheDocument();
    expect(within(detail).getByText('Прагматик')).toBeInTheDocument();
  });

  it('відкрите клацанням по шляху у висновку — одразу з його деталями', () => {
    render(<DecisionTreeDialog discussionId="d1" initialTree={TREE} initialBranch="b2" colorOf={colorOf} onClose={() => {}} />);
    const detail = screen.getByRole('complementary', { name: 'Деталі шляху' });
    expect(within(detail).getByText('Підвищення ніхто не обіцяв.')).toBeInTheDocument();
  });

  it('без дерева просить модератора скласти його й передає результат нагору', async () => {
    buildDecisionTree.mockResolvedValue({ tree: TREE, state: 'ready', error: '' });
    const onTree = vi.fn();
    render(<DecisionTreeDialog discussionId="d1" colorOf={colorOf} onTree={onTree} onClose={() => {}} />);
    expect(screen.getByText('Модератор розкладає дискусію на гілки…')).toBeInTheDocument();
    await waitFor(() => expect(onTree).toHaveBeenCalledWith(TREE));
    expect(buildDecisionTree).toHaveBeenCalledWith('d1', expect.any(Object));
    expect(screen.getByRole('button', { name: /Лишитися/ })).toBeInTheDocument();
  });

  it('поки модель складає дерево у фоні — опитує стан, доки воно не буде готове', async () => {
    buildDecisionTree.mockResolvedValue({ tree: null, state: 'building', error: '' });
    fetchDecisionTree.mockResolvedValue({ tree: TREE, state: 'ready', error: '' });
    render(<DecisionTreeDialog discussionId="d1" colorOf={colorOf} onClose={() => {}} />);
    expect(await screen.findByRole('button', { name: /Лишитися/ }, { timeout: 5000 })).toBeInTheDocument();
    expect(fetchDecisionTree).toHaveBeenCalledWith('d1', expect.any(Object));
  });

  it('помилка побудови з сервера — її текст і повтор', async () => {
    buildDecisionTree.mockResolvedValueOnce({ tree: null, state: 'error', error: 'Модель «Qwen» тимчасово не відповідає.' });
    render(<DecisionTreeDialog discussionId="d1" colorOf={colorOf} onClose={() => {}} />);
    expect(await screen.findByText('Модель «Qwen» тимчасово не відповідає.')).toBeInTheDocument();
  });

  it('збій — зрозуміле пояснення й повтор', async () => {
    buildDecisionTree.mockRejectedValueOnce(Object.assign(new Error('Сервер Clarity зараз недоступний'), { status: 502 }));
    render(<DecisionTreeDialog discussionId="d1" colorOf={colorOf} onClose={() => {}} />);
    expect(await screen.findByText('Не вдалося скласти дерево рішень')).toBeInTheDocument();
    buildDecisionTree.mockResolvedValueOnce({ tree: TREE, state: 'ready', error: '' });
    await userEvent.click(screen.getByRole('button', { name: 'Спробувати ще раз' }));
    expect(await screen.findByRole('button', { name: /Переїхати з підстраховкою/ })).toBeInTheDocument();
  });
});
