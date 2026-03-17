import type { RawServerBase } from 'fastify'
import WebSocket, { WebSocketServer, type RawData } from 'ws'
import { wsClientMessageSchema, type WsServerMessage } from './wsTypes.js'
import type { StateStore } from '../services/stateStore.js'

type WsHubOptions = {
  server: RawServerBase
  path: string
  store: StateStore
  previewUrl: string | null
}

function safeJsonParse(input: string) {
  try {
    return { ok: true as const, value: JSON.parse(input) }
  } catch {
    return { ok: false as const, value: undefined }
  }
}

export class WsHub {
  private wss: WebSocketServer
  private store: StateStore
  private previewUrl: string | null
  private socketToDevice = new WeakMap<WebSocket, string>()
  private deviceToSockets = new Map<string, Set<WebSocket>>()

  constructor(opts: WsHubOptions) {
    this.wss = new WebSocketServer({ server: opts.server as any, path: opts.path })
    this.store = opts.store
    this.previewUrl = opts.previewUrl
  }

  start() {
    this.wss.on('error', () => {})
    this.wss.on('connection', (ws) => this.onConnection(ws))
  }

  stop() {
    this.wss.close()
  }

  broadcastStatus(connectedToObs: boolean) {
    const msg: WsServerMessage = { type: 'status', connectedToObs }
    this.broadcastAll(msg)
  }

  notifyDeviceTally(deviceId: string, onAir: boolean) {
    const msg: WsServerMessage = { type: 'tally', deviceId, onAir }
    const sockets = this.deviceToSockets.get(deviceId)
    if (!sockets) return
    for (const ws of sockets) {
      this.send(ws, msg)
    }
  }

  private onConnection(ws: WebSocket) {
    ws.on('message', (data) => this.onMessage(ws, data))
    ws.on('close', () => this.cleanup(ws))
  }

  private onMessage(ws: WebSocket, data: RawData) {
    if (typeof data !== 'string' && !(data instanceof Buffer)) return
    const text = typeof data === 'string' ? data : data.toString('utf-8')
    const parsed = safeJsonParse(text)
    if (!parsed.ok) return

    const msgResult = wsClientMessageSchema.safeParse(parsed.value)
    if (!msgResult.success) return

    if (msgResult.data.type === 'register') {
      this.register(ws, msgResult.data.deviceId)
      this.sendInit(ws, msgResult.data.deviceId)
    }
  }

  private register(ws: WebSocket, deviceId: string) {
    this.cleanup(ws)
    this.socketToDevice.set(ws, deviceId)
    const set = this.deviceToSockets.get(deviceId) ?? new Set<WebSocket>()
    set.add(ws)
    this.deviceToSockets.set(deviceId, set)
  }

  private cleanup(ws: WebSocket) {
    const deviceId = this.socketToDevice.get(ws)
    if (!deviceId) return
    this.socketToDevice.delete(ws)

    const set = this.deviceToSockets.get(deviceId)
    if (!set) return
    set.delete(ws)
    if (set.size === 0) this.deviceToSockets.delete(deviceId)
  }

  private sendInit(ws: WebSocket, deviceId: string) {
    const device = this.store.getDevice(deviceId)
    const msg: WsServerMessage = {
      type: 'init',
      deviceId,
      targetType: device?.targetType ?? null,
      targetName: device?.targetName ?? null,
      onAir: device?.onAir ?? false,
      previewUrl: this.previewUrl,
      connectedToObs: this.store.getConnectedToObs(),
    }
    this.send(ws, msg)
  }

  private broadcastAll(msg: WsServerMessage) {
    for (const client of this.wss.clients) {
      this.send(client, msg)
    }
  }

  private send(ws: WebSocket, msg: WsServerMessage) {
    if (ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify(msg))
  }
}
