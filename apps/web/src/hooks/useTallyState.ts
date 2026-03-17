import { useEffect, useMemo, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { App as CapacitorApp } from '@capacitor/app'
import { SocketClient, buildApiUrl, getConfiguredServerBaseUrl } from '../services/socketClient'
import type { WsServerMessage } from '../types/ws'

export type TallyViewState = {
  targetType: 'source' | 'scene' | null
  targetName: string | null
  previewUrl: string | null
  onAir: boolean
  connectedToServer: boolean
  connectedToObs: boolean
  lastDisconnect: { at: number; message: string } | null
}

export function useTallyState(deviceId: string) {
  const isNative = Capacitor.isNativePlatform()
  const [appIsActive, setAppIsActive] = useState(true)
  const [state, setState] = useState<TallyViewState>({
    targetType: null,
    targetName: null,
    previewUrl: null,
    onAir: false,
    connectedToServer: false,
    connectedToObs: false,
    lastDisconnect: null,
  })

  const client = useMemo(() => {
    return new SocketClient({
      deviceId,
      onConnectionChanged: (connected) => {
        setState((s) => ({ ...s, connectedToServer: connected, lastDisconnect: connected ? null : s.lastDisconnect }))
      },
      onServerMessage: (msg: WsServerMessage) => {
        setState((s) => applyMessage(s, msg))
      },
      onDisconnected: (info) => {
        const msg =
          info.code === 1006
            ? 'Conexão finalizada pelo outro lado (reset/queda)'
            : info.wasClean
              ? `Conexão encerrada (código ${info.code})`
              : `Conexão caiu (código ${info.code})`
        setState((s) => ({ ...s, lastDisconnect: { at: Date.now(), message: msg } }))
      },
    })
  }, [deviceId])

  useEffect(() => {
    if (isNative) return
    client.start()
    return () => client.stop()
  }, [client, isNative])

  useEffect(() => {
    if (!isNative) return
    let cancelled = false
    let handle: { remove: () => Promise<void> } | null = null

    const attach = async () => {
      try {
        handle = await CapacitorApp.addListener('appStateChange', ({ isActive }) => {
          if (cancelled) return
          setAppIsActive(isActive)
        })
      } catch {
        //
      }
    }

    void attach()
    return () => {
      cancelled = true
      if (!handle) return
      void handle.remove()
    }
  }, [isNative])

  useEffect(() => {
    if (!isNative) return
    if (!deviceId) return

    let cancelled = false

    const tick = async () => {
      try {
        const [stateRes, deviceRes] = await Promise.all([
          fetch(buildApiUrl(`/api/obs/state?t=${Date.now()}`), { cache: 'no-store' }),
          fetch(buildApiUrl(`/api/device/${encodeURIComponent(deviceId)}?t=${Date.now()}`), { cache: 'no-store' }),
        ])
        if (!stateRes.ok || !deviceRes.ok) throw new Error('bad_response')

        const obsState = (await stateRes.json()) as {
          connectedToObs?: boolean
          programSceneName?: string | null
        }
        const deviceState = (await deviceRes.json()) as {
          device?: { targetType?: 'source' | 'scene'; targetName?: string | null }
        }
        if (cancelled) return

        const targetType = deviceState.device?.targetType ?? null
        const targetName = deviceState.device?.targetName ?? null
        const programSceneName = obsState.programSceneName ?? null
        const onAir = targetType === 'scene' && Boolean(targetName) && targetName === programSceneName

        setState((prev) => ({
          ...prev,
          connectedToServer: true,
          connectedToObs: Boolean(obsState.connectedToObs),
          targetType,
          targetName,
          onAir,
          previewUrl: buildApiUrl('/api/preview'),
          lastDisconnect: null,
        }))
      } catch {
        if (cancelled) return
        setState((prev) => ({
          ...prev,
          connectedToServer: false,
        }))
      }
    }

    void tick()
    const intervalMs = appIsActive ? 800 : 2500
    const id = window.setInterval(tick, intervalMs)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [deviceId, isNative, appIsActive])

  return state
}

function applyMessage(prev: TallyViewState, msg: WsServerMessage): TallyViewState {
  if (msg.type === 'init') {
    const base = getConfiguredServerBaseUrl()
    const previewUrl =
      msg.previewUrl && msg.previewUrl.startsWith('/') && base ? `${base}${msg.previewUrl}` : msg.previewUrl
    return {
      ...prev,
      targetType: msg.targetType,
      targetName: msg.targetName,
      onAir: msg.onAir,
      previewUrl,
      connectedToObs: msg.connectedToObs,
    }
  }

  if (msg.type === 'tally') {
    return { ...prev, onAir: msg.onAir }
  }

  if (msg.type === 'status') {
    return { ...prev, connectedToObs: msg.connectedToObs }
  }

  return prev
}
