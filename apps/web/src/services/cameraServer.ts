import { getConfiguredServerBaseUrl } from './socketClient'

function buildFromParts(protocol: string, hostname: string, port: string) {
  const safePort = port.trim()
  return `${protocol}//${hostname}${safePort ? `:${safePort}` : ''}`
}

function deriveCameraBaseFromMain(mainBase: string) {
  try {
    const parsed = new URL(mainBase)
    const protocol = parsed.protocol === 'https:' ? 'https:' : 'http:'
    const host = parsed.hostname
    const currentPort = parsed.port ? Number(parsed.port) : protocol === 'https:' ? 443 : 80
    const cameraPort = Number.isFinite(currentPort) ? String(currentPort + 1) : '3002'
    return buildFromParts(protocol, host, cameraPort)
  } catch {
    return null
  }
}

function inferDefaultCameraBase() {
  const mainBase = getConfiguredServerBaseUrl()
  if (mainBase) {
    const derived = deriveCameraBaseFromMain(mainBase)
    if (derived) return derived
  }

  const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:'
  const host = window.location.hostname || 'localhost'
  return buildFromParts(protocol, host, '3002')
}

export function getCameraServerBaseUrl() {
  return inferDefaultCameraBase()
}

export function buildCameraApiUrl(path: string) {
  const base = getCameraServerBaseUrl()
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${base}${normalizedPath}`
}

export function buildCameraWsUrl(path = '/ws-camera') {
  const base = getCameraServerBaseUrl()
  try {
    const parsed = new URL(base)
    const protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:'
    const normalizedPath = path.startsWith('/') ? path : `/${path}`
    return `${protocol}//${parsed.host}${normalizedPath}`
  } catch {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const normalizedPath = path.startsWith('/') ? path : `/${path}`
    return `${protocol}//${window.location.host}${normalizedPath}`
  }
}
