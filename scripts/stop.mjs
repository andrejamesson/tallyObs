import { execFileSync } from 'node:child_process'

function pidsForPort(port) {
  try {
    const out = execFileSync('lsof', ['-ti', `:${port}`], { encoding: 'utf8' }).trim()
    if (!out) return []
    return out.split(/\s+/).filter(Boolean)
  } catch {
    return []
  }
}

function stopPort(port) {
  const pids = pidsForPort(port)
  for (const pid of pids) {
    try {
      process.kill(Number(pid), 'SIGTERM')
    } catch {
      //
    }
  }
}

stopPort(3001)
stopPort(5173)
