import { z } from 'zod'

export const wsClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('register'),
    deviceId: z.string().min(1),
  }),
])

export type WsClientMessage = z.infer<typeof wsClientMessageSchema>

export type WsServerInitMessage = {
  type: 'init'
  deviceId: string
  targetType: 'source' | 'scene' | null
  targetName: string | null
  onAir: boolean
  previewUrl: string | null
  connectedToObs: boolean
}

export type WsServerTallyMessage = {
  type: 'tally'
  deviceId: string
  onAir: boolean
}

export type WsServerStatusMessage = {
  type: 'status'
  connectedToObs: boolean
}

export type WsServerMessage = WsServerInitMessage | WsServerTallyMessage | WsServerStatusMessage
