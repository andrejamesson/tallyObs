import type { RawServerBase } from 'fastify'
import WebSocket, { WebSocketServer, type RawData } from 'ws'

type CameraRelayHubOptions = {
  server: RawServerBase
  path: string
}

type RelayRole = 'publisher' | 'viewer'
type RelayRoom = {
  publisher: WebSocket | null
  viewer: WebSocket | null
}

function safeJsonParse(input: string) {
  try {
    return { ok: true as const, value: JSON.parse(input) as unknown }
  } catch {
    return { ok: false as const, value: undefined }
  }
}

function isObject(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null
}

export class CameraRelayHub {
  private wss: WebSocketServer
  private socketRole = new WeakMap<WebSocket, RelayRole>()
  private socketRoom = new WeakMap<WebSocket, string>()
  private rooms = new Map<string, RelayRoom>()

  constructor(opts: CameraRelayHubOptions) {
    this.wss = new WebSocketServer({ server: opts.server as any, path: opts.path })
  }

  start() {
    this.wss.on('error', () => {})
    this.wss.on('connection', (ws) => this.onConnection(ws))
  }

  stop() {
    this.wss.close()
  }

  private onConnection(ws: WebSocket) {
    ws.on('message', (data) => this.onMessage(ws, data))
    ws.on('close', () => this.cleanup(ws))
  }

  private onMessage(ws: WebSocket, data: RawData) {
    if (typeof data !== 'string' && !(data instanceof Buffer)) return
    const text = typeof data === 'string' ? data : data.toString('utf-8')
    const parsed = safeJsonParse(text)
    if (!parsed.ok || !isObject(parsed.value)) return

    const msg = parsed.value
    const type = typeof msg.type === 'string' ? msg.type : ''

    if (type === 'join') {
      const role = msg.role === 'publisher' || msg.role === 'viewer' ? msg.role : null
      if (!role) return
      const roomId = typeof msg.room === 'string' && msg.room.trim() ? msg.room.trim() : 'studio'
      this.join(ws, roomId, role)
      return
    }

    const roomId = this.socketRoom.get(ws)
    const role = this.socketRole.get(ws)
    if (!roomId || !role) return
    const room = this.getRoom(roomId)

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

  private join(ws: WebSocket, roomId: string, role: RelayRole) {
    this.cleanup(ws)
    const room = this.getRoom(roomId)

    this.socketRoom.set(ws, roomId)
    this.socketRole.set(ws, role)

    if (role === 'publisher') {
      if (room.publisher && room.publisher !== ws) {
        this.send(room.publisher, { type: 'system', message: 'publisher_replaced' })
        room.publisher.close()
      }
      room.publisher = ws
      this.send(ws, { type: 'joined', role: 'publisher', room: roomId })
      return
    }

    // OBS pode abrir múltiplas instâncias da mesma Browser Source.
    // Mantemos apenas 1 viewer por sala para evitar múltiplos answers em um único peer.
    if (room.viewer && room.viewer !== ws) {
      this.send(room.viewer, { type: 'system', message: 'viewer_replaced' })
      room.viewer.close()
    }
    room.viewer = ws
    this.send(ws, { type: 'joined', role: 'viewer', room: roomId })
    if (room.publisher) this.send(room.publisher, { type: 'viewer-ready' })
  }

  private cleanup(ws: WebSocket) {
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

    if (!room.publisher && !room.viewer) {
      this.rooms.delete(roomId)
    }
  }

  private getRoom(roomId: string) {
    const existing = this.rooms.get(roomId)
    if (existing) return existing
    const created: RelayRoom = { publisher: null, viewer: null }
    this.rooms.set(roomId, created)
    return created
  }

  private send(ws: WebSocket, payload: unknown) {
    if (ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify(payload))
  }
}
