import { Navigate, Route, Routes } from 'react-router-dom'
import SetupPage from './pages/SetupPage'
import SettingsPage from './pages/SettingsPage'
import TallyPage from './pages/TallyPage'

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<SetupPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/tally/:deviceId" element={<TallyPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <div
        style={{
          position: 'fixed',
          right: 10,
          bottom: 8,
          zIndex: 9999,
          fontSize: 10,
          letterSpacing: 0.3,
          color: 'rgba(255,255,255,0.45)',
          background: 'rgba(0,0,0,0.25)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 999,
          padding: '3px 8px',
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      >
        Powered by: Atec Consultoria
      </div>
    </>
  )
}
