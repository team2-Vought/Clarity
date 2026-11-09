import babel from '@rolldown/plugin-babel'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'

// Content-Security-Policy зібраного інтерфейсу. Лише при збірці: dev-сервер Vite
// живе на inline-скриптах і HMR. frame-ancestors у <meta> не діє — його ставить nginx
// (README, «Продакшн»).
function cspPlugin(apiUrl) {
  const api = apiUrl ? new URL(apiUrl).origin : ''
  const google = 'https://accounts.google.com'
  const policy = [
    "default-src 'self'",
    `script-src 'self' ${google}`,
    // React ставить стилі через style-атрибути, Google — свої для вікна входу
    `style-src 'self' 'unsafe-inline' ${google}`,
    // аватарки — data URL; значки джерел — з DuckDuckGo
    "img-src 'self' data: blob: https://icons.duckduckgo.com",
    "font-src 'self'",
    `connect-src 'self' ${api} ${google}`.replace(/\s+/g, ' ').trim(),
    `frame-src ${google}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')
  return {
    name: 'clarity-csp',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' },
    ],
  }
}

// Картинка прев'ю в месенджерах: краулери хочуть абсолютну адресу, а домен
// відомий лише під час деплою (VITE_SITE_URL). Без нього — шлях від кореня сайту.
function ogImagePlugin(siteUrl) {
  const image = `${(siteUrl || '').replace(/\/$/, '')}/og-image.jpg`
  return {
    name: 'clarity-og-image',
    transformIndexHtml: (html) => html.replace('__OG_IMAGE__', image),
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    // React Compiler сам мемоізує компоненти: опитування чату й набір у полі
    // вводу більше не перерендерюють (і не розбирають заново) усі репліки
    plugins: [
      react(),
      babel({ presets: [reactCompilerPreset()] }),
      cspPlugin(env.VITE_API_URL),
      ogImagePlugin(env.VITE_SITE_URL),
    ],
    // дата збірки — у технічних даних звернення «Знайшли баги?»
    define: {
      __APP_BUILD__: JSON.stringify(process.env.VITE_APP_BUILD || new Date().toISOString().slice(0, 10)),
    },
    build: {
      // великі лише pdfmake і його шрифти (~1 МБ кожен), а їх summaryPdf.js вантажить
      // окремо, тільки коли людина зберігає PDF — на звичайне відкриття сторінки не впливають
      chunkSizeWarningLimit: 1000,
    },
    server: {
      proxy: {
        '/api': {
          target: 'http://localhost:8000',
          changeOrigin: true,
        },
      },
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    test: {
      // сторінки перемикаються на jsdom коментарем `@vitest-environment jsdom` у файлі
      environment: 'node',
      include: ['src/**/*.test.{js,jsx}'],
      setupFiles: ['src/test/setup.js'],
    },
  }
})
