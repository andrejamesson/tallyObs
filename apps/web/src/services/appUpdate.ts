import { App as CapacitorApp } from '@capacitor/app'

const UPDATE_MANIFEST_URL = 'https://raw.githubusercontent.com/andrejamesson/tallyObs/main/update.json'
const GITHUB_RELEASES_API = 'https://api.github.com/repos/andrejamesson/tallyObs/releases'

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

export type GithubReleaseNotes = {
  tagName: string
  title: string
  body: string
  htmlUrl: string
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

export async function getCurrentAppVersion(): Promise<AppVersionInfo> {
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

function parseGithubRelease(raw: unknown): GithubReleaseNotes {
  if (typeof raw !== 'object' || raw === null) throw new Error('invalid_release_payload')
  const body = raw as Record<string, unknown>
  const tagName = typeof body.tag_name === 'string' ? body.tag_name.trim() : ''
  const title = typeof body.name === 'string' ? body.name.trim() : ''
  const releaseBody = typeof body.body === 'string' ? body.body.trim() : ''
  const htmlUrl = typeof body.html_url === 'string' ? body.html_url.trim() : ''
  if (!tagName) throw new Error('invalid_release_tag')
  return {
    tagName,
    title: title || tagName,
    body: releaseBody || 'Sem notas publicadas para esta versão.',
    htmlUrl,
  }
}

export async function fetchGithubReleaseNotes(versionName: string): Promise<GithubReleaseNotes> {
  const clean = versionName.trim().replace(/^v/i, '')
  if (!clean) throw new Error('invalid_version_name')
  const tag = `v${clean}`

  const byTag = await fetch(`${GITHUB_RELEASES_API}/tags/${encodeURIComponent(tag)}?t=${Date.now()}`, {
    cache: 'no-store',
  })
  if (byTag.ok) return parseGithubRelease((await byTag.json()) as unknown)
  if (byTag.status !== 404) throw new Error(`github_release_http_${byTag.status}`)

  const latest = await fetch(`${GITHUB_RELEASES_API}/latest?t=${Date.now()}`, { cache: 'no-store' })
  if (!latest.ok) throw new Error(`github_latest_http_${latest.status}`)
  return parseGithubRelease((await latest.json()) as unknown)
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
  const current = await getCurrentAppVersion()
  const res = await fetch(`${UPDATE_MANIFEST_URL}?t=${Date.now()}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`manifest_http_${res.status}`)
  const latest = parseManifest((await res.json()) as unknown)
  const hasUpdate =
    latest.versionCode > current.versionCode ||
    (current.versionCode <= 0 && compareVersionNames(latest.versionName, current.versionName) > 0)
  return { current, latest, hasUpdate }
}
