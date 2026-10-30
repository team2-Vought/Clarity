// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from './Toast';
import AboutSettings from './AboutSettings';
import { me, updateProfile } from '../api/auth';

vi.mock('../api/auth', () => ({ me: vi.fn(), updateProfile: vi.fn() }));

const EMPTY = {
  enabled: true,
  location: '',
  age: '',
  family: '',
  occupation: '',
  finances: '',
  finances_note: '',
  values: [],
  risk: '',
  notes: '',
};

const renderTab = () =>
  render(
    <ToastProvider>
      <AboutSettings />
    </ToastProvider>
  );

beforeEach(() => {
  vi.mocked(me).mockResolvedValue({ name: 'Оксана', avatar: '', about: EMPTY });
  vi.mocked(updateProfile).mockImplementation(async ({ about }) => ({
    name: 'Оксана',
    avatar: '',
    about,
  }));
});

describe('AboutSettings', () => {
  it('зберігає заповнене однією кнопкою', async () => {
    const user = userEvent.setup();
    renderTab();
    const save = await screen.findByRole('button', { name: 'Зберегти' });
    expect(save).toBeDisabled();

    await user.type(screen.getByRole('textbox', { name: 'Країна та місто' }), 'Україна, Львів');
    await user.click(screen.getByRole('radio', { name: '25–34' }));
    await user.click(screen.getByRole('checkbox', { name: 'Сім’я' }));
    await user.click(screen.getByRole('radio', { name: 'Обережно' }));
    expect(screen.getByText('Уникаєте ризику й цінуєте запас міцності.')).toBeInTheDocument();
    expect(screen.getByText('Є незбережені зміни')).toBeInTheDocument();

    await user.click(save);
    expect(updateProfile).toHaveBeenCalledWith({
      about: { ...EMPTY, location: 'Україна, Львів', age: '25_34', values: ['family'], risk: 'cautious' },
    });
    expect(await screen.findByText('Профіль збережено')).toBeInTheDocument();
    expect(save).toBeDisabled();
  });

  it('вибраний вік знімається повторним кліком, а цінностей — не більше п’яти', async () => {
    const user = userEvent.setup();
    renderTab();
    const age = await screen.findByRole('radio', { name: '35–44' });
    await user.click(age);
    expect(age).toHaveAttribute('aria-checked', 'true');
    await user.click(age);
    expect(age).toHaveAttribute('aria-checked', 'false');

    for (const name of ['Стабільність', 'Свобода', 'Сім’я', 'Кар’єра', 'Гроші']) {
      await user.click(screen.getByRole('checkbox', { name }));
    }
    expect(screen.getByRole('checkbox', { name: 'Здоров’я' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Гроші' })).toBeEnabled();
  });
});
