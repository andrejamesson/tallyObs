import { EventEmitter } from 'node:events'
import type { DeviceMapping, DeviceTargetType } from '../config/appConfig.js'

export type DeviceState = {
  deviceId: string
  targetType: DeviceTargetType | null
  targetName: string | null
  onAir: boolean
}

type StoreEvents = {
  obsStatus: (connectedToObs: boolean) => void
  deviceTally: (deviceId: string, onAir: boolean) => void
}

export class StateStore {
  private emitter = new EventEmitter()
  private connectedToObs = false
  private devices = new Map<string, DeviceState>()

  setDevices(mappings: DeviceMapping[]) {
    this.devices.clear()
    for (const d of mappings) {
      this.devices.set(d.deviceId, {
        deviceId: d.deviceId,
        targetType: d.targetType,
        targetName: d.targetName,
        onAir: false,
      })
    }
  }

  upsertDeviceMapping(mapping: DeviceMapping) {
    const existing = this.devices.get(mapping.deviceId)
    if (!existing) {
      this.devices.set(mapping.deviceId, {
        deviceId: mapping.deviceId,
        targetType: mapping.targetType,
        targetName: mapping.targetName,
        onAir: false,
      })
      return
    }

    existing.targetType = mapping.targetType
    existing.targetName = mapping.targetName
  }

  getConnectedToObs() {
    return this.connectedToObs
  }

  setConnectedToObs(connected: boolean) {
    if (this.connectedToObs === connected) return
    this.connectedToObs = connected
    this.emitter.emit('obsStatus', connected)
  }

  getDevice(deviceId: string) {
    return this.devices.get(deviceId)
  }

  getAllDevices() {
    return Array.from(this.devices.values())
  }

  setDeviceOnAir(deviceId: string, onAir: boolean) {
    const device = this.devices.get(deviceId)
    if (!device) return
    if (device.onAir === onAir) return
    device.onAir = onAir
    this.emitter.emit('deviceTally', deviceId, onAir)
  }

  on<EventName extends keyof StoreEvents>(event: EventName, listener: StoreEvents[EventName]) {
    this.emitter.on(event, listener as (...args: any[]) => void)
    return () => this.emitter.off(event, listener as (...args: any[]) => void)
  }
}
