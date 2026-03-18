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

type RelayRole = 'publisher' | 'viewer'
type RelayRoom = {
  publisher: WebSocket | null
  viewer: WebSocket | null
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
  private socketRole = new WeakMap<WebSocket, RelayRole>()
  private socketRoom = new WeakMap<WebSocket, string>()
  private rooms = new Map<string, RelayRoom>()

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

    const raw = parsed.value as Record<string, unknown>
    const type = typeof raw.type === 'string' ? raw.type : ''
    if (type === 'join') {
      this.onCameraJoin(ws, raw)
      return
    }
    if (type === 'offer' || type === 'answer' || type === 'ice') {
      this.onCameraSignal(ws, raw)
      return
    }

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
    if (deviceId) {
      this.socketToDevice.delete(ws)

      const set = this.deviceToSockets.get(deviceId)
      if (set) {
        set.delete(ws)
        if (set.size === 0) this.deviceToSockets.delete(deviceId)
      }
    }

    const roomId = this.socketRoom.get(ws)
    const role = this.socketRole.get(ws)
    if (!roomId || !role) return

    this.socketRoom.delete(ws)
    this.socketRole.delete(ws)

    const room = this.rooms.get(roomId)
    if (!room) return

    if (role === 'publisher' && room.publisher === ws) {
      room.publisher = null
      if (room.viewer) this.send(room.viewer, { type: 'system', message: 'publisher-left' })
    }

    if (role === 'viewer' && room.viewer === ws) room.viewer = null

    if (!room.publisher && !room.viewer) this.rooms.delete(roomId)
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

  private onCameraJoin(ws: WebSocket, msg: Record<string, unknown>) {
    const role = msg.role === 'publisher' || msg.role === 'viewer' ? msg.role : null
    if (!role) return
    const roomRaw = typeof msg.room === 'string' ? msg.room.trim() : ''
    const roomId = roomRaw || 'studio'
    this.cleanup(ws)

    const room = this.getRoom(roomId)
    this.socketRole.set(ws, role)
    this.socketRoom.set(ws, roomId)

    if (role === 'publisher') {
      if (room.publisher && room.publisher !== ws) {
        this.send(room.publisher, { type: 'system', message: 'publisher_replaced' })
        room.publisher.close()
      }
      room.publisher = ws
      this.send(ws, { type: 'joined', role: 'publisher', room: roomId })
      return
    }

    if (room.viewer && room.viewer !== ws) {
      this.send(room.viewer, { type: 'system', message: 'viewer_replaced' })
      room.viewer.close()
    }
    room.viewer = ws
    this.send(ws, { type: 'joined', role: 'viewer', room: roomId })
    if (room.publisher) this.send(room.publisher, { type: 'viewer-ready' })
  }

  private onCameraSignal(ws: WebSocket, msg: Record<string, unknown>) {
    const roomId = this.socketRoom.get(ws)
    const role = this.socketRole.get(ws)
    if (!roomId || !role) return
    const room = this.getRoom(roomId)
    const type = typeof msg.type === 'string' ? msg.type : ''

    if (type === 'offer' && role === 'publisher') {
      if (room.viewer) this.send(room.viewer, { type: 'offer', sdp: msg.sdp })
      return
    }

    if (type === 'answer' && role === 'viewer' && room.publisher) {
      this.send(room.publisher, { type: 'answer', sdp: msg.sdp })
      return
    }

    if (type === 'ice') {
      if (role === 'publisher') {
        if (room.viewer) this.send(room.viewer, { type: 'ice', candidate: msg.candidate })
      } else if (role === 'viewer' && room.publisher) {
        this.send(room.publisher, { type: 'ice', candidate: msg.candidate })
      }
    }
  }

  private getRoom(roomId: string) {
    const existing = this.rooms.get(roomId)
    if (existing) return existing
    const created: RelayRoom = { publisher: null, viewer: null }
    this.rooms.set(roomId, created)
    return created
  }

  private send(ws: WebSocket, msg: WsServerMessage | Record<string, unknown>) {
    if (ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify(msg))
  }
}
