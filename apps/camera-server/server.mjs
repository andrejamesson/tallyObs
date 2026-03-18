import http from 'node:http'
import { WebSocketServer } from 'ws'

const PORT = Number(process.env.CAMERA_PORT || 3002)
const HOST = process.env.CAMERA_HOST || '0.0.0.0'

/** @type {Map<string, { publisher: import('ws').WebSocket | null, viewer: import('ws').WebSocket | null }>} */
const rooms = new Map()
/** @type {WeakMap<import('ws').WebSocket, string>} */
const socketRoom = new WeakMap()
/** @type {WeakMap<import('ws').WebSocket, 'publisher' | 'viewer'>} */
const socketRole = new WeakMap()

function getRoom(roomId) {
  const existing = rooms.get(roomId)
  if (existing) return existing
  const created = { publisher: null, viewer: null }
  rooms.set(roomId, created)
  return created
}

function cleanupSocket(ws) {
  const roomId = socketRoom.get(ws)
  const role = socketRole.get(ws)
  if (!roomId || !role) return

  socketRoom.delete(ws)
  socketRole.delete(ws)
  const room = rooms.get(roomId)
  if (!room) return

  if (role === 'publisher' && room.publisher === ws) {
    room.publisher = null
    if (room.viewer && room.viewer.readyState === room.viewer.OPEN) {
      room.viewer.send(JSON.stringify({ type: 'system', message: 'publisher-left' }))
    }
  }
  if (role === 'viewer' && room.viewer === ws) {
    room.viewer = null
  }
  if (!room.publisher && !room.viewer) rooms.delete(roomId)
}

function send(ws, payload) {
  if (!ws || ws.readyState !== ws.OPEN) return
  ws.send(JSON.stringify(payload))
}

function buildViewerHtml(roomId) {
  const safeRoom = JSON.stringify(roomId)
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Camera Viewer</title>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; background: #000; overflow: hidden; }
      #remote { width: 100vw; height: 100vh; object-fit: cover; background: #000; display: block; }
    </style>
  </head>
  <body>
    <video id="remote" autoplay playsinline></video>
    <script>
      const room = ${safeRoom}
      const remote = document.getElementById('remote')
      let ws = null
      let pc = null
      let reconnectTimer = null
      let closedByApp = false

      function clearReconnect() {
        if (!reconnectTimer) return
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }

      function scheduleReconnect() {
        if (closedByApp || reconnectTimer) return
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null
          connectViewer()
        }, 1400)
      }

      function closeTransport() {
        try { if (ws && ws.readyState <= 1) ws.close() } catch {}
        try { if (pc) pc.close() } catch {}
        ws = null
        pc = null
      }

      async function connectViewer() {
        clearReconnect()
        closeTransport()
        const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:'
        ws = new WebSocket(wsProto + '//' + location.host + '/ws-camera')
        pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })

        pc.ontrack = (evt) => {
          const stream = evt.streams && evt.streams[0] ? evt.streams[0] : null
          if (stream) remote.srcObject = stream
          else {
            let fallback = remote.srcObject
            if (!(fallback instanceof MediaStream)) {
              fallback = new MediaStream()
              remote.srcObject = fallback
            }
            fallback.addTrack(evt.track)
          }
          remote.muted = false
          remote.volume = 1
          remote.play().catch(() => {})
        }

        pc.onicecandidate = (evt) => {
          if (evt.candidate && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ice', candidate: evt.candidate }))
          }
        }

        pc.onconnectionstatechange = () => {
          if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
            scheduleReconnect()
          }
        }

        ws.onopen = () => ws.send(JSON.stringify({ type: 'join', role: 'viewer', room }))
        ws.onmessage = async (evt) => {
          let msg
          try { msg = JSON.parse(evt.data) } catch { return }

          if (msg.type === 'offer') {
            try {
              await pc.setRemoteDescription(msg.sdp)
              const answer = await pc.createAnswer()
              await pc.setLocalDescription(answer)
              ws.send(JSON.stringify({ type: 'answer', sdp: answer }))
            } catch {
              scheduleReconnect()
            }
          }

          if (msg.type === 'ice' && msg.candidate) {
            try { await pc.addIceCandidate(msg.candidate) } catch {}
          }

          if (msg.type === 'system' && msg.message === 'publisher-left') {
            remote.srcObject = null
            scheduleReconnect()
          }
        }

        ws.onerror = () => scheduleReconnect()
        ws.onclose = () => scheduleReconnect()
      }

      window.addEventListener('beforeunload', () => {
        closedByApp = true
        clearReconnect()
        closeTransport()
      })

      connectViewer()
    </script>
  </body>
</html>`
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)

  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ ok: true, service: 'camera-server' }))
    return
  }

  if (url.pathname === '/api/camera/viewer') {
    const room = (url.searchParams.get('room') || 'studio').trim() || 'studio'
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(buildViewerHtml(room))
    return
  }

  res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify({ ok: false, error: 'not_found' }))
})

const wss = new WebSocketServer({ noServer: true })
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  if (url.pathname !== '/ws-camera') {
    socket.destroy()
    return
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
})

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg
    try {
      msg = JSON.parse(String(raw))
    } catch {
      return
    }

    const type = typeof msg.type === 'string' ? msg.type : ''
    if (type === 'join') {
      const role = msg.role === 'publisher' || msg.role === 'viewer' ? msg.role : null
      if (!role) return
      const roomId = typeof msg.room === 'string' && msg.room.trim() ? msg.room.trim() : 'studio'

      cleanupSocket(ws)
      const room = getRoom(roomId)
      socketRole.set(ws, role)
      socketRoom.set(ws, roomId)

      if (role === 'publisher') {
        if (room.publisher && room.publisher !== ws) {
          send(room.publisher, { type: 'system', message: 'publisher_replaced' })
          room.publisher.close()
        }
        room.publisher = ws
        send(ws, { type: 'joined', role: 'publisher', room: roomId })
        if (room.viewer) send(ws, { type: 'viewer-ready' })
        return
      }

      if (room.viewer && room.viewer !== ws) {
        send(room.viewer, { type: 'system', message: 'viewer_replaced' })
        room.viewer.close()
      }
      room.viewer = ws
      send(ws, { type: 'joined', role: 'viewer', room: roomId })
      if (room.publisher) send(room.publisher, { type: 'viewer-ready' })
      return
    }

    const roomId = socketRoom.get(ws)
    const role = socketRole.get(ws)
    if (!roomId || !role) return
    const room = getRoom(roomId)

    if (type === 'offer' && role === 'publisher') {
      if (room.viewer) send(room.viewer, { type: 'offer', sdp: msg.sdp })
      return
    }
    if (type === 'answer' && role === 'viewer') {
      if (room.publisher) send(room.publisher, { type: 'answer', sdp: msg.sdp })
      return
    }
    if (type === 'ice') {
      if (role === 'publisher' && room.viewer) send(room.viewer, { type: 'ice', candidate: msg.candidate })
      if (role === 'viewer' && room.publisher) send(room.publisher, { type: 'ice', candidate: msg.candidate })
    }
  })

  ws.on('close', () => cleanupSocket(ws))
})

server.listen(PORT, HOST, () => {
  console.log(`[camera-server] running on http://${HOST}:${PORT}`)
})
