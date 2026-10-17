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
    emailLabel: 'Пошта',
    emailPlaceholder: 'name@mail.com',
    passwordLabel: 'Пароль',
    passwordPlaceholder: 'Введіть пароль',
    submit: 'Увійти',
    submitting: 'Входимо…',
    switchToRegister: 'Ще не маєте акаунту?',
    invalidToast: 'Перевірте дані для входу',
    toastLabels: { email: 'Пошта', password: 'Пароль' },
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
    toastLabels: {
      name: 'Ім’я',
      email: 'Пошта',
      password: 'Пароль',
      repeat: 'Повтор пароля',
    },
    failedToast: 'Помилка',
  },

  account: {
    title: 'Заглушка',
  },

  home: {
    title: 'Вітаємо в Clarity',
    hello: (name) => `Ви увійшли як ${name}`,
    email: (email) => `Пошта: ${email}`,
    stub: 'Це заглушка головної сторінки для перевірки авторизації. Дискусії AI з’являться тут пізніше.',
    loading: 'Завантаження…',
    unauthorized: 'Сесія завершена, увійдіть ще раз',
    logout: 'Вийти',
    loggingOut: 'Виходимо…',
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
