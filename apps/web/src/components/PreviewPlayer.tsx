import { useEffect, useMemo, useState } from 'react'

type Props = {
  previewUrl: string | null
}

export default function PreviewPlayer({ previewUrl }: Props) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [mode, setMode] = useState<'jpg' | 'mjpeg' | 'iframe'>('mjpeg')

  const debugUrl = useMemo(() => previewUrl ?? '', [previewUrl])
  const mjpegUrl = useMemo(() => {
    if (!previewUrl) return ''
    if (!previewUrl.includes('/api/preview')) return ''
    try {
      const url = new URL(previewUrl)
      url.pathname = '/api/preview.mjpeg'
      url.search = 'fps=24&width=540&quality=40'
      return url.toString()
    } catch {
      return ''
    }
  }, [previewUrl])
  const jpgBaseUrl = useMemo(() => {
    if (!previewUrl) return ''
    if (!previewUrl.includes('/api/preview')) return ''
    try {
      const url = new URL(previewUrl)
      url.pathname = '/api/preview.jpg'
      url.search = ''
      return url.toString()
    } catch {
      return ''
    }
  }, [previewUrl])
  const [jpgSrc, setJpgSrc] = useState('')

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLoaded(false)
      setFailed(false)
      setMode('mjpeg')
    }, 0)
    return () => window.clearTimeout(timer)
  }, [previewUrl])

  const advanceMode = () => {
    setLoaded(false)
    setFailed(false)
    setMode((prev) => {
      if (prev === 'mjpeg' && jpgBaseUrl) return 'jpg'
      if (prev !== 'iframe') return 'iframe'
      return 'iframe'
    })
  }

  useEffect(() => {
    if (!previewUrl) return
    const timer = window.setTimeout(() => {
      if (loaded) return
      if (mode === 'iframe') setFailed(true)
      else advanceMode()
    }, 2500)
    return () => window.clearTimeout(timer)
  }, [previewUrl, loaded, mode, mjpegUrl])

  useEffect(() => {
    if (!jpgBaseUrl) return
    const tick = () => setJpgSrc(`${jpgBaseUrl}?t=${Date.now()}`)
    tick()
    const id = window.setInterval(tick, 42)
    return () => window.clearInterval(id)
  }, [jpgBaseUrl])

  if (!previewUrl) {
    return (
      <div style={{ opacity: 0.7, fontSize: 14, padding: 16, textAlign: 'center' }}>
        Aguardando preview…
      </div>
    )
  }

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      {mode === 'jpg' && jpgBaseUrl ? (
        <img
          alt="Preview"
          src={jpgSrc}
          onLoad={() => {
            setLoaded(true)
            setFailed(false)
          }}
          onError={() => {
            advanceMode()
          }}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            background: '#000',
          }}
        />
      ) : mode === 'mjpeg' && mjpegUrl ? (
        <img
          alt="Preview"
          src={mjpegUrl}
          onLoad={() => {
            setLoaded(true)
            setFailed(false)
          }}
          onError={() => {
            advanceMode()
          }}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            background: '#000',
          }}
        />
      ) : (
        <iframe
          title="Preview"
          src={previewUrl}
          onLoad={() => {
            setLoaded(true)
            setFailed(false)
          }}
          onError={() => setFailed(true)}
          style={{
            width: '100%',
            height: '100%',
            border: 0,
            background: '#000',
          }}
          allow="autoplay; fullscreen"
          referrerPolicy="no-referrer"
        />
      )}
      {failed ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            background: 'rgba(0,0,0,0.7)',
            color: '#fff',
            textAlign: 'center',
          }}
        >
          <div style={{ maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 14, opacity: 0.9 }}>Preview indisponível (conexão recusada / offline)</div>
            <a
              href={debugUrl}
              target="_blank"
              rel="noreferrer"
              style={{
                fontSize: 12,
                opacity: 0.9,
                textDecoration: 'underline',
                wordBreak: 'break-all',
              }}
            >
              {debugUrl}
            </a>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                height: 38,
                borderRadius: 10,
                border: '1px solid rgba(255,255,255,0.18)',
                background: 'rgba(255,255,255,0.12)',
                color: '#fff',
                fontSize: 14,
              }}
            >
              Recarregar
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
