// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TreePaths from './TreePaths';

const branch = (id, title, status, fit) => ({ id, title, status, fit, supporters: [], pros: [], cons: [], outcomes: [] });

afterEach(cleanup);

describe('розділ «Розглянуті шляхи»', () => {
  it('обраний шлях першим, клік по шляху відкриває дерево з його деталями', async () => {
    const onOpen = vi.fn();
    const tree = {
      branches: [branch('b2', 'Лишитися', 'rejected', 30), branch('b1', 'Переїхати', 'chosen', 82), branch('b3', 'Пізніше', 'alternative', null)],
    };
    render(<TreePaths tree={tree} onOpen={onOpen} />);
    const rows = screen.getAllByRole('button').slice(0, 3);
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Переїхати'),
      expect.stringContaining('Пізніше'),
      expect.stringContaining('Лишитися'),
    ]);
    expect(rows[0]).toHaveTextContent('обрано');
    expect(rows[0]).toHaveTextContent('82%');
    expect(rows[2]).toHaveTextContent('відкинуто');

    await userEvent.click(rows[2]);
    expect(onOpen).toHaveBeenCalledWith('b2');
    await userEvent.click(screen.getByRole('button', { name: /Відкрити дерево рішень/ }));
    expect(onOpen).toHaveBeenLastCalledWith('');
  });

  it('поки дерева немає — один рядок, що пропонує його скласти', async () => {
    const onOpen = vi.fn();
    render(<TreePaths tree={null} onOpen={onOpen} />);
    await userEvent.click(screen.getByRole('button', { name: /Подивитися, які шляхи розглядала команда/ }));
    expect(onOpen).toHaveBeenCalledWith('');
  });
});
