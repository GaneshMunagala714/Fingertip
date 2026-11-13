import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import Gallery from './Gallery'
import { MeetLive } from './screens/Meet'
import { SignsLab } from './screens/SignsLab'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {location.hash === '#gallery' ? <Gallery />
      : location.hash === '#meet' ? <MeetLive />
      : location.hash === '#signs-lab' ? <SignsLab onDone={() => { location.hash = ''; location.reload() }} />
      : <App />}
  </StrictMode>,
)

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('/sw.js').catch(() => {})
}
