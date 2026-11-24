import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/press-start-2p/latin-400.css'
import './index.css'
import App from './App.tsx'
import { I18nProvider } from './i18n/index.ts'
import { registerServiceWorker } from './pwa/updateStore.ts'
import { installPageZoomGuard } from './ui/pageZoomGuard.ts'
import { ErrorBoundary } from './ui/ErrorBoundary.tsx'

// iOS Safari ignores user-scalable=no: block page pinch outside the map canvas.
installPageZoomGuard()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <I18nProvider>
        <App />
      </I18nProvider>
    </ErrorBoundary>
  </StrictMode>,
)

// Offline shell and update prompt, in the built app only (the dev server must always serve fresh files).
if (import.meta.env.PROD) registerServiceWorker(`${import.meta.env.BASE_URL}sw.js`)
