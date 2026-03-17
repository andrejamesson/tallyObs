import OBSWebSocket, { EventSubscription } from 'obs-websocket-js'

type Handlers = {
  onConnectionStatus: (connectedToObs: boolean) => void
  onProgramStateChanged: (programSceneName: string, enabledSourceNames: Set<string>) => void
}

type ObsClientOptions = {
  vuInputNames?: string[]
}

export type ObsConnectionConfig = {
  host: string
  port: number
  password?: string
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

export class ObsClient {
  private obs = new OBSWebSocket()
  private stopped = false
  private refreshTimer: NodeJS.Timeout | undefined
  private handlers: Handlers
  private config: ObsConnectionConfig
  private connected = false
  private programSceneName: string | null = null
  private lastScreenshot: { at: number; buffer: Buffer } | null = null
  private screenshotInFlight: Promise<Buffer | null> | null = null
  private vuLevel = 0
  private vuAt = 0
  private vuMuted = false
  private vuMuteByInput = new Map<string, boolean>()
  private vuInputNames: Set<string> | null = null

  constructor(config: ObsConnectionConfig, handlers: Handlers, opts?: ObsClientOptions) {
    this.config = config
    this.handlers = handlers
    const list = opts?.vuInputNames?.map((s) => s.trim()).filter(Boolean) ?? []
    this.vuInputNames = list.length ? new Set(list) : null
  }

  async start() {
    this.stopped = false
    await this.connectLoop()
  }

  async stop() {
    this.stopped = true
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    try {
      await this.obs.disconnect()
    } catch {
      //
    }
  }

  private async connectLoop() {
    while (!this.stopped) {
      try {
        this.obs.removeAllListeners()
        this.registerConnectionListeners()

        const url = `ws://${this.config.host}:${this.config.port}`
        await this.obs.connect(url, this.config.password, {
          rpcVersion: 1,
          eventSubscriptions:
            EventSubscription.General |
            EventSubscription.Scenes |
            EventSubscription.SceneItems |
            EventSubscription.Inputs |
            EventSubscription.InputVolumeMeters,
        })

        this.connected = true
        this.handlers.onConnectionStatus(true)
        this.registerSceneListeners()
        this.registerAudioListeners()
        await this.refreshVuMuteState()
        await this.refreshProgramScene()

        await new Promise<void>((resolve) => {
          this.obs.once('ConnectionClosed', () => resolve())
        })
      } catch {
        this.connected = false
        this.handlers.onConnectionStatus(false)
        await delay(1500)
      }
    }
  }

  private registerConnectionListeners() {
    this.obs.on('ConnectionClosed', () => {
      this.connected = false
      this.vuMuted = false
      this.vuMuteByInput.clear()
      this.handlers.onConnectionStatus(false)
    })
  }

  private registerSceneListeners() {
    const schedule = () => this.scheduleRefresh()
    this.obs.on('CurrentProgramSceneChanged', schedule)
    this.obs.on('SceneItemEnableStateChanged', schedule)
    this.obs.on('SceneItemCreated', schedule)
    this.obs.on('SceneItemRemoved', schedule)
  }

  private registerAudioListeners() {
    this.obs.on('InputVolumeMeters', (data: unknown) => {
      const inputs = (data as { inputs?: unknown })?.inputs
      if (!Array.isArray(inputs)) return

      let max = 0
      for (const input of inputs) {
        const inputName = (input as { inputName?: unknown })?.inputName
        if (this.vuInputNames && typeof inputName === 'string' && !this.vuInputNames.has(inputName)) continue
        if (this.vuInputNames && typeof inputName !== 'string') continue

        const levels = (input as { inputLevelsMul?: unknown })?.inputLevelsMul
        if (!Array.isArray(levels)) continue
        for (const channel of levels) {
          if (!Array.isArray(channel)) continue
          for (const sample of channel) {
            if (typeof sample !== 'number') continue
            if (sample > max) max = sample
          }
        }
      }

      if (max > 1) max = 1
      if (max < 0) max = 0
      this.vuLevel = max
      this.vuAt = Date.now()
    })

    this.obs.on('InputMuteStateChanged', (data: unknown) => {
      const inputName = (data as { inputName?: unknown })?.inputName
      const inputMuted = (data as { inputMuted?: unknown })?.inputMuted
      if (typeof inputName !== 'string' || typeof inputMuted !== 'boolean') return
      if (this.vuInputNames && !this.vuInputNames.has(inputName)) return
      this.vuMuteByInput.set(inputName, inputMuted)
      this.recomputeVuMuted()
    })
  }

  private async refreshVuMuteState() {
    if (!this.connected) {
      this.vuMuted = false
      this.vuMuteByInput.clear()
      return
    }

    const names = this.vuInputNames ? Array.from(this.vuInputNames.values()) : []
    if (names.length === 0) {
      this.vuMuted = false
      return
    }

    const next = new Map<string, boolean>()
    for (const inputName of names) {
      try {
        const resp = (await this.obs.call('GetInputMute', { inputName })) as unknown as { inputMuted?: unknown }
        next.set(inputName, Boolean(resp.inputMuted))
      } catch {
        //
      }
    }
    if (next.size > 0) this.vuMuteByInput = next
    this.recomputeVuMuted()
  }

  private recomputeVuMuted() {
    if (!this.vuInputNames || this.vuInputNames.size === 0) {
      this.vuMuted = false
      return
    }

    let hasAny = false
    let allMuted = true
    for (const name of this.vuInputNames.values()) {
      const muted = this.vuMuteByInput.get(name)
      if (typeof muted !== 'boolean') continue
      hasAny = true
      if (!muted) {
        allMuted = false
        break
      }
    }

    this.vuMuted = hasAny && allMuted
  }

  private scheduleRefresh() {
    if (this.refreshTimer) return
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined
      void this.refreshProgramScene()
    }, 100)
  }

  private async refreshProgramScene() {
    try {
      const { currentProgramSceneName } = (await this.obs.call('GetCurrentProgramScene')) as {
        currentProgramSceneName: string
      }
      this.programSceneName = currentProgramSceneName

      const { sceneItems } = (await this.obs.call('GetSceneItemList', {
        sceneName: currentProgramSceneName,
      })) as {
        sceneItems: Array<{ sourceName: string; sceneItemEnabled: boolean }>
      }

      const enabledSourceNames = new Set(
        sceneItems.filter((i) => i.sceneItemEnabled).map((i) => i.sourceName),
      )
      this.handlers.onProgramStateChanged(currentProgramSceneName, enabledSourceNames)
    } catch {
      //
    }
  }

  getProgramSceneName() {
    return this.programSceneName
  }

  getConnected() {
    return this.connected
  }

  async setProgramScene(sceneName: string) {
    const next = sceneName.trim()
    if (!next) return false
    if (!this.connected) return false

    try {
      await this.obs.call('SetCurrentProgramScene', { sceneName: next })
      this.scheduleRefresh()
      return true
    } catch {
      return false
    }
  }

  getVuLevel() {
    const age = Date.now() - this.vuAt
    if (age > 1500) return 0
    return this.vuLevel
  }

  getVuAt() {
    return this.vuAt
  }

  getVuMuted() {
    return this.vuMuted
  }

  async getProgramScreenshotJpeg() {
    if (!this.connected) return null
    if (!this.programSceneName) return null

    const now = Date.now()
    if (this.lastScreenshot && now - this.lastScreenshot.at < 350) return this.lastScreenshot.buffer
    if (this.screenshotInFlight) return this.screenshotInFlight

    const promise = (async () => {
      try {
        const programSceneName = this.programSceneName
        if (!programSceneName) return null
        const resp = (await this.obs.call('GetSourceScreenshot', {
          sourceName: programSceneName,
          imageFormat: 'jpeg',
          imageWidth: 1280,
          imageCompressionQuality: 60,
        })) as unknown as { imageData: string }

        const imageData = resp.imageData
        const commaIndex = imageData.indexOf(',')
        const base64 = commaIndex >= 0 ? imageData.slice(commaIndex + 1) : imageData
        const buffer = Buffer.from(base64, 'base64')
        this.lastScreenshot = { at: Date.now(), buffer }
        return buffer
      } catch {
        return null
      } finally {
        this.screenshotInFlight = null
      }
    })()

    this.screenshotInFlight = promise
    return promise
  }

  async getProgramScreenshotJpegFresh(opts?: { width?: number; quality?: number }) {
    if (!this.connected) return null
    if (!this.programSceneName) return null
    if (this.screenshotInFlight) return this.screenshotInFlight

    const width = typeof opts?.width === 'number' ? Math.max(320, Math.min(1920, Math.floor(opts.width))) : 960
    const quality =
      typeof opts?.quality === 'number' ? Math.max(20, Math.min(100, Math.floor(opts.quality))) : 55

    const promise = (async () => {
      try {
        const programSceneName = this.programSceneName
        if (!programSceneName) return null
        const resp = (await this.obs.call('GetSourceScreenshot', {
          sourceName: programSceneName,
          imageFormat: 'jpeg',
          imageWidth: width,
          imageCompressionQuality: quality,
        })) as unknown as { imageData: string }

        const imageData = resp.imageData
        const commaIndex = imageData.indexOf(',')
        const base64 = commaIndex >= 0 ? imageData.slice(commaIndex + 1) : imageData
        return Buffer.from(base64, 'base64')
      } catch {
        return null
      } finally {
        this.screenshotInFlight = null
      }
    })()

    this.screenshotInFlight = promise
    return promise
  }

  async getTargets() {
    if (!this.connected) return { connectedToObs: false as const, scenes: [], sources: [] }

    try {
      const scenesResp = (await this.obs.call('GetSceneList')) as unknown as {
        scenes: Array<{ sceneName: string }>
      }
      const inputsResp = (await this.obs.call('GetInputList')) as unknown as {
        inputs: Array<{ inputName: string }>
      }

      const scenes = scenesResp.scenes.map((s) => s.sceneName).sort((a, b) => a.localeCompare(b))
      const sources = inputsResp.inputs.map((i) => i.inputName).sort((a, b) => a.localeCompare(b))

      return { connectedToObs: true as const, scenes, sources }
    } catch {
      return { connectedToObs: false as const, scenes: [], sources: [] }
    }
  }
}
