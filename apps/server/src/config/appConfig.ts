import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'

const obsConfigSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().positive(),
  password: z.string().optional(),
})

const previewConfigSchema = z.object({
  url: z.union([z.string().url(), z.null()]).default(null),
})

const serverConfigSchema = z.object({
  port: z.number().int().positive().default(3001),
})

const httpsConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    port: z.number().int().positive().default(3443),
    keyPath: z.string().min(1).optional(),
    certPath: z.string().min(1).optional(),
  })
  .refine((v) => !v.enabled || (Boolean(v.keyPath) && Boolean(v.certPath)), {
    message: 'https.enabled requires https.keyPath and https.certPath',
  })

const vuConfigSchema = z.object({
  inputs: z.array(z.string().min(1)).optional().default([]),
})

const appConfigSchema = z.object({
  obs: obsConfigSchema,
  preview: previewConfigSchema.optional().default({ url: null }),
  server: serverConfigSchema.optional().default({ port: 3001 }),
  https: httpsConfigSchema.optional().default({ enabled: false, port: 3443 }),
  vu: vuConfigSchema.optional().default({ inputs: [] }),
})

const deviceTargetTypeSchema = z.union([z.literal('source'), z.literal('scene')])

const deviceRawSchema = z.union([
  z.object({
    deviceId: z.string().min(1),
    sourceName: z.string().min(1),
  }),
  z.object({
    deviceId: z.string().min(1),
    sceneName: z.string().min(1),
  }),
  z.object({
    deviceId: z.string().min(1),
    targetType: deviceTargetTypeSchema,
    targetName: z.string().min(1),
  }),
])

const devicesSchema = z.object({
  devices: z.array(deviceRawSchema),
})

export type ObsConfig = z.infer<typeof obsConfigSchema>
export type PreviewConfig = z.infer<typeof previewConfigSchema>
export type ServerConfig = z.infer<typeof serverConfigSchema>
export type HttpsConfig = z.infer<typeof httpsConfigSchema>
export type VuConfig = z.infer<typeof vuConfigSchema>
export type DeviceTargetType = z.infer<typeof deviceTargetTypeSchema>
export type DeviceMapping = { deviceId: string; targetType: DeviceTargetType; targetName: string }
export type AppConfig = z.infer<typeof appConfigSchema> & { devices: DeviceMapping[] }

function normalizeDeviceMapping(raw: z.infer<typeof deviceRawSchema>): DeviceMapping {
  if ('targetType' in raw) return { deviceId: raw.deviceId, targetType: raw.targetType, targetName: raw.targetName }
  if ('sceneName' in raw) return { deviceId: raw.deviceId, targetType: 'scene', targetName: raw.sceneName }
  return { deviceId: raw.deviceId, targetType: 'source', targetName: raw.sourceName }
}

function resolveConfigPaths() {
  const root = path.resolve(process.cwd())
  return {
    appConfigPath: path.join(root, 'config', 'app-config.json'),
    devicesPath: path.join(root, 'config', 'devices.json'),
  }
}

export async function loadAppConfig(): Promise<AppConfig> {
  const { appConfigPath, devicesPath } = resolveConfigPaths()

  const [appConfigRaw, devicesRaw] = await Promise.all([
    readFile(appConfigPath, 'utf-8'),
    readFile(devicesPath, 'utf-8'),
  ])

  const parsedAppConfig = appConfigSchema.parse(JSON.parse(appConfigRaw))
  const parsedDevices = devicesSchema.parse(JSON.parse(devicesRaw))
  const normalizedDevices = parsedDevices.devices.map((d) => normalizeDeviceMapping(d))

  return {
    ...parsedAppConfig,
    devices: normalizedDevices,
  }
}

export async function upsertDeviceMapping(input: DeviceMapping) {
  const { devicesPath } = resolveConfigPaths()
  const devicesRaw = await readFile(devicesPath, 'utf-8')
  const parsedDevices = devicesSchema.parse(JSON.parse(devicesRaw))
  const normalized = parsedDevices.devices.map((d) => normalizeDeviceMapping(d))

  const next = normalized.filter((d) => d.deviceId !== input.deviceId)
  next.push(input)
  next.sort((a, b) => a.deviceId.localeCompare(b.deviceId))

  await writeFile(devicesPath, JSON.stringify({ devices: next }, null, 2) + '\n', 'utf-8')
}
