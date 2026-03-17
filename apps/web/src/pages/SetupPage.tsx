import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { buildApiUrl, normalizeServerBaseUrl } from '../services/socketClient'

const DEFAULT_SERVER_URL = 'http://192.168.3.208:3001'

function normalizeDeviceId(value: string) {
  return value.trim()
}

function inferDefaultServerUrl() {
  try {
    const host = window.location.hostname
    if (!host || host === 'localhost' || host === '127.0.0.1') return ''
    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:'
    return `${protocol}//${host}:3001`
  } catch {
    return ''
  }
}

type TargetsResponse = {
  ok: boolean
  connectedToObs: boolean
  scenes: string[]
}

type HealthResponse = {
  ok?: boolean
  connectedToObs?: boolean
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('timeout')), timeoutMs)
    promise
      .then((value) => {
        window.clearTimeout(timer)
        resolve(value)
      })
      .catch((err) => {
        window.clearTimeout(timer)
        reject(err)
      })
  })
}

export default function SetupPage() {
  const navigate = useNavigate()
  const initial = useMemo(
    () => localStorage.getItem('tally.setup.deviceIdDraft') ?? localStorage.getItem('tally.deviceId') ?? '',
    [],
  )
  const initialServerUrl = useMemo(() => {
    const saved = localStorage.getItem('tally.serverUrl')
    if (saved) return normalizeServerBaseUrl(saved) ?? ''
    return normalizeServerBaseUrl(DEFAULT_SERVER_URL) ?? inferDefaultServerUrl()
  }, [])
  const initialTargetName = useMemo(
    () => localStorage.getItem('tally.setup.targetNameDraft') ?? localStorage.getItem('tally.targetName') ?? '',
    [],
  )
  const [deviceId, setDeviceId] = useState(initial)
  const [serverUrl, setServerUrl] = useState(initialServerUrl)
  const targetType: 'scene' = 'scene'
  const [targetName, setTargetName] = useState(initialTargetName)
  const [loadingTargets, setLoadingTargets] = useState(true)
  const [targets, setTargets] = useState<{ scenes: string[] }>({ scenes: [] })
  const [connectedToObs, setConnectedToObs] = useState(false)
  const [manualTargetName, setManualTargetName] = useState(initialTargetName)
  const [healthText, setHealthText] = useState('Aguardando teste de conexão...')
  const [networkError, setNetworkError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    localStorage.setItem('tally.setup.deviceIdDraft', deviceId)
  }, [deviceId])

  useEffect(() => {
    const draftTarget = (targetName || manualTargetName).trim()
    localStorage.setItem('tally.setup.targetNameDraft', draftTarget)
  }, [targetName, manualTargetName])

  useEffect(() => {
    const normalized = normalizeServerBaseUrl(serverUrl)
    if (normalized) localStorage.setItem('tally.serverUrl', normalized)
    let cancelled = false

    if (serverUrl.trim() && !normalized) {
      setConnectedToObs(false)
      setTargets({ scenes: [] })
      setLoadingTargets(false)
      setHealthText('URL inválida')
      setNetworkError('Servidor inválido')
      return () => {
        cancelled = true
      }
    }

    const timer = window.setTimeout(() => {
      if (cancelled) return
      setLoadingTargets(true)
    }, 0)
    const baseUrl = normalized ?? ''
    const healthUrl = normalized ? `${normalized}/api/health` : buildApiUrl('/api/health')
    const targetsUrl = normalized ? `${normalized}/api/obs/targets` : buildApiUrl('/api/obs/targets')

    Promise.all([
      withTimeout(fetch(healthUrl).then((r) => r.json() as Promise<HealthResponse>), 4500),
      withTimeout(fetch(targetsUrl).then((r) => r.json() as Promise<TargetsResponse>), 4500),
    ])
      .then(([health, data]) => {
        if (cancelled) return
        const obs = Boolean(data.connectedToObs ?? health.connectedToObs)
        setHealthText(`${baseUrl || '(default)'} • API ${health.ok ? 'OK' : 'sem resposta'} • OBS ${obs ? 'ON' : 'OFF'}`)
        setNetworkError(null)
        setConnectedToObs(obs)
        const cameraScenes = (data.scenes ?? []).filter((name) => /^camera/i.test(name.trim()))
        setTargets({ scenes: cameraScenes })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : 'erro_desconhecido'
        setHealthText(`${baseUrl || '(default)'} • sem conexão`)
        setNetworkError(msg)
        setConnectedToObs(false)
        setTargets({ scenes: [] })
      })
      .finally(() => {
        if (cancelled) return
        setLoadingTargets(false)
      })

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [serverUrl])

  useEffect(() => {
    const normalized = normalizeServerBaseUrl(serverUrl)
    const id = normalizeDeviceId(deviceId)
    if (!normalized || !id) return
    let cancelled = false

    const loadSavedMapping = async () => {
      try {
        const res = await fetch(`${normalized}/api/device/${encodeURIComponent(id)}?t=${Date.now()}`)
        if (!res.ok) return
        const data = (await res.json()) as { device?: { targetType?: string; targetName?: string | null } }
        if (cancelled) return

        const savedTargetType = data.device?.targetType
        const savedTargetName = (data.device?.targetName ?? '').trim()
        if (savedTargetType !== 'scene' || !savedTargetName) return

        setTargetName(savedTargetName)
        setManualTargetName(savedTargetName)
        localStorage.setItem('tally.targetName', savedTargetName)
      } catch {
        //
      }
    }

    void loadSavedMapping()
    return () => {
      cancelled = true
    }
  }, [serverUrl, deviceId])

  const options = targets.scenes
  const canUseSelect = connectedToObs && options.length > 0

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          setSubmitError(null)
          const id = normalizeDeviceId(deviceId)
          if (!id) return

          const normalizedServerUrl = normalizeServerBaseUrl(serverUrl)
          if (!normalizedServerUrl) {
            setSubmitError('Servidor inválido. Ex: 192.168.3.208:3001')
            return
          }

          const finalTargetName = (canUseSelect ? targetName : manualTargetName).trim()
          if (!finalTargetName) {
            setSubmitError('Informe o nome da cena/source.')
            return
          }
          localStorage.setItem('tally.serverUrl', normalizedServerUrl)

          const upsertViaGet = async () => {
            const query = new URLSearchParams({
              targetType,
              targetName: finalTargetName,
            })
            const res = await fetch(
              `${normalizedServerUrl}/api/device/${encodeURIComponent(id)}/upsert?${query.toString()}`,
            )
            if (!res.ok) {
              const text = await res.text().catch(() => '')
              throw new Error(`GET fallback falhou (${res.status}) ${text}`.trim())
            }
          }

          try {
            const res = await fetch(`${normalizedServerUrl}/api/device/${encodeURIComponent(id)}`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ targetType, targetName: finalTargetName }),
            })
            if (!res.ok) {
              const text = await res.text().catch(() => '')
              setSubmitError(`Falha ao salvar (${res.status}). ${text}`.trim())
              return
            }

            localStorage.setItem('tally.deviceId', id)
            localStorage.setItem('tally.targetName', finalTargetName)
            navigate(`/tally/${encodeURIComponent(id)}`, { replace: true })
          } catch (err) {
            try {
              await upsertViaGet()
              localStorage.setItem('tally.deviceId', id)
              localStorage.setItem('tally.targetName', finalTargetName)
              navigate(`/tally/${encodeURIComponent(id)}`, { replace: true })
            } catch (fallbackErr) {
              const msg = err instanceof Error ? err.message : 'erro_de_rede'
              const fbMsg = fallbackErr instanceof Error ? fallbackErr.message : 'erro_fallback'
              setSubmitError(`Falha de rede ao salvar: ${msg} | ${fbMsg}`)
            }
          }
        }}
        style={{
          width: '100%',
          maxWidth: 420,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: 0.2 }}>Tally Light by: Atec Consultoria</div>
        <div style={{ opacity: 0.78, fontSize: 14, lineHeight: '18px' }}>
          Digite seu Nome e selecione a cena do OBS.
        </div>
        <input
          value={serverUrl}
          onChange={(e) => setServerUrl(e.target.value)}
          onBlur={() => {
            const normalized = normalizeServerBaseUrl(serverUrl)
            if (normalized) setServerUrl(normalized)
          }}
          placeholder="http://192.168.3.208:3001"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          style={{
            height: 44,
            borderRadius: 10,
            border: '1px solid rgba(255,255,255,0.18)',
            background: 'rgba(255,255,255,0.06)',
            color: '#fff',
            padding: '0 12px',
            outline: 'none',
            fontSize: 16,
          }}
        />
        <input
          value={deviceId}
          onChange={(e) => setDeviceId(e.target.value)}
          placeholder="Ex: João da Silva"
          inputMode="text"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          style={{
            height: 44,
            borderRadius: 10,
            border: '1px solid rgba(255,255,255,0.18)',
            background: 'rgba(255,255,255,0.06)',
            color: '#fff',
            padding: '0 12px',
            outline: 'none',
            fontSize: 16,
          }}
        />
        <select
          value={targetName}
          onChange={(e) => setTargetName(e.target.value)}
          disabled={!canUseSelect}
          style={{
            height: 44,
            borderRadius: 10,
            border: '1px solid rgba(255,255,255,0.18)',
            background: 'rgba(255,255,255,0.06)',
            color: '#fff',
            padding: '0 12px',
            outline: 'none',
            fontSize: 16,
            opacity: canUseSelect ? 1 : 0.6,
          }}
        >
          <option value="">
            {loadingTargets
              ? 'Carregando…'
              : connectedToObs
                ? options.length > 0
                  ? 'Selecione a cena...'
                  : 'Nenhuma cena encontrada'
                : 'OBS desconectado'}
          </option>
          {options.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        {!canUseSelect ? (
          <input
            value={manualTargetName}
            onChange={(e) => setManualTargetName(e.target.value)}
            placeholder="Nome da cena (ex: Camera 1)"
            inputMode="text"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            style={{
              height: 44,
              borderRadius: 10,
              border: '1px solid rgba(255,255,255,0.18)',
              background: 'rgba(255,255,255,0.06)',
              color: '#fff',
              padding: '0 12px',
              outline: 'none',
              fontSize: 16,
            }}
          />
        ) : null}
        {submitError ? (
          <div style={{ fontSize: 13, color: 'rgba(255, 120, 120, 0.95)' }}>{submitError}</div>
        ) : null}
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.72)', lineHeight: '16px' }}>
          {healthText}
          {networkError ? ` • erro: ${networkError}` : ''}
        </div>
        <button
          type="submit"
          style={{
            height: 44,
            borderRadius: 10,
            border: '1px solid rgba(255,255,255,0.18)',
            background: 'rgba(255,255,255,0.12)',
            color: '#fff',
            fontSize: 16,
          }}
        >
          Salvar e abrir
        </button>
      </form>
    </div>
  )
}
