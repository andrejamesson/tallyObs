import { useEffect, useMemo, useRef, useState } from 'react'
import { buildCameraApiUrl, buildCameraWsUrl } from '../services/cameraServer'
import ObsVuMeter from './ObsVuMeter'

type CameraFacing = 'user' | 'environment' | 'unknown'
type CameraItem = { deviceId: string; label: string; failed?: boolean; facing: CameraFacing }
type AudioItem = { deviceId: string; label: string }
type ZoomCapability = { min?: number; max?: number }

function cameraLabel(raw: string, idx: number) {
  const fallback = raw.trim() || `Camera ${idx + 1}`
  return fallback
    .replace(/back/gi, 'Traseira')
    .replace(/front/gi, 'Frontal')
    .replace(/camera/gi, 'Cam')
}

function inferFacing(label: string): CameraFacing {
  const normalized = label.toLowerCase()
  if (/(front|frontal|selfie|user)/.test(normalized)) return 'user'
  if (/(back|rear|trase|environment|wide|ultra|tele)/.test(normalized)) return 'environment'
  return 'unknown'
}

function micLabel(raw: string, idx: number) {
  const fallback = raw.trim() || `Mic ${idx + 1}`
  return fallback
    .replace(/microphone/gi, 'Mic')
    .replace(/headset/gi, 'Headset')
    .replace(/bluetooth/gi, 'Bluetooth')
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function touchDistance(a: { clientX: number; clientY: number }, b: { clientX: number; clientY: number }) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
}

export default function CameraPublisherPanel() {
  const [room, setRoom] = useState(() => localStorage.getItem('tally.camera.room') || 'studio')
  const [status, setStatus] = useState('Aguardando iniciar câmera...')
  const [started, setStarted] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [micMuted, setMicMuted] = useState(false)
  const [micVuDisplay, setMicVuDisplay] = useState(0)
  const [micVuPeak, setMicVuPeak] = useState(0)
  const [micList, setMicList] = useState<AudioItem[]>([])
  const [selectedMicId, setSelectedMicId] = useState(() => localStorage.getItem('tally.camera.micId') || '')
  const [cameraList, setCameraList] = useState<CameraItem[]>([])
  const [selectedCameraId, setSelectedCameraId] = useState('')
  const [zoomList, setZoomList] = useState<number[]>([])
  const [zoomValue, setZoomValue] = useState('')
  const [isSwitching, setIsSwitching] = useState(false)
  const [errorText, setErrorText] = useState('')
  const previewRef = useRef<HTMLVideoElement | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const closedByAppRef = useRef(false)
  const reconnectTimerRef = useRef<number | null>(null)
  const cameraFailuresRef = useRef(new Map<string, number>())
  const zoomRangeRef = useRef<{ min: number; max: number } | null>(null)
  const pinchRef = useRef<{ active: boolean; startDistance: number; startZoom: number }>({
    active: false,
    startDistance: 0,
    startZoom: 1,
  })
  const pinchTickRef = useRef(0)
  const watchdogTimerRef = useRef<number | null>(null)
  const lastOutboundBytesRef = useRef<number | null>(null)
  const stalledForMsRef = useRef(0)
  const reconnectingRef = useRef(false)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const micAnalyserRef = useRef<AnalyserNode | null>(null)
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const micSampleRafRef = useRef<number | null>(null)
  const micVuRawRef = useRef(0)
  const micVuDisplayRef = useRef(0)
  const micVuPeakRef = useRef(0)
  const micFingerprintRef = useRef('')

  const viewerUrl = useMemo(() => {
    const query = new URLSearchParams({ room: room.trim() || 'studio' })
    return buildCameraApiUrl(`/api/camera/viewer?${query.toString()}`)
  }, [room])

  useEffect(() => {
    localStorage.setItem('tally.camera.room', room.trim() || 'studio')
  }, [room])

  useEffect(() => {
    localStorage.setItem('tally.camera.micId', selectedMicId)
  }, [selectedMicId])

  useEffect(() => {
    return () => {
      closedByAppRef.current = true
      if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current)
      if (watchdogTimerRef.current !== null) window.clearInterval(watchdogTimerRef.current)
      if (micSampleRafRef.current !== null) window.cancelAnimationFrame(micSampleRafRef.current)
      try {
        micSourceRef.current?.disconnect()
      } catch {
        //
      }
      micSourceRef.current = null
      micAnalyserRef.current = null
      const ctx = audioCtxRef.current
      audioCtxRef.current = null
      if (ctx) {
        void ctx.close()
      }
      closeTransport()
      stopStream()
    }
  }, [])

  const stopStream = () => {
    const stream = streamRef.current
    streamRef.current = null
    if (!stream) return
    stream.getTracks().forEach((track) => track.stop())
    if (previewRef.current) previewRef.current.srcObject = null
  }

  const closeTransport = () => {
    if (watchdogTimerRef.current !== null) {
      window.clearInterval(watchdogTimerRef.current)
      watchdogTimerRef.current = null
    }
    lastOutboundBytesRef.current = null
    stalledForMsRef.current = 0
    reconnectingRef.current = false
    try {
      if (wsRef.current && wsRef.current.readyState <= 1) wsRef.current.close()
    } catch {
      //
    }
    try {
      pcRef.current?.close()
    } catch {
      //
    }
    wsRef.current = null
    pcRef.current = null
  }

  const scheduleReconnect = () => {
    if (!started || closedByAppRef.current) return
    if (reconnectTimerRef.current !== null) return
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null
      connectSignalPeer()
    }, 1400)
  }

  const getVideoTrack = () => streamRef.current?.getVideoTracks()[0] || null

  const getVideoSender = () => {
    const pc = pcRef.current
    if (!pc) return null
    return pc.getSenders().find((sender) => sender.track?.kind === 'video') || null
  }

  const getAudioSender = () => {
    const pc = pcRef.current
    if (!pc) return null
    return pc.getSenders().find((sender) => sender.track?.kind === 'audio') || null
  }

  const startWatchdog = (pc: RTCPeerConnection) => {
    if (watchdogTimerRef.current !== null) {
      window.clearInterval(watchdogTimerRef.current)
      watchdogTimerRef.current = null
    }
    lastOutboundBytesRef.current = null
    stalledForMsRef.current = 0

    watchdogTimerRef.current = window.setInterval(async () => {
      if (!started) return
      if (reconnectingRef.current) return
      if (pc.connectionState !== 'connected') return

      const sender = pc.getSenders().find((s) => s.track?.kind === 'video')
      if (!sender) return

      try {
        const stats = await sender.getStats()
        let bytesSent: number | null = null
        stats.forEach((report) => {
          if (report.type === 'outbound-rtp' && (report as RTCOutboundRtpStreamStats).kind === 'video') {
            const value = (report as RTCOutboundRtpStreamStats).bytesSent
            if (typeof value === 'number') bytesSent = value
          }
        })
        if (bytesSent === null) return

        if (lastOutboundBytesRef.current === null) {
          lastOutboundBytesRef.current = bytesSent
          stalledForMsRef.current = 0
          return
        }

        if (bytesSent > lastOutboundBytesRef.current) {
          lastOutboundBytesRef.current = bytesSent
          stalledForMsRef.current = 0
          return
        }

        stalledForMsRef.current += 2000
        if (stalledForMsRef.current >= 8000) {
          reconnectingRef.current = true
          setStatus('Reconectando stream (watchdog)...')
          connectSignalPeer()
        }
      } catch {
        // ignore watchdog sampling errors
      }
    }, 2000)
  }

  const getMediaStream = async ({
    deviceId,
    audioDeviceId,
    withAudio,
    allowBroadFallback,
  }: {
    deviceId?: string
    audioDeviceId?: string
    withAudio: boolean
    allowBroadFallback: boolean
  }) => {
    const videoConstraint: MediaTrackConstraints = deviceId
      ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
      : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }

    try {
      return await navigator.mediaDevices.getUserMedia({
        video: videoConstraint,
        audio: withAudio
          ? {
              deviceId: audioDeviceId ? { exact: audioDeviceId } : undefined,
              echoCancellation: true,
              noiseSuppression: true,
            }
          : false,
      })
    } catch (err) {
      if (!allowBroadFallback) throw err
      return navigator.mediaDevices.getUserMedia({ video: true, audio: withAudio })
    }
  }

  const refreshZoomOptions = () => {
    const track = getVideoTrack()
    if (!track || typeof track.getCapabilities !== 'function') {
      zoomRangeRef.current = null
      setZoomList([])
      setZoomValue('')
      return
    }

    const caps = track.getCapabilities() as MediaTrackCapabilities & { zoom?: ZoomCapability }
    const zoomCaps = caps.zoom
    const min = Number(zoomCaps?.min ?? 1)
    const max = Number(zoomCaps?.max ?? 1)
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
      zoomRangeRef.current = null
      setZoomList([])
      setZoomValue('')
      return
    }

    zoomRangeRef.current = { min, max }
    const presets = Array.from(new Set([min, 1, 1.5, 2, 3, max].filter((v) => v >= min && v <= max))).sort(
      (a, b) => a - b,
    )
    setZoomList(presets)

    const current = track.getSettings?.().zoom
    if (typeof current === 'number' && Number.isFinite(current)) {
      setZoomValue(String(current))
    }
  }

  const enumerateCameras = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const videos = devices.filter((d) => d.kind === 'videoinput')
      setCameraList(
        videos.map((d, idx) => {
          const label = cameraLabel(d.label || '', idx)
          return {
            deviceId: d.deviceId,
            label,
            failed: (cameraFailuresRef.current.get(d.deviceId) || 0) > 0,
            facing: inferFacing(label),
          }
        }),
      )
    } catch {
      setCameraList([])
    }
  }

  const enumerateMicrophones = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const audios = devices.filter((d) => d.kind === 'audioinput')
      const next = audios.map((d, idx) => ({
        deviceId: d.deviceId,
        label: micLabel(d.label || '', idx),
      }))
      const nextFingerprint = next.map((m) => `${m.deviceId}:${m.label}`).join('|')
      if (nextFingerprint === micFingerprintRef.current) return
      micFingerprintRef.current = nextFingerprint
      setMicList(next)
      if (!selectedMicId && next[0]?.deviceId) {
        setSelectedMicId(next[0].deviceId)
      }
      if (selectedMicId && !next.some((m) => m.deviceId === selectedMicId) && next[0]?.deviceId) {
        const fallbackId = next[0].deviceId
        setSelectedMicId(fallbackId)
        if (started && !isSwitching) {
          void switchMicrophone(fallbackId)
        }
      }
    } catch {
      setMicList([])
    }
  }

  const updateMicState = (muted: boolean) => {
    streamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !muted
    })
  }

  const startMicVuCapture = async (track: MediaStreamTrack | null) => {
    if (!track) return
    if (typeof window === 'undefined') return
    const Ctx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return

    try {
      if (micSampleRafRef.current !== null) {
        window.cancelAnimationFrame(micSampleRafRef.current)
        micSampleRafRef.current = null
      }
      try {
        micSourceRef.current?.disconnect()
      } catch {
        //
      }
      micSourceRef.current = null
      micAnalyserRef.current = null

      let ctx = audioCtxRef.current
      if (!ctx) {
        ctx = new Ctx()
        audioCtxRef.current = ctx
      }
      if (ctx.state === 'suspended') {
        await ctx.resume()
      }

      const inputStream = new MediaStream([track])
      const source = ctx.createMediaStreamSource(inputStream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 2048
      analyser.smoothingTimeConstant = 0.1
      source.connect(analyser)

      micSourceRef.current = source
      micAnalyserRef.current = analyser

      const sample = () => {
        const a = micAnalyserRef.current
        if (!a) return
        const data = new Uint8Array(a.fftSize)
        a.getByteTimeDomainData(data)
        let sum = 0
        for (let i = 0; i < data.length; i += 1) {
          const normalized = (data[i] - 128) / 128
          sum += normalized * normalized
        }
        const meanSquare = sum / data.length
        const rms = Math.sqrt(meanSquare)
        const level = Math.max(0, Math.min(1, rms * 1.9))
        micVuRawRef.current = level
        micSampleRafRef.current = window.requestAnimationFrame(sample)
      }
      micSampleRafRef.current = window.requestAnimationFrame(sample)
    } catch {
      //
    }
  }

  const applyZoomNumber = async (zoom: number) => {
    const track = getVideoTrack()
    const bounds = zoomRangeRef.current
    if (!track || !bounds || typeof track.applyConstraints !== 'function') return

    const next = clamp(zoom, bounds.min, bounds.max)
    try {
      await track.applyConstraints({ advanced: [{ zoom: next }] as unknown as MediaTrackConstraintSet[] })
      setZoomValue(String(next))
    } catch {
      //
    }
  }

  const createPlaceholderVideoTrack = () => {
    const canvas = document.createElement('canvas')
    const preview = previewRef.current
    const width = preview?.videoWidth || 640
    const height = preview?.videoHeight || 360
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (ctx) {
      // Congela o ultimo frame visivel para evitar tela preta durante a troca.
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      if (preview && preview.readyState >= 2) {
        try {
          ctx.drawImage(preview, 0, 0, canvas.width, canvas.height)
        } catch {
          ctx.fillStyle = '#000'
          ctx.fillRect(0, 0, canvas.width, canvas.height)
        }
      } else {
        ctx.fillStyle = '#000'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
      }
    }
    const placeholderStream = canvas.captureStream(8)
    const placeholderTrack = placeholderStream.getVideoTracks()[0]
    return { placeholderStream, placeholderTrack }
  }

  const renegotiate = async () => {
    const ws = wsRef.current
    const pc = pcRef.current
    if (!ws || !pc) return
    if (ws.readyState !== WebSocket.OPEN) return
    try {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      ws.send(JSON.stringify({ type: 'offer', sdp: offer }))
    } catch {
      //
    }
  }

  const connectSignalPeer = () => {
    if (!streamRef.current) return
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    closeTransport()
    reconnectingRef.current = false

    const ws = new WebSocket(buildCameraWsUrl('/ws-camera'))
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })
    wsRef.current = ws
    pcRef.current = pc

    streamRef.current.getTracks().forEach((track) => pc.addTrack(track, streamRef.current!))

    pc.onicecandidate = (evt) => {
      if (evt.candidate && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ice', candidate: evt.candidate }))
      }
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        setStatus('Transmitindo para o viewer.')
        reconnectingRef.current = false
      }
      if (
        pc.connectionState === 'failed' ||
        pc.connectionState === 'disconnected' ||
        pc.connectionState === 'closed'
      ) {
        scheduleReconnect()
      }
    }

    ws.onopen = () => {
      const activeRoom = room.trim() || 'studio'
      ws.send(JSON.stringify({ type: 'join', role: 'publisher', room: activeRoom }))
      setStatus('Publisher pronto. Abra o viewer no OBS.')
      startWatchdog(pc)
    }

    ws.onmessage = async (evt) => {
      let msg: { type?: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit } | undefined
      try {
        msg = JSON.parse(evt.data) as { type?: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }
      } catch {
        return
      }

      if (!msg || !msg.type) return

      if (msg.type === 'viewer-ready') {
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        ws.send(JSON.stringify({ type: 'offer', sdp: offer }))
      }

      if (msg.type === 'answer' && msg.sdp) {
        try {
          await pc.setRemoteDescription(msg.sdp)
          setStatus('Viewer conectado, transmitindo...')
        } catch (err) {
          const text = err instanceof Error ? err.message : 'answer inválida'
          setErrorText(`Falha answer: ${text}`)
          scheduleReconnect()
        }
      }

      if (msg.type === 'ice' && msg.candidate) {
        try {
          await pc.addIceCandidate(msg.candidate)
        } catch {
          //
        }
      }
    }

    ws.onerror = () => scheduleReconnect()
    ws.onclose = () => scheduleReconnect()
  }

  const onStart = async () => {
    setErrorText('')
    setStatus('Pedindo permissão de câmera e microfone...')
    try {
      const stream = await getMediaStream({
        withAudio: true,
        deviceId: selectedCameraId || undefined,
        audioDeviceId: selectedMicId || undefined,
        allowBroadFallback: true,
      })
      streamRef.current = stream
      if (previewRef.current) previewRef.current.srcObject = stream
      setStarted(true)
      updateMicState(micMuted)

      const firstVideo = stream.getVideoTracks()[0]
      const firstAudio = stream.getAudioTracks()[0] || null
      if (firstVideo?.getSettings) {
        const settings = firstVideo.getSettings()
        if (settings.deviceId) setSelectedCameraId(settings.deviceId)
      }
      if (firstAudio?.getSettings) {
        const settings = firstAudio.getSettings()
        if (settings.deviceId) setSelectedMicId(settings.deviceId)
      }
      await startMicVuCapture(firstAudio)

      await enumerateCameras()
      await enumerateMicrophones()
      refreshZoomOptions()
      connectSignalPeer()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao iniciar câmera'
      setErrorText(msg)
      setStatus('Erro ao iniciar câmera')
      setStarted(false)
    }
  }

  const switchCamera = async (deviceId: string) => {
    if (!started || isSwitching || !deviceId) return
    setIsSwitching(true)
    setErrorText('')
    setStatus('Trocando câmera...')

    try {
      const stream = streamRef.current
      if (!stream) throw new Error('stream_missing')
      const oldTrack = getVideoTrack()
      const sender = getVideoSender()
      const { placeholderStream, placeholderTrack } = createPlaceholderVideoTrack()
      let newTrack: MediaStreamTrack | null = null

      // Mantem envio de video vivo enquanto troca a camera real.
      if (sender && placeholderTrack) {
        try {
          await sender.replaceTrack(placeholderTrack)
        } catch {
          //
        }
      }

      // Libera a camera antiga para evitar "Could not start video source" em Android.
      if (oldTrack) {
        stream.removeTrack(oldTrack)
        oldTrack.stop()
      }

      // 1) Abre nova trilha por deviceId exato.
      if (!newTrack) {
        try {
          const videoOnly = await getMediaStream({
            withAudio: false,
            deviceId,
            audioDeviceId: undefined,
            allowBroadFallback: false,
          })
          newTrack = videoOnly.getVideoTracks()[0] || null
        } catch {
          //
        }
      }

      // 2) Fallback por facingMode inferido do label (mais confiável em alguns Androids).
      if (!newTrack) {
        const cam = cameraList.find((c) => c.deviceId === deviceId)
        if (cam && cam.facing !== 'unknown') {
          try {
            const byFacing = await navigator.mediaDevices.getUserMedia({
              video: { facingMode: { ideal: cam.facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
              audio: false,
            })
            newTrack = byFacing.getVideoTracks()[0] || null
          } catch {
            //
          }
        }
      }

      // 3) Fallback amplo (alguns Androids recusam certos ids/lentes).
      if (!newTrack) {
        try {
          const fallback = await getMediaStream({
            withAudio: false,
            deviceId: undefined,
            audioDeviceId: undefined,
            allowBroadFallback: true,
          })
          newTrack = fallback.getVideoTracks()[0] || null
        } catch {
          //
        }
      }

      if (!newTrack) throw new Error('Não foi possível iniciar esta câmera neste dispositivo.')

      if (sender) {
        await sender.replaceTrack(newTrack)
      }

      if (!stream.getVideoTracks().includes(newTrack)) stream.addTrack(newTrack)

      if (previewRef.current) previewRef.current.srcObject = stream
      if (newTrack.getSettings) {
        const settings = newTrack.getSettings()
        if (settings.deviceId) {
          cameraFailuresRef.current.delete(settings.deviceId)
          setSelectedCameraId(settings.deviceId)
        }
      }

      await enumerateCameras()
      refreshZoomOptions()
      void renegotiate()
      if (placeholderTrack) placeholderTrack.stop()
      placeholderStream.getTracks().forEach((t) => t.stop())
      setStatus('Transmissão ativa.')
    } catch (err) {
      cameraFailuresRef.current.set(deviceId, (cameraFailuresRef.current.get(deviceId) || 0) + 1)
      await enumerateCameras()
      const msg =
        err instanceof Error && err.message
          ? err.message
          : 'Falha ao trocar câmera (Could not start video source)'
      setErrorText(msg)
      setStatus('Erro ao trocar câmera')
      connectSignalPeer()
    } finally {
      setIsSwitching(false)
    }
  }

  const switchMicrophone = async (deviceId: string) => {
    if (!deviceId) return
    setSelectedMicId(deviceId)
    if (!started || isSwitching) return
    setIsSwitching(true)
    setErrorText('')

    try {
      const stream = streamRef.current
      if (!stream) throw new Error('stream_missing')
      const oldTrack = stream.getAudioTracks()[0] || null
      const sender = getAudioSender()
      const audioOnly = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: {
          deviceId: { exact: deviceId },
          echoCancellation: true,
          noiseSuppression: true,
        },
      })
      const newTrack = audioOnly.getAudioTracks()[0] || null
      if (!newTrack) throw new Error('Não foi possível iniciar este microfone.')
      newTrack.enabled = !micMuted

      if (sender) {
        await sender.replaceTrack(newTrack)
      }
      if (oldTrack) {
        stream.removeTrack(oldTrack)
        oldTrack.stop()
      }
      stream.addTrack(newTrack)
      await startMicVuCapture(newTrack)
      await enumerateMicrophones()
    } catch (err) {
      const msg =
        err instanceof Error && err.message ? err.message : 'Falha ao trocar microfone neste dispositivo'
      setErrorText(msg)
    } finally {
      setIsSwitching(false)
    }
  }

  useEffect(() => {
    void enumerateCameras()
    void enumerateMicrophones()

    const onDeviceChange = () => {
      void enumerateCameras()
      void enumerateMicrophones()
    }

    navigator.mediaDevices?.addEventListener?.('devicechange', onDeviceChange)
    return () => {
      navigator.mediaDevices?.removeEventListener?.('devicechange', onDeviceChange)
    }
  }, [])

  useEffect(() => {
    // Fallback para Android/WebView quando `devicechange` nao dispara com confianca.
    const id = window.setInterval(() => {
      void enumerateMicrophones()
    }, 2000)
    return () => window.clearInterval(id)
  }, [started, selectedMicId, isSwitching])

  useEffect(() => {
    if (!started) {
      micVuRawRef.current = 0
      micVuDisplayRef.current = 0
      micVuPeakRef.current = 0
      setMicVuDisplay(0)
      setMicVuPeak(0)
      return
    }

    let raf = 0
    let last = performance.now()
    let displayed = micVuDisplayRef.current
    let peak = micVuPeakRef.current
    let peakHoldMs = 0

    const animate = (now: number) => {
      const dt = Math.max(0.001, (now - last) / 1000)
      last = now
      const target = micVuRawRef.current

      if (target >= displayed) displayed = target
      else displayed = Math.max(target, displayed - dt * 0.55)

      if (displayed >= peak) {
        peak = displayed
        peakHoldMs = 900
      } else if (peakHoldMs > 0) {
        peakHoldMs -= dt * 1000
      } else {
        peak = Math.max(displayed, peak - dt * 0.22)
      }

      micVuDisplayRef.current = displayed
      micVuPeakRef.current = peak
      setMicVuDisplay((prev) => (Math.abs(prev - displayed) > 0.002 ? displayed : prev))
      setMicVuPeak((prev) => (Math.abs(prev - peak) > 0.002 ? peak : prev))
      raf = window.requestAnimationFrame(animate)
    }

    raf = window.requestAnimationFrame(animate)
    return () => window.cancelAnimationFrame(raf)
  }, [started])

  return (
    <div style={{ position: 'absolute', inset: 0, background: '#000' }}>
      <video
        ref={previewRef}
        autoPlay
        playsInline
        muted
        onTouchStart={(e) => {
          if (e.touches.length !== 2 || !zoomRangeRef.current) return
          pinchRef.current.active = true
          pinchRef.current.startDistance = touchDistance(e.touches[0], e.touches[1])
          const current = Number(zoomValue || zoomRangeRef.current.min)
          pinchRef.current.startZoom = Number.isFinite(current) ? current : zoomRangeRef.current.min
        }}
        onTouchMove={(e) => {
          if (!pinchRef.current.active || e.touches.length !== 2 || !zoomRangeRef.current) return
          e.preventDefault()
          const now = Date.now()
          if (now - pinchTickRef.current < 80) return
          pinchTickRef.current = now
          const distance = touchDistance(e.touches[0], e.touches[1])
          const ratio = pinchRef.current.startDistance > 0 ? distance / pinchRef.current.startDistance : 1
          const next = pinchRef.current.startZoom * ratio
          void applyZoomNumber(next)
        }}
        onTouchEnd={() => {
          pinchRef.current.active = false
        }}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          background: '#000',
          objectFit: 'cover',
          touchAction: 'none',
        }}
      />

      {controlsVisible ? (
        <div
          style={{
            position: 'absolute',
            top: 'max(env(safe-area-inset-top), 8px)',
            left: 'max(env(safe-area-inset-left), 8px)',
            right: 'max(calc(env(safe-area-inset-right) + 150px), 150px)',
            pointerEvents: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            borderRadius: 12,
            border: '1px solid rgba(255,255,255,0.18)',
            background: 'rgba(0,0,0,0.48)',
            backdropFilter: 'blur(3px)',
            padding: 8,
          }}
        >
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {!started ? (
              <input
                value={room}
                onChange={(e) => setRoom(e.target.value)}
                placeholder="Sala"
                style={{
                  height: 34,
                  minWidth: 120,
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.2)',
                  background: 'rgba(0,0,0,0.42)',
                  color: '#fff',
                  padding: '0 10px',
                }}
              />
            ) : null}
            <button
              type="button"
              onClick={() => void onStart()}
              disabled={started}
              style={{
                height: 34,
                borderRadius: 10,
                border: '1px solid rgba(26,255,120,0.45)',
                background: started ? 'rgba(60,60,60,0.35)' : 'rgba(16,170,84,0.92)',
                color: '#fff',
                padding: '0 12px',
                fontSize: 12,
              }}
            >
              {started ? 'ATIVA' : 'INICIAR'}
            </button>
            <button
              type="button"
              onClick={() => {
                const next = !micMuted
                setMicMuted(next)
                updateMicState(next)
              }}
              style={{
                height: 34,
                borderRadius: 10,
                border: '1px solid rgba(255,255,255,0.2)',
                background: micMuted ? 'rgba(130,130,130,0.35)' : 'rgba(255,255,255,0.12)',
                color: '#fff',
                padding: '0 12px',
                fontSize: 12,
              }}
            >
              {micMuted ? 'MIC OFF' : 'MIC ON'}
            </button>
            {micList.length > 0 ? (
              <select
                value={selectedMicId}
                onChange={(e) => {
                  void switchMicrophone(e.target.value)
                }}
                style={{
                  height: 34,
                  maxWidth: 220,
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.2)',
                  background: 'rgba(0,0,0,0.42)',
                  color: '#fff',
                  padding: '0 8px',
                  fontSize: 12,
                }}
                title="Microfone"
              >
                {micList.map((mic, idx) => (
                  <option key={mic.deviceId || `mic-${idx}`} value={mic.deviceId}>
                    {mic.label}
                  </option>
                ))}
              </select>
            ) : null}
            {!started ? <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.88)' }}>{status}</span> : null}
          </div>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {cameraList.map((camera, idx) => {
              const active = selectedCameraId === camera.deviceId
              return (
                <button
                  key={camera.deviceId || `cam-${idx}`}
                  type="button"
                  disabled={!started || isSwitching || camera.failed}
                  onClick={() => {
                    setSelectedCameraId(camera.deviceId)
                    void switchCamera(camera.deviceId)
                  }}
                  title={camera.label}
                  style={{
                    height: 30,
                    borderRadius: 8,
                    border: active ? '2px solid #00ff3b' : '1px solid rgba(255,255,255,0.22)',
                    background: active ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.1)',
                    color: '#fff',
                    padding: '0 10px',
                    fontSize: 11,
                  }}
                >
                  CAM {idx + 1}
                </button>
              )
            })}
            {zoomList.length > 0 ? (
              <>
                <button
                  type="button"
                  onClick={() => void applyZoomNumber(Number(zoomValue || zoomList[0]) - 0.2)}
                  style={{
                    height: 30,
                    borderRadius: 8,
                    border: '1px solid rgba(255,255,255,0.22)',
                    background: 'rgba(255,255,255,0.1)',
                    color: '#fff',
                    padding: '0 10px',
                    fontSize: 12,
                  }}
                >
                  Z-
                </button>
                <button
                  type="button"
                  onClick={() => void applyZoomNumber(Number(zoomValue || zoomList[0]) + 0.2)}
                  style={{
                    height: 30,
                    borderRadius: 8,
                    border: '1px solid rgba(255,255,255,0.22)',
                    background: 'rgba(255,255,255,0.1)',
                    color: '#fff',
                    padding: '0 10px',
                    fontSize: 12,
                  }}
                >
                  Z+
                </button>
              </>
            ) : null}
          </div>

          {errorText ? <div style={{ color: '#ffb3b3', fontSize: 11 }}>{errorText}</div> : null}
          {!started ? (
            <div
              style={{
                color: 'rgba(170,210,255,0.9)',
                fontSize: 11,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title={viewerUrl}
            >
              Viewer: {viewerUrl}
            </div>
          ) : null}
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setControlsVisible((v) => !v)}
        style={{
          position: 'absolute',
          bottom: 'max(env(safe-area-inset-bottom), 10px)',
          right: 'max(calc(env(safe-area-inset-right) + 64px), 72px)',
          height: 34,
          borderRadius: 10,
          border: '1px solid rgba(255,255,255,0.26)',
          background: 'rgba(0,0,0,0.5)',
          color: '#fff',
          padding: '0 12px',
          fontSize: 12,
          zIndex: 50,
        }}
      >
        {controlsVisible ? 'HIDE UI' : 'SHOW UI'}
      </button>

      <div
        style={{
          position: 'absolute',
          top: 'max(calc(env(safe-area-inset-top) + 44px), 44px)',
          right: 'max(env(safe-area-inset-right), 8px)',
          bottom: 'max(env(safe-area-inset-bottom), 8px)',
          width: 58,
          borderRadius: 10,
          border: '1px solid rgba(255,255,255,0.18)',
          background: 'rgba(0,0,0,0.42)',
          backdropFilter: 'blur(2px)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'stretch',
          padding: '6px 6px',
          opacity: 0.9,
          zIndex: 15,
        }}
        title="VU Mic"
      >
        <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.72)', letterSpacing: 0.4 }}>VU</div>
        {micMuted ? (
          <div
            style={{
              fontSize: 8,
              letterSpacing: 0.4,
              color: 'rgba(220,220,220,0.9)',
              marginTop: -2,
            }}
          >
            MUTED
          </div>
        ) : null}
        <div style={{ flex: 1, width: '100%', minHeight: 0, display: 'flex' }}>
          <ObsVuMeter level={micVuDisplay} peakLevel={micVuPeak} muted={micMuted} height="100%" />
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          left: 'max(env(safe-area-inset-left), 8px)',
          bottom: 'max(env(safe-area-inset-bottom), 8px)',
          padding: '4px 8px',
          borderRadius: 999,
          border: '1px solid rgba(255,255,255,0.18)',
          background: 'rgba(0,0,0,0.42)',
          color: 'rgba(255,255,255,0.82)',
          fontSize: 10,
          letterSpacing: 0.2,
          zIndex: 12,
          pointerEvents: 'none',
        }}
      >
        Powered by: Atec Consultoria
      </div>
    </div>
  )
}
