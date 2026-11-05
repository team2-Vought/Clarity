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

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // React Compiler сам мемоізує компоненти: опитування чату й набір у полі
  // вводу більше не перерендерюють (і не розбирають заново) усі репліки
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    cspPlugin(loadEnv(mode, process.cwd(), 'VITE_').VITE_API_URL),
  ],
  // дата збірки — у технічних даних звернення «Знайшли баги?»
  define: {
    __APP_BUILD__: JSON.stringify(process.env.VITE_APP_BUILD || new Date().toISOString().slice(0, 10)),
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
}))
