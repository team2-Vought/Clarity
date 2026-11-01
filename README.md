# Clarity

Clarity допомагає ухвалювати рішення: кілька AI-учасників із різними
характерами обговорюють ваше питання, модератор зводить аргументи в рішення,
AI Devil шукає в ньому слабкі місця, і наприкінці ви отримуєте висновок —
з плюсами, ризиками, думкою меншості й наступним кроком.

```
питання → уточнення модератора → вступ → дебати (2–3 раунди або до згоди)
        → рішення модератора → перевірка AI Devil → відповідь учасників → висновок
```

Інтерфейс — українською та англійською (за мовою пристрою або вибором у
налаштуваннях); тією ж мовою пишуть і AI.

## Що всередині

| Частина | Стек | Де |
| --- | --- | --- |
| API, рушій дебатів | Django 6, Django REST Framework | `backend/` |
| Інтерфейс | React 19, Vite, React Router | `frontend/` |
| Моделі | OpenAI-сумісні API (OpenAI, Gemini, Groq, Cerebras, DeepSeek, Mistral, OpenRouter, Ollama, власний endpoint) і Anthropic | `backend/discussions/services/providers.py` |
| Пошук | Tavily, Brave, SearXNG або Wikipedia | `backend/discussions/services/search.py` |

Головне в бекенді:

- `discussions/services/engine/` — рушій: стан-машина, яка робить один крок
  дискусії за виклик (`core.py`), готує виклики (`planning.py`), викликає
  моделі (`calls.py`) і розбирає відповіді (`parsing.py`). Опис фаз — у
  docstring пакета.
- `discussions/services/prompts/` — промпти учасників, суддів і уточнення.
- `discussions/services/runner.py` — хто виконує кроки: потік у вебсервері
  або окремий воркер (див. нижче).
- `discussions/journal.py` — журнал рішень: людина фіксує, що вирішила, а
  згодом Clarity питає «Як воно?» (`services/reminders.py` — листи).
- `discussions/services/attachments.py` — вкладення: текст із PDF, Word,
  текстових файлів і фото (фото читає модель, що бачить зображення).
- `accounts/` — реєстрація, вхід (пошта або Google), відновлення пароля,
  профіль «Про мене».

## Запуск для розробки

Потрібні Python 3.12+ і Node.js 20+.

### Бекенд

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env
```

У `backend/.env` задайте хоча б один ключ моделі (напр. `GROQ_API_KEY` —
у Groq є безкоштовний тариф). Усі змінні описані в `.env.example`.

```bash
.venv/bin/python manage.py migrate
.venv/bin/python manage.py runserver
```

API працює на `http://localhost:8000/api/`.

### Фронтенд

```bash
cd frontend
npm install
npm run dev
```

Відкрийте `http://localhost:5173`. Dev-сервер Vite проксіює `/api` на
`localhost:8000`, тож `VITE_API_URL` можна не задавати.

### Листи

Без налаштованої пошти листи (відновлення пароля) друкуються в консоль
`runserver` — посилання з листа можна відкрити просто звідти.

## Тести

```bash
cd backend && .venv/bin/python manage.py test
```

```bash
cd frontend && npm test && npm run lint
```

## Продакшн

Відмінності від розробки — у `backend/.env`:

```bash
DJANGO_DEBUG=false
DJANGO_SECRET_KEY=<довгий випадковий рядок>
DJANGO_ALLOWED_HOSTS=clarity.example.com
CORS_ALLOWED_ORIGINS=https://clarity.example.com
FRONTEND_URL=https://clarity.example.com

DATABASE_URL=postgres://clarity:password@db:5432/clarity
DISCUSSION_RUNNER=worker

DJANGO_BEHIND_PROXY=true
DJANGO_ADMIN_URL=<нестандартна-адреса>/

DJANGO_EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend
EMAIL_HOST=smtp.example.com
EMAIL_HOST_USER=...
EMAIL_HOST_PASSWORD=...
DEFAULT_FROM_EMAIL=Clarity <no-reply@clarity.example.com>
```

**База.** З `DATABASE_URL` бекенд працює з Postgres (драйвер `psycopg` уже в
`requirements.txt`). SQLite лишається для розробки.

**Воркер дискусій — у продакшні обов'язково.** Режим `thread` (типовий для
розробки) веде дискусії потоками вебсервера: перезапуск їх обриває, а кількість
обмежує лише `DISCUSSION_THREAD_MAX` (типово 4, решта отримує «сервер зайнятий»).
`manage.py check --deploy` попереджає, якщо воркер не ввімкнено.

З `DISCUSSION_RUNNER=worker` вебсервер не виконує
дискусії сам, а ставить їх у чергу в базі. Виконує їх окремий процес:

```bash
.venv/bin/python manage.py discussion_worker
```

Черга живе в базі, тож перезапуск сервера чи воркера не губить дискусій:
перерваний крок продовжиться, щойно сплине його lease (`LLM_ADVANCE_LEASE_SECONDS`).
Воркерів може бути кілька — один крок однієї дискусії виконує лише один із
них. Скільки дискусій веде кожен воркер, задає `DISCUSSION_WORKER_CONCURRENCY`.
Воркер завершується за `SIGTERM`, доробивши поточні кроки.

**Моніторинг помилок.** Задайте `SENTRY_DSN` (Sentry чи сумісний, напр.
GlitchTip) — туди підуть необроблені помилки API й усе, що воркер пише в лог
з рівнем ERROR. Пошта, IP, cookie й тіла запитів не надсилаються.
Додатково: `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`, `SENTRY_TRACES_SAMPLE_RATE`.

**Нагадування журналу рішень.** Листи «Як ваше рішення?» надсилає той самий
воркер раз на `DISCUSSION_REMINDER_INTERVAL` секунд (типово 10 хвилин). Без
воркера (`DISCUSSION_RUNNER=thread`) запускайте їх, напр., із cron:

```bash
.venv/bin/python manage.py send_decision_reminders
```

**Вкладення.** До питання можна додати до `ATTACHMENTS_MAX` файлів (PDF, Word,
текст, фото) по 10 МБ. Файлів, ще не доданих до питання, — до
`ATTACHMENTS_PENDING_MAX` (10) на людину. PDF розбирається в окремому процесі й
не довше `ATTACHMENTS_PDF_TIMEOUT_SECONDS` (15 с). Сервер зберігає лише витягнутий текст. Фото читає
модель, що бачить зображення (OpenAI, Anthropic, Gemini, Qwen на Groq), —
без такої моделі приймаються лише файли з текстом. Файли можна додати й до
уточнення в чаті; усього на дискусію — до `ATTACHMENTS_TOTAL_MAX` (6).

**Процеси.** Отже, у продакшні їх три:

1. API — будь-який WSGI-сервер, напр. `gunicorn backend.wsgi`
   (встановлюється окремо);
2. воркер — `manage.py discussion_worker`;
3. фронтенд — `npm run build`, а вміст `frontend/dist/` віддає будь-який
   статичний сервер, що проксіює `/api/` на API (або задайте `VITE_API_URL`
   під час збірки).

**Вхід через Google** — `GOOGLE_CLIENT_ID` з Google Cloud Console; адресу
фронтенду додайте в «Authorized JavaScript origins».

**nginx.** Інтерфейс і API мають бути на одному домені: вхід живе в
httpOnly-cookie з `SameSite=Lax`. Мінімальний сервер:

```nginx
server {
    server_name clarity.example.com;
    root /srv/clarity/frontend/dist;

    # найбільший запит — файл вкладення (10 МБ) із запасом
    client_max_body_size 11m;

    add_header Referrer-Policy same-origin always;
    add_header X-Content-Type-Options nosniff always;
    # решту CSP збірка кладе в <meta>; frame-ancestors там не діє
    add_header Content-Security-Policy "frame-ancestors 'none'" always;

    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    # публічні посилання: бекенд додає OG-теги для прев'ю в месенджерах
    location /shared/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    location / {
        try_files $uri /index.html;
    }
    # index.html не кешуємо: після деплою браузер одразу бере нові бандли.
    # add_header у location скасовує заголовки сервера — тож повторюємо їх
    location = /index.html {
        add_header Cache-Control "no-cache" always;
        add_header Referrer-Policy same-origin always;
        add_header X-Content-Type-Options nosniff always;
        add_header Content-Security-Policy "frame-ancestors 'none'" always;
    }
    # бандли мають хеш в імені — їх можна кешувати назавжди
    location /assets/ {
        add_header Cache-Control "public, max-age=31536000, immutable" always;
        add_header X-Content-Type-Options nosniff always;
    }
}
```

Після нового `npm run build` бекенд перезапускати не треба: прев'ю `/shared/`
саме помічає новий `index.html`.

Для `/shared/` бекенд читає зібраний `frontend/dist/index.html` (інший шлях —
`FRONTEND_INDEX_HTML`) і додає в нього назву й висновок дискусії: так
Telegram, Slack чи Viber показують прев'ю, а не просто «Clarity».

Перед Django рівно один проксі — тому `DJANGO_BEHIND_PROXY=true`
(`DJANGO_NUM_PROXIES=1`). Без проксі цей прапорець не вмикайте: тоді
`X-Forwarded-*` підробляє будь-хто.

**Адмінка** доступна лише на `DJANGO_ADMIN_URL` (у продакшні без неї вимкнена),
з тим самим лімітом спроб входу, що й API. Двофакторного входу в ній немає —
обмежте адресу ще й за IP у nginx (`allow`/`deny`) або через VPN.

**Листи журналу** мають посилання «відписатися» й заголовки `List-Unsubscribe`
та `List-Unsubscribe-Post` (RFC 8058): Gmail і Outlook показують кнопку відписки,
а листи рідше потрапляють у спам.

**Дані людини.** У «Налаштування → Дані й входи» — список пристроїв, де людина
в акаунті (вийти можна на кожному окремо), і експорт усіх даних одним
JSON-файлом. Його ж пропонує форма видалення акаунта.

**Безпека входу.** Вхід — окремий ключ на кожен пристрій у httpOnly-cookie,
діє `AUTH_TOKEN_DAYS` (30) днів; «Вийти» виходить лише на цьому пристрої,
зміна пароля — на всіх інших. Нова пошта діє після підтвердження листом;
стара адреса отримує попередження одразу після запиту (новий пароль скасовує
зміну) і лист, коли зміна відбулася, — тоді ж інші пристрої виходять з акаунта.
Якщо акаунт зареєстрували паролем, а потім у нього вперше входять через Google,
пароль скидається, а всі входи відкликаються: його міг задати хтось, хто не
володіє поштою.

Невдалі входи рахуються для пари «IP + пошта» (5 спроб — 10 хвилин паузи) і
разом для пошти з усіх адрес (50 за годину — година паузи для входу паролем).
Друга стеля стримує перебір з багатьох адрес; власниця тоді входить через
Google або відновлює пароль — це знімає блокування одразу.

## Ліміти

Денні ліміти на користувача — `DISCUSSION_DAILY_LIMIT` (нових дискусій) і
`DISCUSSION_DAILY_ADVANCE_LIMIT` (AI-відповідей). Рахуються лише виклики, за
які платить сервер: відповіді моделей на власних ключах людини в ліміт не
йдуть, а дискусія цілком на її ключах не впирається в жоден ліміт. Чат
показує, хто платить за дискусію. Користувачі можуть додати
власні API-ключі в налаштуваннях; ключі зберігаються зашифрованими.
