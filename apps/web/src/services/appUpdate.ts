import { App as CapacitorApp } from '@capacitor/app'

const UPDATE_MANIFEST_URL = 'https://raw.githubusercontent.com/andrejamesson/tallyObs/main/update.json'

export type UpdateManifest = {
  versionCode: number
  versionName: string
  apkUrl: string
  sha256?: string
  notes?: string
}

export type AppVersionInfo = {
  versionCode: number
  versionName: string
}

export type AppUpdateCheckResult = {
  current: AppVersionInfo
  latest: UpdateManifest | null
  hasUpdate: boolean
}

function compareVersionNames(a: string, b: string) {
  const pa = a.split('.').map((part) => Number.parseInt(part, 10) || 0)
  const pb = b.split('.').map((part) => Number.parseInt(part, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i += 1) {
    const av = pa[i] ?? 0
    const bv = pb[i] ?? 0
    if (av > bv) return 1
    if (av < bv) return -1
  }
  return 0
}

async function readCurrentVersion(): Promise<AppVersionInfo> {
  let versionName = '0.0.0'
  let versionCode = 0
  try {
    const info = await CapacitorApp.getInfo()
    if (typeof info.version === 'string' && info.version.trim()) {
      versionName = info.version.trim()
    }
    if (typeof info.build === 'string' && info.build.trim()) {
      const parsed = Number.parseInt(info.build, 10)
      if (Number.isFinite(parsed)) versionCode = parsed
    }
  } catch {
    // running on web/dev can fail here; fallback below
  }

  if (!versionCode) {
    const envCode = Number.parseInt(import.meta.env.VITE_APP_VERSION_CODE ?? '', 10)
    if (Number.isFinite(envCode) && envCode > 0) versionCode = envCode
  }
  if (versionName === '0.0.0' && typeof import.meta.env.VITE_APP_VERSION_NAME === 'string') {
    const envName = import.meta.env.VITE_APP_VERSION_NAME.trim()
    if (envName) versionName = envName
  }
  return { versionCode, versionName }
}

function parseManifest(raw: unknown): UpdateManifest {
  if (typeof raw !== 'object' || raw === null) throw new Error('invalid_manifest')
  const body = raw as Record<string, unknown>
  const versionCode = Number(body.versionCode)
  const versionName = typeof body.versionName === 'string' ? body.versionName.trim() : ''
  const apkUrl = typeof body.apkUrl === 'string' ? body.apkUrl.trim() : ''
  const sha256 = typeof body.sha256 === 'string' ? body.sha256.trim() : undefined
  const notes = typeof body.notes === 'string' ? body.notes.trim() : undefined
  if (!Number.isFinite(versionCode) || versionCode <= 0) throw new Error('invalid_version_code')
  if (!versionName) throw new Error('invalid_version_name')
  if (!apkUrl || !/^https?:\/\//i.test(apkUrl)) throw new Error('invalid_apk_url')
  return { versionCode, versionName, apkUrl, sha256, notes }
}

export async function checkForAppUpdate(): Promise<AppUpdateCheckResult> {
  const current = await readCurrentVersion()
  const res = await fetch(`${UPDATE_MANIFEST_URL}?t=${Date.now()}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`manifest_http_${res.status}`)
  const latest = parseManifest((await res.json()) as unknown)
  const hasUpdate =
    latest.versionCode > current.versionCode ||
    (current.versionCode <= 0 && compareVersionNames(latest.versionName, current.versionName) > 0)
  return { current, latest, hasUpdate }
}

