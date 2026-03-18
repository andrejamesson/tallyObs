import { useEffect, useMemo, useRef, useState } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import { useNavigate } from 'react-router-dom'
import { useParams } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import ConnectionBadge from '../components/ConnectionBadge'
import CameraPublisherPanel from '../components/CameraPublisherPanel'
import ObsVuMeter from '../components/ObsVuMeter'
import PreviewPlayer from '../components/PreviewPlayer'
import TallyFrame from '../components/TallyFrame'
import { useTallyState } from '../hooks/useTallyState'
import { getDirectorSettings, type DirectorExtraScene } from '../services/directorSettings'
import { buildApiUrl } from '../services/socketClient'

const OBS_OFFLINE_NOTIFICATION_ID = 17001

type WakeLockApi = {
  request: (type: 'screen') => Promise<WakeLockSentinel>
}

function getWakeLockApi(): WakeLockApi | null {
  if (typeof navigator === 'undefined') return null
  const nav = navigator as unknown as { wakeLock?: WakeLockApi }
  return nav.wakeLock ?? null
}

function decodeParam(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function hexToRgb(hex: string) {
  const raw = hex.replace('#', '')
  if (raw.length !== 6) return null
  const r = Number.parseInt(raw.slice(0, 2), 16)
  const g = Number.parseInt(raw.slice(2, 4), 16)
  const b = Number.parseInt(raw.slice(4, 6), 16)
  if ([r, g, b].some((v) => Number.isNaN(v))) return null
  return { r, g, b }
}

function textColorForBackground(hex: string) {
  const rgb = hexToRgb(hex)
  if (!rgb) return '#fff'
  const luminance = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255
  return luminance > 0.62 ? '#111' : '#fff'
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export default function TallyPage() {
  const isNative = Capacitor.isNativePlatform()
  const navigate = useNavigate()
  const params = useParams()
  const deviceId = useMemo(
    () => (params.deviceId ? decodeParam(params.deviceId) : ''),
    [params.deviceId],
  )
  const state = useTallyState(deviceId)
  const [wakeSupported] = useState(() => Boolean(getWakeLockApi()))
  const [wakeActive, setWakeActive] = useState(false)
  const [wakeError, setWakeError] = useState<string | null>(null)
  const [programSceneName, setProgramSceneName] = useState('')
  const [directorScenes, setDirectorScenes] = useState<string[]>([])
  const [directorExtraScenes, setDirectorExtraScenes] = useState<DirectorExtraScene[]>([])
  const [directorCurrentScene, setDirectorCurrentScene] = useState('')
  const [directorLoading, setDirectorLoading] = useState(false)
  const [directorError, setDirectorError] = useState<string | null>(null)
  const [directorSwitchingScene, setDirectorSwitchingScene] = useState<string | null>(null)
  const [directorVuDisplay, setDirectorVuDisplay] = useState(0)
  const [directorVuPeak, setDirectorVuPeak] = useState(0)
  const [directorVuMuted, setDirectorVuMuted] = useState(false)
  const [nativeAppIsActive, setNativeAppIsActive] = useState(true)
  const [directorPanelWidth, setDirectorPanelWidth] = useState(() => {
    const raw = Number(localStorage.getItem('tally.director.panelWidth') ?? '250')
    if (!Number.isFinite(raw)) return 250
    return clampNumber(raw, 180, 420)
  })
  const [directorDragging, setDirectorDragging] = useState(false)
  const directorVuRawRef = useRef(0)
  const directorVuMutedRef = useRef(false)
  const directorVuDisplayRef = useRef(0)
  const directorVuPeakRef = useRef(0)
  const directorDragRef = useRef<{ active: boolean; startX: number; startWidth: number }>({
    active: false,
    startX: 0,
    startWidth: 250,
  })
  const offlineNotifiedRef = useRef(false)
  const [displayMode, setDisplayMode] = useState<'full' | 'simple' | 'director' | 'camera'>(() => {
    const raw = localStorage.getItem('tally.mode')
    if (raw === 'camera') return 'camera'
    if (raw === 'director') return 'director'
    return raw === 'simple' ? 'simple' : 'full'
  })

  useEffect(() => {
    if (!deviceId) return
    localStorage.setItem('tally.deviceId', deviceId)
  }, [deviceId])

  useEffect(() => {
    localStorage.setItem('tally.mode', displayMode)
  }, [displayMode])

  useEffect(() => {
    localStorage.setItem('tally.director.panelWidth', String(Math.round(directorPanelWidth)))
  }, [directorPanelWidth])

  useEffect(() => {
    if (displayMode === 'director') return
    let cancelled = false
    let inFlight = false

    const tick = async () => {
      if (inFlight) return
      inFlight = true
      try {
        const res = await fetch(buildApiUrl(`/api/obs/state?t=${Date.now()}`), { cache: 'no-store' })
        if (!res.ok) throw new Error('bad_response')
        const data = (await res.json()) as unknown as { programSceneName?: unknown }
        if (cancelled) return
        const name = typeof data.programSceneName === 'string' ? data.programSceneName : ''
        setProgramSceneName(name)
      } catch {
        if (cancelled) return
        setProgramSceneName('')
      } finally {
        inFlight = false
      }
    }

    void tick()
    const intervalId = window.setInterval(tick, 1200)
    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [displayMode])

  useEffect(() => {
    if (displayMode !== 'director') return
    setDirectorExtraScenes(getDirectorSettings().extraScenes)
    let cancelled = false
    let stateInFlight = false
    let targetsInFlight = false
    let vuInFlight = false
    setDirectorLoading(true)

    const loadState = async () => {
      if (stateInFlight) return
      stateInFlight = true
      try {
        const res = await fetch(buildApiUrl(`/api/obs/state?t=${Date.now()}`), { cache: 'no-store' })
        if (!res.ok) throw new Error('bad_state_response')
        const data = (await res.json()) as { programSceneName?: unknown }
        if (cancelled) return
        const nextCurrent = typeof data.programSceneName === 'string' ? data.programSceneName : ''
        setDirectorCurrentScene(nextCurrent)
        setDirectorError(null)
      } catch (err) {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : 'erro_state'
        setDirectorError(msg)
      } finally {
        stateInFlight = false
      }
    }

    const loadTargets = async () => {
      if (targetsInFlight) return
      targetsInFlight = true
      try {
        const res = await fetch(buildApiUrl(`/api/obs/targets?t=${Date.now()}`), { cache: 'no-store' })
        if (!res.ok) throw new Error('bad_targets_response')
        const data = (await res.json()) as { scenes?: unknown }
        if (cancelled) return
        const nextScenes = Array.isArray(data.scenes)
          ? data.scenes
              .filter((s): s is string => typeof s === 'string')
              .filter((s) => s.toLowerCase().includes('camera'))
          : []
        setDirectorScenes(nextScenes)
      } finally {
        if (!cancelled) setDirectorLoading(false)
        targetsInFlight = false
      }
    }

    const loadVu = async () => {
      if (vuInFlight) return
      vuInFlight = true
      try {
        const res = await fetch(buildApiUrl(`/api/obs/vu?t=${Date.now()}`), { cache: 'no-store' })
        if (!res.ok) throw new Error('bad_vu_response')
        const data = (await res.json()) as { vu?: unknown; vuMuted?: unknown }
        if (cancelled) return
        const nextVu =
          typeof data.vu === 'number' && Number.isFinite(data.vu) ? Math.max(0, Math.min(1, data.vu)) : 0
        const nextMuted = Boolean(data.vuMuted)
        directorVuRawRef.current = nextVu
        directorVuMutedRef.current = nextMuted
        setDirectorVuMuted(nextMuted)
      } finally {
        vuInFlight = false
      }
    }

    void loadState()
    void loadTargets()
    void loadVu()

    const stateId = window.setInterval(() => void loadState(), 320)
    const targetsId = window.setInterval(() => void loadTargets(), 3000)
    const vuId = window.setInterval(() => void loadVu(), 85)

    return () => {
      cancelled = true
      window.clearInterval(stateId)
      window.clearInterval(targetsId)
      window.clearInterval(vuId)
    }
  }, [displayMode])

  useEffect(() => {
    if (displayMode !== 'director') return
    let raf = 0
    let last = performance.now()
    let displayed = directorVuDisplayRef.current
    let peak = directorVuPeakRef.current
    let peakHoldMs = 0

    const animate = (now: number) => {
      const dt = Math.max(0.001, (now - last) / 1000)
      last = now

      const target = directorVuRawRef.current

      if (target >= displayed) {
        displayed = target
      } else {
        // Decay mais natural (queda suave), em vez de cair instantaneamente.
        displayed = Math.max(target, displayed - dt * 0.55)
      }

      if (displayed >= peak) {
        peak = displayed
        peakHoldMs = 900
      } else if (peakHoldMs > 0) {
        peakHoldMs -= dt * 1000
      } else {
        // Peak marker desce mais lentamente após hold.
        peak = Math.max(displayed, peak - dt * 0.22)
      }

      directorVuDisplayRef.current = displayed
      directorVuPeakRef.current = peak
      setDirectorVuDisplay((prev) => (Math.abs(prev - displayed) > 0.002 ? displayed : prev))
      setDirectorVuPeak((prev) => (Math.abs(prev - peak) > 0.002 ? peak : prev))
      raf = window.requestAnimationFrame(animate)
    }

    raf = window.requestAnimationFrame(animate)
    return () => window.cancelAnimationFrame(raf)
  }, [displayMode])

  useEffect(() => {
    if (!wakeSupported) return
    let sentinel: WakeLockSentinel | null = null
    let cancelled = false

    const release = async () => {
      const toRelease = sentinel
      sentinel = null
      if (!toRelease) return
      try {
        await toRelease.release()
      } catch {
        //
      }
    }

    const request = async () => {
      if (cancelled) return
      if (document.visibilityState !== 'visible') return
      const wakeLock = getWakeLockApi()
      if (!wakeLock) return
      setWakeError(null)
      try {
        await release()
        const next = await wakeLock.request('screen')
        if (cancelled) {
          try {
            await next.release()
          } catch {
            //
          }
          return
        }
        sentinel = next
        setWakeActive(true)
        next.addEventListener('release', () => setWakeActive(false))
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Falha ao manter tela ativa'
        setWakeActive(false)
        setWakeError(msg)
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void request()
      else void release()
    }

    document.addEventListener('visibilitychange', onVisibility)
    void request()

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      void release()
    }
  }, [wakeSupported])

  const disconnected = !state.connectedToServer

  useEffect(() => {
    if (!isNative) return
    let cancelled = false
    let handle: { remove: () => Promise<void> } | null = null

    const init = async () => {
      try {
        await LocalNotifications.requestPermissions()
      } catch {
        //
      }
      try {
        handle = await CapacitorApp.addListener('appStateChange', ({ isActive }) => {
          if (cancelled) return
          setNativeAppIsActive(isActive)
        })
      } catch {
        //
      }
    }

    void init()
    return () => {
      cancelled = true
      if (!handle) return
      void handle.remove()
    }
  }, [isNative])

  useEffect(() => {
    if (!isNative) return

    const obsOffline = state.connectedToServer && !state.connectedToObs
    if (!obsOffline) {
      offlineNotifiedRef.current = false
      void LocalNotifications.cancel({ notifications: [{ id: OBS_OFFLINE_NOTIFICATION_ID }] })
      return
    }

    if (nativeAppIsActive) return
    if (offlineNotifiedRef.current) return
    offlineNotifiedRef.current = true

    void LocalNotifications.schedule({
      notifications: [
        {
          id: OBS_OFFLINE_NOTIFICATION_ID,
          title: 'OBS offline',
          body: 'Servidor conectado, mas OBS está desconectado.',
          schedule: { at: new Date(Date.now() + 300) },
        },
      ],
    })
  }, [isNative, nativeAppIsActive, state.connectedToObs, state.connectedToServer])

  const directorExtraVisible = useMemo(() => {
    const nativeNames = new Set(directorScenes.map((s) => s.toLowerCase()))
    return directorExtraScenes.filter((s) => !nativeNames.has(s.sceneName.toLowerCase()))
  }, [directorExtraScenes, directorScenes])

  const startDirectorDrag = (clientX: number) => {
    directorDragRef.current = {
      active: true,
      startX: clientX,
      startWidth: directorPanelWidth,
    }
    setDirectorDragging(true)
  }

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      if (!directorDragRef.current.active) return
      const delta = event.clientX - directorDragRef.current.startX
      const next = clampNumber(directorDragRef.current.startWidth - delta, 180, 420)
      setDirectorPanelWidth(next)
    }
    const onUp = () => {
      if (!directorDragRef.current.active) return
      directorDragRef.current.active = false
      setDirectorDragging(false)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [])

  const cutToScene = async (sceneName: string) => {
    const next = sceneName.trim()
    if (!next) return
    if (!state.connectedToObs) {
      setDirectorError('OBS offline')
      return
    }

    setDirectorSwitchingScene(next)
    setDirectorError(null)
    setDirectorCurrentScene(next)

    const fallbackViaGet = async () => {
      const query = new URLSearchParams({ sceneName: next })
      const res = await fetch(buildApiUrl(`/api/obs/program-scene?${query.toString()}`))
      if (!res.ok) throw new Error(`fallback_${res.status}`)
    }

    try {
      const res = await fetch(buildApiUrl('/api/obs/program-scene'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sceneName: next }),
      })
      if (!res.ok) throw new Error(`post_${res.status}`)
    } catch {
      try {
        await fallbackViaGet()
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'cut_failed'
        setDirectorError(`Falha ao trocar cena (${msg})`)
      }
    } finally {
      setDirectorSwitchingScene(null)
    }
  }

  if (displayMode === 'simple') {
    const bg = disconnected ? '#7a1111' : state.onAir ? '#00ff3b' : '#000'
    const textColor = !disconnected && state.onAir ? '#000' : '#fff'
    const title = disconnected
      ? 'SEM SERVIDOR'
      : state.connectedToObs
        ? programSceneName || 'SEM CENA'
        : 'OBS OFF'
    return (
      <div
        style={{
          height: '100%',
          width: '100%',
          background: bg,
          padding:
            'max(env(safe-area-inset-top), 0px) max(env(safe-area-inset-right), 0px) max(env(safe-area-inset-bottom), 0px) max(env(safe-area-inset-left), 0px)',
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              fontSize: 26,
              fontWeight: 800,
              letterSpacing: 0.6,
              color: textColor,
              textTransform: 'uppercase',
              textAlign: 'center',
              maxWidth: 520,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              textShadow:
                !disconnected && state.onAir
                  ? '0 1px 1px rgba(255,255,255,0.25)'
                  : '0 2px 10px rgba(0,0,0,0.55)',
            }}
          >
            {title}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setDisplayMode('full')}
          style={{
            position: 'absolute',
            top: 10,
            left: 10,
            height: 30,
            padding: '0 10px',
            borderRadius: 999,
            border: '1px solid rgba(255,255,255,0.18)',
            background: 'rgba(0,0,0,0.25)',
            color: '#fff',
            fontSize: 12,
            letterSpacing: 0.2,
            opacity: 0.55,
          }}
        >
          MODO COMPLETO
        </button>
        {state.lastDisconnect ? (
          <div
            style={{
              position: 'absolute',
              left: 12,
              right: 12,
              bottom: 12,
              padding: '6px 10px',
              borderRadius: 10,
              fontSize: 12,
              background: 'rgba(0,0,0,0.35)',
              border: '1px solid rgba(255,255,255,0.18)',
              color: 'rgba(255,255,255,0.92)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {state.lastDisconnect.message}
          </div>
        ) : null}
      </div>
    )
  }

  if (displayMode === 'director') {
    return (
      <TallyFrame onAir={state.onAir} disconnected={disconnected} showBorder={false}>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            gap: 10,
            padding:
              'max(env(safe-area-inset-top), 8px) max(env(safe-area-inset-right), 8px) max(env(safe-area-inset-bottom), 8px) max(env(safe-area-inset-left), 8px)',
          }}
        >
          <div style={{ position: 'relative', flex: '1 1 auto', minWidth: 0 }}>
            <PreviewPlayer previewUrl={state.previewUrl} />
          </div>
          <div
            role="separator"
            aria-label="Redimensionar preview"
            onPointerDown={(e) => {
              e.preventDefault()
              startDirectorDrag(e.clientX)
            }}
            style={{
              width: 10,
              borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.12)',
              background: directorDragging ? 'rgba(255,255,255,0.26)' : 'rgba(255,255,255,0.12)',
              cursor: 'col-resize',
              touchAction: 'none',
            }}
          />
          <div
            style={{
              width: directorPanelWidth,
              minWidth: 180,
              borderRadius: 10,
              border: '1px solid rgba(255,255,255,0.16)',
              background: 'rgba(0,0,0,0.35)',
              display: 'flex',
              flexDirection: 'column',
              padding: 6,
              gap: 6,
            }}
          >
            <div style={{ display: 'flex', gap: 6 }}>
      <button
        type="button"
        onClick={() => navigate('/', { replace: true })}
        style={{
                  flex: 1,
                  height: 28,
                  borderRadius: 8,
                  border: '1px solid rgba(255,255,255,0.2)',
                  background: 'rgba(255,255,255,0.10)',
                  color: '#fff',
                  fontSize: 11,
                }}
              >
                SETUP
              </button>
              <button
                type="button"
                onClick={() => setDisplayMode('full')}
                style={{
                  flex: 1,
                  height: 28,
                  borderRadius: 8,
                  border: '1px solid rgba(255,255,255,0.2)',
                  background: 'rgba(255,255,255,0.10)',
                  color: '#fff',
                  fontSize: 11,
                }}
              >
                TALLY
              </button>
              <button
                type="button"
                onClick={() =>
                  navigate('/settings', {
                    state: { backTo: deviceId ? `/tally/${encodeURIComponent(deviceId)}` : '/' },
                  })
                }
                style={{
                  flex: 1,
                  height: 28,
                  borderRadius: 8,
                  border: '1px solid rgba(255,255,255,0.2)',
                  background: 'rgba(255,255,255,0.10)',
                  color: '#fff',
                  fontSize: 10,
                }}
              >
                CONFIG
              </button>
            </div>
            <div
              style={{
                fontSize: 11,
                color: 'rgba(255,255,255,0.82)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {state.connectedToObs
                ? directorCurrentScene
                  ? `PGM: ${directorCurrentScene}`
                  : 'PGM: -'
                : 'OBS OFFLINE'}
            </div>
            <div
              style={{
                flex: '1 1 auto',
                minHeight: 0,
                overflowY: 'auto',
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                  gap: 6,
                }}
              >
                {directorScenes.map((scene) => {
                  const active = scene === directorCurrentScene
                  const switching = scene === directorSwitchingScene
                  return (
                    <button
                      key={scene}
                      type="button"
                      onClick={() => void cutToScene(scene)}
                      style={{
                        width: 'min(100%, 60px)',
                        justifySelf: 'center',
                        aspectRatio: '1 / 1',
                        borderRadius: 6,
                        border: active ? '2px solid #00ff3b' : '1px solid rgba(255,255,255,0.25)',
                        background: active ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.08)',
                        color: '#fff',
                        fontSize: 9,
                        lineHeight: 1.2,
                        padding: 4,
                        textAlign: 'center',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        wordBreak: 'break-word',
                      }}
                      title={scene}
                      disabled={!state.connectedToObs || switching}
                    >
                      {switching ? 'TROCANDO...' : scene}
                    </button>
                  )
                })}
              </div>
              {directorExtraVisible.length > 0 ? (
                <div
                  style={{
                    marginTop: 8,
                    marginBottom: 6,
                    fontSize: 10,
                    color: 'rgba(255,255,255,0.62)',
                    letterSpacing: 0.3,
                  }}
                >
                  EXTRAS
                </div>
              ) : null}
              {directorExtraVisible.length > 0 ? (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                    gap: 6,
                  }}
                >
                  {directorExtraVisible.map((scene) => {
                    const active = scene.sceneName === directorCurrentScene
                    const switching = scene.sceneName === directorSwitchingScene
                    const fg = textColorForBackground(scene.color)
                    return (
                      <button
                        key={`extra-${scene.sceneName}`}
                        type="button"
                        onClick={() => void cutToScene(scene.sceneName)}
                        style={{
                          width: 'min(100%, 60px)',
                          justifySelf: 'center',
                          aspectRatio: '1 / 1',
                          borderRadius: 6,
                          border: active ? '2px solid #ffffff' : '1px solid rgba(255,255,255,0.28)',
                          background: active ? scene.color : `${scene.color}AA`,
                          color: fg,
                          fontSize: 9,
                          fontWeight: 700,
                          lineHeight: 1.2,
                          padding: 4,
                          textAlign: 'center',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          wordBreak: 'break-word',
                        }}
                        title={scene.sceneName}
                        disabled={!state.connectedToObs || switching}
                      >
                        {switching ? 'TROCANDO...' : scene.sceneName}
                      </button>
                    )
                  })}
                </div>
              ) : null}
            </div>
            {directorLoading ? (
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.72)' }}>Carregando cenas...</div>
            ) : null}
            {!directorLoading && directorScenes.length === 0 ? (
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.72)' }}>Nenhuma cena disponível</div>
            ) : null}
            {directorError ? (
              <div style={{ fontSize: 11, color: 'rgba(255,120,120,0.95)' }}>{directorError}</div>
            ) : null}
          </div>
          <div
            style={{
              width: 58,
              borderRadius: 10,
              border: '1px solid rgba(255,255,255,0.16)',
              background: 'rgba(0,0,0,0.35)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'stretch',
              padding: '6px 6px',
              gap: 6,
            }}
          >
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.68)', letterSpacing: 0.4 }}>VU</div>
            {directorVuMuted ? (
              <div
                style={{
                  fontSize: 8,
                  letterSpacing: 0.5,
                  color: 'rgba(220,220,220,0.85)',
                  marginTop: -2,
                }}
              >
                MUTED
              </div>
            ) : null}
            <div style={{ flex: 1, width: '100%', minHeight: 0, display: 'flex' }}>
              <ObsVuMeter
                level={directorVuDisplay}
                peakLevel={directorVuPeak}
                muted={directorVuMuted}
                height="100%"
              />
            </div>
          </div>
        </div>
        <ConnectionBadge connectedToServer={state.connectedToServer} connectedToObs={state.connectedToObs} />
      </TallyFrame>
    )
  }

  if (displayMode === 'camera') {
    return (
      <TallyFrame onAir={state.onAir} disconnected={disconnected} showBorder={false}>
        <CameraPublisherPanel />
        <div
          style={{
            position: 'absolute',
            top: 10,
            right: 10,
            display: 'flex',
            gap: 8,
            zIndex: 20,
          }}
        >
          <button
            type="button"
            onClick={() => setDisplayMode('full')}
            style={{
              height: 30,
              padding: '0 12px',
              borderRadius: 999,
              border: '1px solid rgba(255,255,255,0.18)',
              background: 'rgba(18,18,18,0.72)',
              color: '#fff',
              fontSize: 12,
            }}
          >
            TALLY
          </button>
          <button
            type="button"
            onClick={() => navigate('/', { replace: true })}
            style={{
              height: 30,
              padding: '0 12px',
              borderRadius: 999,
              border: '1px solid rgba(255,255,255,0.18)',
              background: 'rgba(18,18,18,0.72)',
              color: '#fff',
              fontSize: 12,
            }}
          >
            SETUP
          </button>
        </div>
      </TallyFrame>
    )
  }

  return (
    <TallyFrame onAir={state.onAir} disconnected={disconnected}>
      <PreviewPlayer previewUrl={state.previewUrl} />
      <ConnectionBadge connectedToServer={state.connectedToServer} connectedToObs={state.connectedToObs} />
      {(!state.previewUrl || disconnected || !state.connectedToObs) && (
        <div
          style={{
            position: 'absolute',
            left: 16,
            right: 16,
            top: '50%',
            transform: 'translateY(-50%)',
            display: 'flex',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              maxWidth: 460,
              width: '100%',
              borderRadius: 12,
              padding: '12px 14px',
              textAlign: 'center',
              background: 'rgba(0,0,0,0.55)',
              border: '1px solid rgba(255,255,255,0.18)',
              color: '#fff',
            }}
          >
            {!state.connectedToServer
              ? 'Sem conexão com o servidor. Verifique IP e porta.'
              : !state.connectedToObs
                ? 'Servidor conectado, mas OBS está offline.'
                : 'Preview carregando...'}
          </div>
        </div>
      )}
        <button
          type="button"
          onClick={() => navigate('/', { replace: true })}
          style={{
            position: 'absolute',
          top: 10,
          left: 10,
          height: 30,
          padding: '0 10px',
            borderRadius: 999,
            border: '1px solid rgba(255,255,255,0.18)',
            background: 'rgba(18,18,18,0.72)',
            color: '#fff',
            fontSize: 12,
            letterSpacing: 0.2,
            opacity: 0.9,
          }}
      >
        SETUP
      </button>
      <div
        style={{
          position: 'absolute',
          top: 10,
          left: 90,
          height: 30,
          maxWidth: 'min(58vw, 360px)',
          display: 'flex',
          alignItems: 'center',
          padding: '0 10px',
          borderRadius: 999,
          border: '1px solid rgba(255,255,255,0.18)',
          background: 'rgba(18,18,18,0.72)',
          color: '#fff',
          fontSize: 12,
          letterSpacing: 0.2,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        title={programSceneName}
      >
        {programSceneName || 'SEM CENA AO VIVO'}
      </div>
      <div
        style={{
          position: 'absolute',
          left: 12,
          bottom: 10,
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          opacity: 0.85,
          fontSize: 12,
          letterSpacing: 0.2,
        }}
      >
        <span>{deviceId}</span>
        {wakeSupported ? (
          <button
            type="button"
            onClick={async () => {
              setWakeError(null)
              try {
                const wakeLock = getWakeLockApi()
                if (!wakeLock) return
                const next = await wakeLock.request('screen')
                setWakeActive(true)
                next.addEventListener('release', () => setWakeActive(false))
              } catch (err) {
                const msg = err instanceof Error ? err.message : 'Falha ao manter tela ativa'
                setWakeActive(false)
                setWakeError(msg)
              }
            }}
            style={{
              height: 24,
              padding: '0 10px',
              borderRadius: 999,
              border: '1px solid rgba(255,255,255,0.18)',
              background: wakeActive ? 'rgba(0, 120, 40, 0.45)' : 'rgba(18,18,18,0.72)',
              color: '#fff',
              fontSize: 11,
              letterSpacing: 0.2,
            }}
          >
            {wakeActive ? 'TELA ATIVA' : 'MANTER ATIVA'}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => setDisplayMode('simple')}
          style={{
            height: 24,
            padding: '0 10px',
            borderRadius: 999,
            border: '1px solid rgba(255,255,255,0.18)',
            background: 'rgba(18,18,18,0.72)',
            color: '#fff',
            fontSize: 11,
            letterSpacing: 0.2,
          }}
        >
          MODO SIMPLES
        </button>
        <button
          type="button"
          onClick={() => setDisplayMode('director')}
          style={{
            height: 24,
            padding: '0 10px',
            borderRadius: 999,
            border: '1px solid rgba(255,255,255,0.18)',
            background: 'rgba(18,18,18,0.72)',
            color: '#fff',
            fontSize: 11,
            letterSpacing: 0.2,
          }}
        >
          MODO DIRETOR
        </button>
        <button
          type="button"
          onClick={() => setDisplayMode('camera')}
          style={{
            height: 24,
            padding: '0 10px',
            borderRadius: 999,
            border: '1px solid rgba(255,255,255,0.18)',
            background: 'rgba(18,18,18,0.72)',
            color: '#fff',
            fontSize: 11,
            letterSpacing: 0.2,
          }}
        >
          MODO CÂMERA
        </button>
      </div>
      {state.lastDisconnect ? (
        <div
          style={{
            position: 'absolute',
            left: 12,
            right: 12,
            bottom: 38,
            padding: '6px 10px',
            borderRadius: 10,
            fontSize: 12,
            background: 'rgba(0,0,0,0.55)',
            border: '1px solid rgba(255,255,255,0.18)',
            color: 'rgba(255,255,255,0.9)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {state.lastDisconnect.message}
        </div>
      ) : null}
      {wakeError ? (
        <div
          style={{
            position: 'absolute',
            left: 12,
            bottom: state.lastDisconnect ? 70 : 38,
            padding: '6px 10px',
            borderRadius: 10,
            fontSize: 12,
            background: 'rgba(140, 20, 20, 0.65)',
            border: '1px solid rgba(255,255,255,0.18)',
            color: '#fff',
            maxWidth: 'calc(100% - 24px)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {wakeError}
        </div>
      ) : null}
    </TallyFrame>
  )
}
