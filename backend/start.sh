#!/bin/sh
# Старт API там, де немає окремого кроку міграцій (Render Free):
# спершу міграції, потім gunicorn. Порт і кількість процесів — з оточення.
set -e
python manage.py migrate --noinput
exec gunicorn backend.wsgi \
  --bind "0.0.0.0:${PORT:-8000}" \
  --workers "${GUNICORN_WORKERS:-3}" \
  --timeout 60 \
  --access-logfile -
