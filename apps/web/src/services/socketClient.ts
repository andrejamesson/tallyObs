import type { WsClientRegisterMessage, WsServerMessage } from '../types/ws'

type SocketClientOptions = {
  deviceId: string
  onServerMessage: (msg: WsServerMessage) => void
  onConnectionChanged: (connected: boolean) => void
  onDisconnected?: (info: { code: number; reason: string; wasClean: boolean }) => void
}

export function normalizeServerBaseUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (!trimmed) return null

  const withProtocol = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`

  try {
    const url = new URL(withProtocol)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    url.pathname = ''
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

export function getConfiguredServerBaseUrl() {
  try {
    const raw = localStorage.getItem('tally.serverUrl')
    if (!raw) return null
    return normalizeServerBaseUrl(raw)
  } catch {
    return null
  }
}

export function buildApiUrl(path: string) {
  const base = getConfiguredServerBaseUrl()
  if (!base) return path
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${base}${normalizedPath}`
}

function buildWsUrl() {
  const base = getConfiguredServerBaseUrl()
  if (base) {
    try {
      const url = new URL(base)
      const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      return `${protocol}//${url.host}/ws`
    } catch {
      //
    }
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws`
}

function safeJsonParse(input: string) {
  try {
    return { ok: true as const, value: JSON.parse(input) as unknown }
  } catch {
    return { ok: false as const, value: undefined }
  }
}

export class SocketClient {
  private opts: SocketClientOptions
  private ws: WebSocket | null = null
  private stopped = false
  private reconnectAttempt = 0
  private reconnectTimer: number | null = null
  private connected = false

  constructor(opts: SocketClientOptions) {
    this.opts = opts
  }

  start() {
    this.stopped = false
    this.open()
  }

  stop() {
    this.stopped = true
    this.clearReconnect()
    this.connected = false
    this.opts.onConnectionChanged(false)
    if (this.ws) {
      this.ws.onopen = null
      this.ws.onmessage = null
      this.ws.onclose = null
      this.ws.onerror = null
      this.ws.close()
      this.ws = null
    }
  }

  private open() {
    this.clearReconnect()
    if (this.stopped) return

    let ws: WebSocket
    try {
      ws = new WebSocket(buildWsUrl())
    } catch {
      this.connected = false
      this.opts.onConnectionChanged(false)
      this.scheduleReconnect()
      return
    }
    this.ws = ws

    ws.onopen = () => {
      this.reconnectAttempt = 0
      this.connected = true
      this.opts.onConnectionChanged(true)
      const register: WsClientRegisterMessage = { type: 'register', deviceId: this.opts.deviceId }
      ws.send(JSON.stringify(register))
    }

    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return
      const parsed = safeJsonParse(ev.data)
      if (!parsed.ok) return
      const msg = parsed.value as WsServerMessage
      if (!msg || typeof msg !== 'object' || !('type' in msg)) return
      this.opts.onServerMessage(msg)
    }

    ws.onclose = (ev) => {
      const wasConnected = this.connected
      this.connected = false
      this.opts.onConnectionChanged(false)
      if (wasConnected && this.opts.onDisconnected) {
        this.opts.onDisconnected({
          code: ev.code,
          reason: ev.reason,
          wasClean: ev.wasClean,
        })
      }
      this.scheduleReconnect()
    }

    ws.onerror = () => {
      //
    }
  }

  private scheduleReconnect() {
    if (this.stopped) return
    if (this.reconnectTimer !== null) return
    this.reconnectAttempt += 1
    const delayMs = Math.min(8000, 400 + this.reconnectAttempt * 600)
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      this.open()
    }, delayMs)
  }

  private clearReconnect() {
    if (this.reconnectTimer === null) return
    window.clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }
}
