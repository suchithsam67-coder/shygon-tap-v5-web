import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
// Fonts are served from this site, not Google Fonts, so opening a page shares
// nothing with a third party (see the Cookie Policy). Same weights as before;
// each file declares unicode ranges, so only the scripts a page uses download.
import '@fontsource/geist/400.css'
import '@fontsource/geist/500.css'
import '@fontsource/geist/600.css'
import '@fontsource/geist/700.css'
import '@fontsource/geist/800.css'
import '@fontsource/inter/300.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/inter/800.css'
import '@fontsource/inter/900.css'
import './index.css'
import './styles/tap.css'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary'
import { installGlobalErrorHandlers } from './lib/reportError'

installGlobalErrorHandlers()

/**
 * The session providers used to be mounted here, around everything. They now
 * live in AccountApp, which is loaded on demand — the public Tap needs no
 * session, and mounting the providers here would have pulled the Supabase SDK
 * into the bundle it downloads. See the note in App.tsx.
 */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)
