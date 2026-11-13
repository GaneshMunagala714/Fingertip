import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import Gallery from './Gallery'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {location.hash === '#gallery' ? <Gallery /> : <App />}
  </StrictMode>,
)

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('/sw.js').catch(() => {})
}
