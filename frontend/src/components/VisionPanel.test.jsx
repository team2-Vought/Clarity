// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import VisionDialog, { VisionTrigger } from './VisionDialog';
import VisionPanel from './VisionPanel';
import { resetVisionCache } from '../utils/vision';

const root = document.documentElement;

describe('панель «Зручність для зору»', () => {
  beforeEach(() => {
    localStorage.clear();
    resetVisionCache();
    for (const key of Object.keys(root.dataset)) delete root.dataset[key];
  });

  it('головний перемикач вмикає режим і підписує зміну для скрінрідера', async () => {
    const announced = [];
    render(<VisionPanel onAnnounce={(text) => announced.push(text)} />);
    const master = screen.getByRole('switch', { name: /Режим для слабозорих/ });
    expect(master).not.toBeChecked();

    await userEvent.click(master);

    expect(master).toBeChecked();
    expect(root.dataset.textScale).toBe('150');
    expect(root.dataset.contrast).toBe('high');
    expect(screen.getByRole('radio', { name: '150 %' })).toHaveAttribute('aria-checked', 'true');
    expect(announced).toEqual(['Режим для слабозорих увімкнено']);
  });

  it('окремі опції змінюються незалежно, а «Скинути все» повертає звичайний вигляд', async () => {
    render(<VisionPanel />);
    const reset = screen.getByRole('button', { name: 'Скинути все' });
    expect(reset).toBeDisabled();

    await userEvent.click(screen.getByRole('radio', { name: '125 %' }));
    await userEvent.click(screen.getByRole('switch', { name: /Підкреслені посилання/ }));
    expect(root.dataset.textScale).toBe('125');
    expect(root.dataset.links).toBe('underline');
    // не весь набір — головний перемикач лишається вимкненим
    expect(screen.getByRole('switch', { name: /Режим для слабозорих/ })).not.toBeChecked();

    await userEvent.click(reset);
    expect(root.dataset.textScale).toBeUndefined();
    expect(root.dataset.links).toBeUndefined();
    expect(reset).toBeDisabled();
  });

  it('кнопка «Для слабозорих» і Alt + Shift + V відкривають діалог', async () => {
    HTMLDialogElement.prototype.showModal ??= function showModal() {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close ??= function close() {
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    };
    render(
      <>
        <VisionTrigger />
        <VisionDialog />
      </>
    );
    expect(screen.queryByRole('switch', { name: /Режим для слабозорих/ })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /Для слабозорих/ }));
    expect(screen.getByRole('switch', { name: /Режим для слабозорих/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Закрити' }));
    expect(screen.queryByRole('switch', { name: /Режим для слабозорих/ })).toBeNull();

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { altKey: true, shiftKey: true, code: 'KeyV', key: 'V' })
      );
    });
    expect(screen.getByRole('switch', { name: /Режим для слабозорих/ })).toBeInTheDocument();
  });
});
