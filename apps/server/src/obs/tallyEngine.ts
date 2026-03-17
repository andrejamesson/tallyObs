export function computeOnAirByDevice(
  devices: Array<{ deviceId: string; targetType: 'source' | 'scene' | null; targetName: string | null }>,
  programSceneName: string | null,
  enabledSourceNames: Set<string>,
) {
  const result = new Map<string, boolean>()
  for (const d of devices) {
    if (!d.targetType || !d.targetName) {
      result.set(d.deviceId, false)
      continue
    }

    if (d.targetType === 'scene') {
      result.set(d.deviceId, programSceneName === d.targetName)
      continue
    }

    result.set(d.deviceId, enabledSourceNames.has(d.targetName))
  }
  return result
}
