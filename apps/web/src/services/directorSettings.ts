export type DirectorExtraScene = {
  sceneName: string
  color: string
}

type DirectorSettings = {
  extraScenes: DirectorExtraScene[]
}

const DIRECTOR_SETTINGS_KEY = 'tally.director.settings.v1'

function normalizeColor(value: string) {
  const raw = value.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toUpperCase()
  return '#2CCD51'
}

export function normalizeSceneName(value: string) {
  return value.trim()
}

export function getDirectorSettings(): DirectorSettings {
  try {
    const raw = localStorage.getItem(DIRECTOR_SETTINGS_KEY)
    if (!raw) return { extraScenes: [] }
    const parsed = JSON.parse(raw) as unknown
    const list = (parsed as { extraScenes?: unknown })?.extraScenes
    if (!Array.isArray(list)) return { extraScenes: [] }

    const extraScenes = list
      .map((item) => {
        const sceneName = normalizeSceneName(String((item as { sceneName?: unknown })?.sceneName ?? ''))
        const color = normalizeColor(String((item as { color?: unknown })?.color ?? '#2CCD51'))
        if (!sceneName) return null
        return { sceneName, color }
      })
      .filter((v): v is DirectorExtraScene => Boolean(v))

    return { extraScenes }
  } catch {
    return { extraScenes: [] }
  }
}

export function saveDirectorSettings(settings: DirectorSettings) {
  const seen = new Set<string>()
  const extraScenes = settings.extraScenes
    .map((s) => ({
      sceneName: normalizeSceneName(s.sceneName),
      color: normalizeColor(s.color),
    }))
    .filter((s) => s.sceneName.length > 0)
    .filter((s) => {
      const key = s.sceneName.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

  localStorage.setItem(DIRECTOR_SETTINGS_KEY, JSON.stringify({ extraScenes }))
}
