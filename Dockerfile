# Clarity: один Dockerfile, три цілі.
#   docker build --target backend .   — API (gunicorn) і воркер дискусій
#   docker build --target web .       — nginx: зібраний інтерфейс + проксі на API
# Разом їх запускає docker-compose.yml.

# ---------- збірка інтерфейсу ----------
FROM node:22-alpine AS frontend-build
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# контакт і оператор для Політики конфіденційності/Умов, адреса сайту для
# картинки прев'ю (og:image) — під час збірки
ARG VITE_CONTACT_EMAIL=
ARG VITE_LEGAL_OPERATOR=
ARG VITE_SITE_URL=
ENV VITE_CONTACT_EMAIL=$VITE_CONTACT_EMAIL VITE_LEGAL_OPERATOR=$VITE_LEGAL_OPERATOR VITE_SITE_URL=$VITE_SITE_URL
RUN npm run build

# ---------- API і воркер ----------
FROM python:3.14-slim AS backend
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    FRONTEND_INDEX_HTML=/app/frontend/index.html
WORKDIR /app/backend
COPY backend/requirements.txt ./
RUN pip install -r requirements.txt
COPY backend/ ./
# /shared/<token> віддає index.html збірки з OG-тегами дискусії
COPY --from=frontend-build /src/frontend/dist/index.html /app/frontend/index.html
# статика адмінки (whitenoise); ключ лише для збірки — справжній задається в .env
RUN DJANGO_SECRET_KEY=build-only python manage.py collectstatic --noinput
RUN useradd --system --uid 10001 clarity && chown -R clarity /app
USER clarity
EXPOSE 8000
CMD ["gunicorn", "backend.wsgi", "--bind", "0.0.0.0:8000", "--workers", "3", "--timeout", "60", "--access-logfile", "-"]

# ---------- інтерфейс ----------
FROM nginx:1.27-alpine AS web
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=frontend-build /src/frontend/dist /usr/share/nginx/html
EXPOSE 80
