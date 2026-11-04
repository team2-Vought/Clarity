import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// DM Sans з власного сервера — без запитів до Google Fonts (GDPR)
import '@fontsource-variable/dm-sans/opsz.css'
import { ToastProvider } from './components/Toast'
import App from './App.jsx'
import { initVision } from './utils/vision'

// розбірливий шрифт для режиму для слабозорих підвантажується лише тим, хто його обрав
initVision()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
)
