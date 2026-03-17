import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useNavigate } from 'react-router-dom'
import { buildApiUrl } from '../services/socketClient'
import { getDirectorSettings, normalizeSceneName, saveDirectorSettings, type DirectorExtraScene } from '../services/directorSettings'

type TargetsResponse = {
  connectedToObs?: boolean
  scenes?: string[]
}

export default function SettingsPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const backTo = typeof location.state === 'object' && location.state && 'backTo' in location.state
    ? (location.state as { backTo?: unknown }).backTo
    : null
  const backPath = typeof backTo === 'string' && backTo.trim() ? backTo : null
  const initial = useMemo(() => getDirectorSettings().extraScenes, [])
  const [extraScenes, setExtraScenes] = useState<DirectorExtraScene[]>(initial)
  const [allScenes, setAllScenes] = useState<string[]>([])
  const [loadingScenes, setLoadingScenes] = useState(true)
  const [addSceneName, setAddSceneName] = useState('')
  const [addColor, setAddColor] = useState('#2CCD51')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch(buildApiUrl(`/api/obs/targets?t=${Date.now()}`), { cache: 'no-store' })
        if (!res.ok) throw new Error('bad_response')
        const data = (await res.json()) as TargetsResponse
        if (cancelled) return
        const scenes = Array.isArray(data.scenes) ? data.scenes.filter((s): s is string => typeof s === 'string') : []
        setAllScenes(scenes)
      } catch {
        if (cancelled) return
        setAllScenes([])
      } finally {
        if (!cancelled) setLoadingScenes(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const addScene = () => {
    setSaved(false)
    setError(null)
    const sceneName = normalizeSceneName(addSceneName)
    if (!sceneName) {
      setError('Informe uma cena para adicionar.')
      return
    }
    if (extraScenes.some((s) => s.sceneName.toLowerCase() === sceneName.toLowerCase())) {
      setError('Essa cena já está na lista extra.')
      return
    }
    setExtraScenes((prev) => [...prev, { sceneName, color: addColor }])
    setAddSceneName('')
  }

  const save = () => {
    setError(null)
    saveDirectorSettings({ extraScenes })
    setSaved(true)
  }

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
      <div
        style={{
          width: '100%',
          maxWidth: 560,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div style={{ fontSize: 20, fontWeight: 700 }}>Configurações do Diretor</div>
        <div style={{ fontSize: 13, opacity: 0.8 }}>
          Selecione cenas extras e personalize a cor. Elas aparecem abaixo dos botões nativos no modo diretor.
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => {
              if (backPath) {
                navigate(backPath, { replace: true })
                return
              }
              if (window.history.length > 1) {
                navigate(-1)
                return
              }
              navigate('/', { replace: true })
            }}
            style={{
              height: 38,
              borderRadius: 10,
              border: '1px solid rgba(255,255,255,0.18)',
              background: 'rgba(255,255,255,0.1)',
              color: '#fff',
              padding: '0 12px',
            }}
          >
            Voltar
          </button>
          <button
            type="button"
            onClick={save}
            style={{
              height: 38,
              borderRadius: 10,
              border: '1px solid rgba(255,255,255,0.18)',
              background: 'rgba(0, 160, 75, 0.32)',
              color: '#fff',
              padding: '0 12px',
            }}
          >
            Salvar
          </button>
        </div>

        <div
          style={{
            borderRadius: 12,
            border: '1px solid rgba(255,255,255,0.16)',
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600 }}>Adicionar cena extra</div>
          <select
            value={addSceneName}
            onChange={(e) => setAddSceneName(e.target.value)}
            disabled={loadingScenes}
            style={{
              height: 42,
              borderRadius: 10,
              border: '1px solid rgba(255,255,255,0.18)',
              background: 'rgba(255,255,255,0.06)',
              color: '#fff',
              padding: '0 12px',
              fontSize: 15,
            }}
          >
            <option value="">
              {loadingScenes ? 'Carregando cenas...' : allScenes.length ? 'Selecione uma cena...' : 'Sem cenas'}
            </option>
            {allScenes.map((scene) => (
              <option key={scene} value={scene}>
                {scene}
              </option>
            ))}
          </select>
          <input
            value={addSceneName}
            onChange={(e) => setAddSceneName(e.target.value)}
            placeholder="Ou digite manualmente (ex: Intervalo Comercial)"
            style={{
              height: 42,
              borderRadius: 10,
              border: '1px solid rgba(255,255,255,0.18)',
              background: 'rgba(255,255,255,0.06)',
              color: '#fff',
              padding: '0 12px',
              fontSize: 15,
            }}
          />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label style={{ fontSize: 13, opacity: 0.85 }}>Cor do botão:</label>
            <input
              type="color"
              value={addColor}
              onChange={(e) => setAddColor(e.target.value)}
              style={{ width: 44, height: 30, border: 0, background: 'transparent' }}
            />
            <span style={{ fontSize: 12, opacity: 0.75 }}>{addColor.toUpperCase()}</span>
            <button
              type="button"
              onClick={addScene}
              style={{
                marginLeft: 'auto',
                height: 34,
                borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.18)',
                background: 'rgba(255,255,255,0.14)',
                color: '#fff',
                padding: '0 12px',
              }}
            >
              Adicionar
            </button>
          </div>
        </div>

        <div
          style={{
            borderRadius: 12,
            border: '1px solid rgba(255,255,255,0.16)',
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600 }}>Cenas extras configuradas</div>
          {extraScenes.length === 0 ? (
            <div style={{ fontSize: 13, opacity: 0.7 }}>Nenhuma cena extra cadastrada.</div>
          ) : (
            extraScenes.map((item, idx) => (
              <div
                key={`${item.sceneName}-${idx}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: 10,
                  padding: 8,
                }}
              >
                <div
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: 4,
                    background: item.color,
                    border: '1px solid rgba(255,255,255,0.3)',
                    flex: '0 0 auto',
                  }}
                />
                <div style={{ flex: '1 1 auto', fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.sceneName}
                </div>
                <input
                  type="color"
                  value={item.color}
                  onChange={(e) => {
                    const next = [...extraScenes]
                    next[idx] = { ...next[idx], color: e.target.value }
                    setExtraScenes(next)
                    setSaved(false)
                  }}
                  style={{ width: 38, height: 28, border: 0, background: 'transparent' }}
                />
                <button
                  type="button"
                  onClick={() => {
                    setExtraScenes((prev) => prev.filter((_, i) => i !== idx))
                    setSaved(false)
                  }}
                  style={{
                    height: 30,
                    borderRadius: 8,
                    border: '1px solid rgba(255,255,255,0.18)',
                    background: 'rgba(160, 40, 40, 0.32)',
                    color: '#fff',
                    padding: '0 10px',
                  }}
                >
                  Remover
                </button>
              </div>
            ))
          )}
        </div>

        {error ? <div style={{ color: 'rgba(255,120,120,0.95)', fontSize: 13 }}>{error}</div> : null}
        {saved ? <div style={{ color: 'rgba(120,255,160,0.95)', fontSize: 13 }}>Configurações salvas.</div> : null}
      </div>
    </div>
  )
}
