// Єдине джерело українських текстів UI.
// Валідаційні повідомлення живуть у utils/validate.js, серверні — у api/client.js.

export const uk = {
  appName: 'Clarity',

  landing: {
    title: 'Clarity — просто про головне',
    text: 'Це тимчасова заглушка головної сторінки. Тут буде опис продукту, переваги та заклик до дії. Поки що можна перейти до реєстрації або входу.',
    login: 'Увійти',
    register: 'Створити акаунт',
    features: [
      { title: 'Що це?', text: 'Короткий опис продукту. Текст-заглушка для майбутнього лендінгу.' },
      { title: 'Для кого?', text: 'Кому буде корисно. Текст-заглушка для майбутнього лендінгу.' },
      { title: 'Статус', text: 'Фронтенд-прототип. Бекенд та справжній контент — у роботі.' },
    ],
    footer: '© 2026 Clarity',
    navLabel: 'Навігація',
    blocksLabel: 'Заглушки блоків',
  },

  login: {
    title: 'Увійти в акаунт',
    nameLabel: 'Ім’я',
    namePlaceholder: 'Ваше ім’я',
    emailLabel: 'Пошта',
    emailPlaceholder: 'name@mail.com',
    passwordLabel: 'Пароль',
    passwordPlaceholder: 'Введіть пароль',
    submit: 'Увійти',
    submitting: 'Входимо…',
    switchToRegister: 'Ще не маєте акаунту?',
    invalidToast: 'Перевірте дані для входу',
    failedToast: 'Не вдалося увійти',
    attemptsLeft: (left) =>
      left === 1 ? 'Залишилася 1 спроба' : `Залишилося ${left} спроби`,
    attemptsLocked: 'Ліміт спроб вичерпано, спробуйте через 10 хвилин',
  },

  register: {
    title: 'Створити акаунт',
    nameLabel: 'Ім’я',
    namePlaceholder: 'Як до вас звертатися',
    emailLabel: 'Пошта',
    emailPlaceholder: 'name@mail.com',
    passwordLabel: 'Пароль',
    passwordPlaceholder: 'Створіть пароль',
    repeatLabel: 'Повторіть пароль ще раз',
    repeatPlaceholder: 'Введіть пароль ще раз',
    submit: 'Створити',
    submitting: 'Створюємо…',
    switchToLogin: 'Вже є акаунт?',
    invalidToast: 'Помилка',
    failedToast: 'Помилка',
  },

  account: {
    title: 'Заглушка',
  },

  field: {
    showPassword: 'Показати пароль',
    hidePassword: 'Сховати пароль',
  },

  common: {
    backHome: '↖ На головну',
    close: 'Закрити',
    homeAria: 'Clarity — на головну',
  },
};
