import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import Fastify from 'fastify'
import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { loadAppConfig } from './config/appConfig.js'
import { registerRoutes } from './http/routes.js'
import { ObsClient } from './obs/obsClient.js'
import { computeOnAirByDevice } from './obs/tallyEngine.js'
import { StateStore } from './services/stateStore.js'
import { WsHub } from './ws/wsServer.js'

const config = await loadAppConfig()

const store = new StateStore()
store.setDevices(config.devices)

const fastify = Fastify(
  config.https.enabled
    ? ({
        logger: true,
        http2: false,
        https: {
          key: await readFile(path.resolve(process.cwd(), config.https.keyPath!)),
          cert: await readFile(path.resolve(process.cwd(), config.https.certPath!)),
        },
      } as any)
    : ({ logger: true } as any),
)
await fastify.register(cors, { origin: true })

const wsHub = new WsHub({
  server: fastify.server,
  path: '/ws',
  store,
  previewUrl: '/api/preview',
})
wsHub.start()

store.on('obsStatus', (connectedToObs) => {
  wsHub.broadcastStatus(connectedToObs)
  if (!connectedToObs) {
    for (const device of store.getAllDevices()) {
      store.setDeviceOnAir(device.deviceId, false)
    }
  }
})

store.on('deviceTally', (deviceId, onAir) => {
  wsHub.notifyDeviceTally(deviceId, onAir)
})

const obsClient = new ObsClient(config.obs, {
  onConnectionStatus: (connectedToObs) => store.setConnectedToObs(connectedToObs),
  onProgramStateChanged: (programSceneName, enabledSourceNames) => {
    const onAirByDevice = computeOnAirByDevice(store.getAllDevices(), programSceneName, enabledSourceNames)
    for (const [deviceId, onAir] of onAirByDevice.entries()) {
      store.setDeviceOnAir(deviceId, onAir)
    }
  },
}, { vuInputNames: config.vu.inputs })
void obsClient.start()

await registerRoutes(fastify, config, store, obsClient)

const webDistDir = path.resolve(process.cwd(), '..', 'web', 'dist')
const serveWeb = await directoryExists(webDistDir)

if (serveWeb) {
  await fastify.register(fastifyStatic, {
    root: webDistDir,
    prefix: '/',
  })

  fastify.setNotFoundHandler((req: any, reply: any) => {
    const url = req.raw.url ?? ''
    if (url.startsWith('/api/') || url.startsWith('/ws')) return reply.code(404).send({ ok: false })
    return reply.type('text/html; charset=utf-8').sendFile('index.html')
  })
}

try {
  await fastify.listen({ port: config.https.enabled ? config.https.port : config.server.port, host: '0.0.0.0' })
} catch (err) {
  const e = err as { code?: unknown }
  if (e && e.code === 'EADDRINUSE') {
    fastify.log.error({ err }, 'Porta já está em uso. Troque server.port (ou https.port) no config/app-config.json.')
  } else {
    fastify.log.error(err)
  }
  process.exit(1)
}

const shutdown = async () => {
  await obsClient.stop()
  wsHub.stop()
  await fastify.close()
}

process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())

async function directoryExists(dirPath: string) {
  try {
    await access(dirPath)
    return true
  } catch {
    return false
  }
}
