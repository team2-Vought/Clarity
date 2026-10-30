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

DJANGO_EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend
EMAIL_HOST=smtp.example.com
EMAIL_HOST_USER=...
EMAIL_HOST_PASSWORD=...
DEFAULT_FROM_EMAIL=Clarity <no-reply@clarity.example.com>
```

**База.** З `DATABASE_URL` бекенд працює з Postgres (драйвер `psycopg` уже в
`requirements.txt`). SQLite лишається для розробки.

**Воркер дискусій.** З `DISCUSSION_RUNNER=worker` вебсервер не виконує
дискусії сам, а ставить їх у чергу в базі. Виконує їх окремий процес:

```bash
.venv/bin/python manage.py discussion_worker
```

Черга живе в базі, тож перезапуск сервера чи воркера не губить дискусій:
перерваний крок продовжиться, щойно сплине його lease (`LLM_ADVANCE_LEASE_SECONDS`).
Воркерів може бути кілька — один крок однієї дискусії виконує лише один із
них. Скільки дискусій веде кожен воркер, задає `DISCUSSION_WORKER_CONCURRENCY`.
Воркер завершується за `SIGTERM`, доробивши поточні кроки.

**Нагадування журналу рішень.** Листи «Як ваше рішення?» надсилає той самий
воркер раз на `DISCUSSION_REMINDER_INTERVAL` секунд (типово 10 хвилин). Без
воркера (`DISCUSSION_RUNNER=thread`) запускайте їх, напр., із cron:

```bash
.venv/bin/python manage.py send_decision_reminders
```

**Вкладення.** До питання можна додати до `ATTACHMENTS_MAX` файлів (PDF, Word,
текст, фото) по 10 МБ. Сервер зберігає лише витягнутий текст. Фото читає
модель, що бачить зображення (OpenAI, Anthropic, Gemini, Qwen на Groq), —
без такої моделі приймаються лише файли з текстом.

**Процеси.** Отже, у продакшні їх три:

1. API — будь-який WSGI-сервер, напр. `gunicorn backend.wsgi`
   (встановлюється окремо);
2. воркер — `manage.py discussion_worker`;
3. фронтенд — `npm run build`, а вміст `frontend/dist/` віддає будь-який
   статичний сервер, що проксіює `/api/` на API (або задайте `VITE_API_URL`
   під час збірки).

**Вхід через Google** — `GOOGLE_CLIENT_ID` з Google Cloud Console; адресу
фронтенду додайте в «Authorized JavaScript origins».

## Ліміти

Денні ліміти на користувача — `DISCUSSION_DAILY_LIMIT` (нових дискусій) і
`DISCUSSION_DAILY_ADVANCE_LIMIT` (AI-відповідей). Користувачі можуть додати
власні API-ключі в налаштуваннях; ключі зберігаються зашифрованими.
