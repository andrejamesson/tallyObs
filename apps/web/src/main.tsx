import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import { BrowserRouter, HashRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'

const isNative = Capacitor.isNativePlatform()
const Router = isNative ? HashRouter : BrowserRouter

if (!isNative && import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js')
}
if (isNative && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => void r.unregister()))
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Router>
      <App />
    </Router>
  </StrictMode>,
)
