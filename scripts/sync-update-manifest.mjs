import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

const ROOT = process.cwd()
const BUILD_GRADLE = path.join(ROOT, 'apps', 'web', 'android', 'app', 'build.gradle')
const UPDATE_JSON = path.join(ROOT, 'update.json')
const APK_DIR = path.join(ROOT, 'apps', 'web', 'android', 'app', 'build', 'outputs', 'apk', 'release')
const RELEASE_BASE = 'https://github.com/andrejamesson/tallyObs/releases/latest/download'

function parseVersionInfo(buildGradleText) {
  const codeMatch = buildGradleText.match(/\bversionCode\s+(\d+)/)
  const nameMatch = buildGradleText.match(/\bversionName\s+"([^"]+)"/)
  if (!codeMatch || !nameMatch) {
    throw new Error('Nao foi possivel ler versionCode/versionName do build.gradle')
  }
  return {
    versionCode: Number.parseInt(codeMatch[1], 10),
    versionName: nameMatch[1].trim(),
  }
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256')
  const data = await fs.readFile(filePath)
  hash.update(data)
  return hash.digest('hex')
}

async function readExistingNotes() {
  try {
    const raw = await fs.readFile(UPDATE_JSON, 'utf-8')
    const parsed = JSON.parse(raw)
    return typeof parsed.notes === 'string' ? parsed.notes : ''
  } catch {
    return ''
  }
}

async function main() {
  const buildGradleText = await fs.readFile(BUILD_GRADLE, 'utf-8')
  const { versionCode, versionName } = parseVersionInfo(buildGradleText)
  const apkName = `tallyObs-v${versionName}.apk`
  const apkPath = path.join(APK_DIR, apkName)
  const apkUrl = `${RELEASE_BASE}/${apkName}`
  const notes = (await readExistingNotes()) || `Release ${versionName}`

  const payload = {
    versionCode,
    versionName,
    apkUrl,
    notes,
  }

  try {
    await fs.access(apkPath)
    payload.sha256 = await sha256File(apkPath)
  } catch {
    // APK ainda nao gerado. Mantem manifesto sem hash para nao quebrar update check.
  }

  await fs.writeFile(UPDATE_JSON, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8')
  process.stdout.write(`update.json sincronizado: v${versionName} (code ${versionCode})\n`)
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})

