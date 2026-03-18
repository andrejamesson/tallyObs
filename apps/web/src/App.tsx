import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import SetupPage from './pages/SetupPage'
import SettingsPage from './pages/SettingsPage'
import TallyPage from './pages/TallyPage'
import { fetchGithubReleaseNotes, getCurrentAppVersion } from './services/appUpdate'

const LAST_SEEN_VERSION_KEY = 'tally.lastSeenAppVersion'

type ReleaseSplashState = {
  visible: boolean
  versionName: string
  title: string
  notes: string
  releaseUrl: string
}

export default function App() {
  const [releaseSplash, setReleaseSplash] = useState<ReleaseSplashState | null>(null)

  useEffect(() => {
    let cancelled = false

    const loadReleaseSplash = async () => {
      try {
        const current = await getCurrentAppVersion()
        if (cancelled) return
        const versionName = current.versionName?.trim() || '0.0.0'
        const lastSeen = localStorage.getItem(LAST_SEEN_VERSION_KEY)?.trim() || ''

        if (!lastSeen) {
          localStorage.setItem(LAST_SEEN_VERSION_KEY, versionName)
          return
        }

        if (lastSeen === versionName) return

        try {
          const rel = await fetchGithubReleaseNotes(versionName)
          if (cancelled) return
          setReleaseSplash({
            visible: true,
            versionName,
            title: rel.title || `Novidades da versão ${versionName}`,
            notes: rel.body || 'Sem notas publicadas para esta versão.',
            releaseUrl: rel.htmlUrl || '',
          })
          return
        } catch {
          if (cancelled) return
          setReleaseSplash({
            visible: true,
            versionName,
            title: `Novidades da versão ${versionName}`,
            notes: 'Atualização instalada com sucesso. Consulte o GitHub para detalhes do release.',
            releaseUrl: '',
          })
        }
      } catch {
        //
      }
    }

    void loadReleaseSplash()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <>
      <Routes>
        <Route path="/" element={<SetupPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/tally/:deviceId" element={<TallyPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {releaseSplash?.visible ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10000,
            background: 'rgba(0,0,0,0.78)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 18,
          }}
        >
          <div
            style={{
              width: 'min(920px, 100%)',
              maxHeight: '92dvh',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              background: 'linear-gradient(180deg, rgba(16,16,16,0.97), rgba(9,9,9,0.98))',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: 14,
              padding: 14,
              color: '#fff',
            }}
          >
            <div style={{ fontSize: 12, letterSpacing: 0.4, color: 'rgba(255,255,255,0.72)' }}>
              APP ATUALIZADO
            </div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{releaseSplash.title}</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.76)' }}>Versão {releaseSplash.versionName}</div>

            <div
              style={{
                whiteSpace: 'pre-wrap',
                overflowY: 'auto',
                maxHeight: '56dvh',
                lineHeight: 1.45,
                fontSize: 13,
                border: '1px solid rgba(255,255,255,0.14)',
                background: 'rgba(255,255,255,0.04)',
                borderRadius: 10,
                padding: 10,
              }}
            >
              {releaseSplash.notes}
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              {releaseSplash.releaseUrl ? (
                <a
                  href={releaseSplash.releaseUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    height: 34,
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '0 12px',
                    borderRadius: 10,
                    border: '1px solid rgba(255,255,255,0.24)',
                    color: '#fff',
                    textDecoration: 'none',
                    background: 'rgba(255,255,255,0.08)',
                    fontSize: 12,
                  }}
                >
                  Ver release no GitHub
                </a>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  localStorage.setItem(LAST_SEEN_VERSION_KEY, releaseSplash.versionName)
                  setReleaseSplash(null)
                }}
                style={{
                  height: 34,
                  padding: '0 14px',
                  borderRadius: 10,
                  border: '1px solid rgba(26,255,120,0.45)',
                  color: '#fff',
                  background: 'rgba(16,170,84,0.92)',
                  fontSize: 12,
                }}
              >
                Continuar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
