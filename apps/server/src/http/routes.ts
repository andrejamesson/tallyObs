import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppConfig, DeviceTargetType } from '../config/appConfig.js'
import { upsertDeviceMapping } from '../config/appConfig.js'
import type { StateStore } from '../services/stateStore.js'
import type { ObsClient } from '../obs/obsClient.js'

const upsertDeviceBodySchema = z.object({
  targetType: z.union([z.literal('source'), z.literal('scene')]),
  targetName: z.string().min(1),
})
const upsertDeviceQuerySchema = z.object({
  targetType: z.union([z.literal('source'), z.literal('scene')]),
  targetName: z.string().min(1),
})
const setProgramSceneBodySchema = z.object({
  sceneName: z.string().min(1),
})
const setProgramSceneQuerySchema = z.object({
  sceneName: z.string().min(1),
})

export async function registerRoutes(
  fastify: FastifyInstance<any, any, any, any, any>,
  config: AppConfig,
  store: StateStore,
  obsClient: ObsClient,
) {
  fastify.get('/api/health', async () => {
    return {
      ok: true,
      connectedToObs: store.getConnectedToObs(),
    }
  })

  fastify.get('/api/config', async () => {
    return {
      preview: { url: '/api/preview' },
      devices: store.getAllDevices().map((d) => ({
        deviceId: d.deviceId,
        targetType: d.targetType,
        targetName: d.targetName,
      })),
    }
  })

  fastify.get('/api/obs/targets', async () => {
    const targets = await obsClient.getTargets()
    return { ok: true, ...targets }
  })

  fastify.get('/api/obs/state', async () => {
    return {
      ok: true,
      connectedToObs: obsClient.getConnected(),
      programSceneName: obsClient.getProgramSceneName(),
      vu: obsClient.getVuLevel(),
      vuMuted: obsClient.getVuMuted(),
    }
  })

  fastify.get('/api/obs/vu', async () => {
    return {
      ok: true,
      connectedToObs: obsClient.getConnected(),
      vu: obsClient.getVuLevel(),
      vuAt: obsClient.getVuAt(),
      vuMuted: obsClient.getVuMuted(),
    }
  })

  fastify.post('/api/obs/program-scene', async (req, reply) => {
    const bodyResult = setProgramSceneBodySchema.safeParse(req.body)
    if (!bodyResult.success) return reply.code(400).send({ ok: false, error: 'invalid_body' })

    const ok = await obsClient.setProgramScene(bodyResult.data.sceneName)
    if (!ok) return reply.code(503).send({ ok: false, error: 'obs_unavailable' })
    return { ok: true }
  })

  fastify.get('/api/obs/program-scene', async (req, reply) => {
    const queryResult = setProgramSceneQuerySchema.safeParse(req.query)
    if (!queryResult.success) return reply.code(400).send({ ok: false, error: 'invalid_query' })

    const ok = await obsClient.setProgramScene(queryResult.data.sceneName)
    if (!ok) return reply.code(503).send({ ok: false, error: 'obs_unavailable' })
    return { ok: true }
  })

  fastify.get('/api/device/:deviceId', async (req, reply) => {
    const { deviceId } = req.params as { deviceId: string }
    const device = store.getDevice(deviceId)
    if (!device) return reply.code(404).send({ ok: false, error: 'unknown_device' })
    return { ok: true, device }
  })

  fastify.post('/api/device/:deviceId', async (req, reply) => {
    const { deviceId } = req.params as { deviceId: string }
    const bodyResult = upsertDeviceBodySchema.safeParse(req.body)
    if (!bodyResult.success) return reply.code(400).send({ ok: false, error: 'invalid_body' })

    const targetType = bodyResult.data.targetType as DeviceTargetType
    const targetName = bodyResult.data.targetName

    const mapping = { deviceId, targetType, targetName }
    await upsertDeviceMapping(mapping)
    store.upsertDeviceMapping(mapping)

    return { ok: true }
  })

  // Android WebView fallback: allows saving without preflighted JSON POST.
  fastify.get('/api/device/:deviceId/upsert', async (req, reply) => {
    const { deviceId } = req.params as { deviceId: string }
    const queryResult = upsertDeviceQuerySchema.safeParse(req.query)
    if (!queryResult.success) return reply.code(400).send({ ok: false, error: 'invalid_query' })

    const targetType = queryResult.data.targetType as DeviceTargetType
    const targetName = queryResult.data.targetName

    const mapping = { deviceId, targetType, targetName }
    await upsertDeviceMapping(mapping)
    store.upsertDeviceMapping(mapping)

    return { ok: true }
  })

  fastify.get('/api/preview', async (_req, reply) => {
    if (config.preview?.url) {
      const reachable = await isReachable(config.preview.url)
      if (reachable) return reply.redirect(config.preview.url)
    }

    const html = buildPreviewHtml()
    return reply.type('text/html; charset=utf-8').send(html)
  })

  fastify.get('/api/preview.jpg', async (_req, reply) => {
    const buffer = await obsClient.getProgramScreenshotJpeg()
    if (!buffer) return reply.code(204).send()
    return reply
      .header('cache-control', 'no-store')
      .type('image/jpeg')
      .send(buffer)
  })

  fastify.get('/api/preview.mjpeg', async (req, reply) => {
    const query = (req.query ?? {}) as Record<string, string | undefined>
    const fpsRaw = query.fps ? Number(query.fps) : 15
    const widthRaw = query.width ? Number(query.width) : 960
    const qualityRaw = query.quality ? Number(query.quality) : 55

    const fps = Number.isFinite(fpsRaw) ? Math.max(1, Math.min(30, Math.floor(fpsRaw))) : 15
    const width = Number.isFinite(widthRaw) ? Math.max(320, Math.min(1920, Math.floor(widthRaw))) : 960
    const quality = Number.isFinite(qualityRaw) ? Math.max(20, Math.min(100, Math.floor(qualityRaw))) : 55

    reply.raw.writeHead(200, {
      'content-type': 'multipart/x-mixed-replace; boundary=frame',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      pragma: 'no-cache',
    })
    reply.hijack()

    let closed = false
    req.raw.on('close', () => {
      closed = true
    })

    const intervalMs = Math.max(1, Math.floor(1000 / fps))
    while (!closed) {
      const startedAt = Date.now()
      const buffer = await obsClient.getProgramScreenshotJpegFresh({ width, quality })
      if (buffer) {
        reply.raw.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${buffer.length}\r\n\r\n`)
        reply.raw.write(buffer)
        reply.raw.write('\r\n')
      }
      const elapsed = Date.now() - startedAt
      const sleepMs = Math.max(1, intervalMs - elapsed)
      await delay(sleepMs)
    }
  })
}

async function isReachable(url: string) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 800)
  try {
    const res = await fetch(url, { method: 'HEAD', signal: controller.signal })
    if (res.ok) return true
    if (res.status === 405) return true
    return false
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

function buildPreviewHtml() {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Preview</title>
    <style>
      html, body { height: 100%; width: 100%; margin: 0; background: #000; overflow: hidden; }
      #wrap { height: 100%; width: 100%; display: flex; align-items: center; justify-content: center; }
      #img { max-width: 100%; max-height: 100%; object-fit: contain; }
      #hud { position: absolute; top: 10px; left: 10px; right: 10px; display: flex; align-items: center; justify-content: space-between; gap: 12px; pointer-events: none; }
      #scene { color: rgba(255,255,255,0.9); font: 13px system-ui, -apple-system, Segoe UI, Roboto, Arial; text-shadow: 0 1px 2px rgba(0,0,0,0.7); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    </style>
  </head>
  <body>
    <div id="wrap">
      <div id="hud">
        <div id="scene"></div>
      </div>
      <img id="img" alt="preview" src="/api/preview.mjpeg?fps=24&width=540&quality=40" />
    </div>
    <script>
      const sceneEl = document.getElementById('scene')
      async function refresh() {
        try {
          const res = await fetch('/api/obs/state?t=' + Date.now(), { cache: 'no-store' })
          const data = await res.json()
          const scene = data && data.programSceneName ? String(data.programSceneName) : ''
          if (sceneEl) sceneEl.textContent = scene ? ('Program: ' + scene) : 'OBS desconectado'
        } catch {
          if (sceneEl) sceneEl.textContent = 'OBS desconectado'
        }
      }
      refresh()
      setInterval(refresh, 500)
    </script>
  </body>
</html>`
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}
