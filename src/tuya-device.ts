import TuyAPI from 'tuyapi'
import type { MqttClient } from 'mqtt'
import type { DeviceConfig, TemplateEntry, HaEntityConfig } from './types'
import { sleep, isJsonString, calc } from './utils'

interface DpsValue {
  val: unknown
  updated: boolean
}

interface ColorState {
  h: number
  s: number
  b: number
}

export abstract class TuyaDevice {
  protected config: DeviceConfig
  protected mqttClient: MqttClient
  protected topicPrefix: string
  protected options: { id: string; key: string; ip?: string; version?: string; name?: string }
  protected device: TuyAPI
  protected dpsState: Record<number, DpsValue> = {}
  protected color: ColorState = { h: 0, s: 0, b: 0 }
  protected cmdColor: ColorState = { h: 0, s: 0, b: 0 }
  protected deviceTopics: Record<string, TemplateEntry> = {}
  protected connected = false
  protected reconnecting = false
  protected heartbeatsMissed = 0
  protected isRgbtwLight = false
  protected baseTopic: string
  protected deviceName: string
  protected readonly deviceId: string

  constructor(config: DeviceConfig, mqttClient: MqttClient, topicPrefix: string) {
    this.config = config
    this.mqttClient = mqttClient
    this.topicPrefix = topicPrefix
    this.deviceId = config.id

    this.options = { id: config.id, key: config.key }

    if (config.name) {
      this.options.name = config.name.toLowerCase().replace(/[\s+#/]/g, '_')
    }
    if (config.ip) {
      this.options.ip = config.ip
      this.options.version = config.version || '3.1'
    }

    this.deviceName = config.name || config.id
    this.baseTopic = `${topicPrefix}${this.options.name || config.id}/`

    this.device = new TuyAPI(JSON.parse(JSON.stringify(this.options)))

    this.device.on('data', (raw) => {
      if (raw && typeof raw === 'object') {
        const data = raw as { dps?: Record<string, unknown> }
        if (data.dps) {
          console.log('[tuya-mqtt] data from', this.options.id, JSON.stringify(data.dps))
          this.updateState(data.dps)
        }
      } else {
        const msg = raw as string
        if (msg && msg !== 'json obj data unvalid') {
          console.log('[tuya-mqtt] string from', this.options.id, msg.replace(/[^a-zA-Z0-9 ]/g, ''))
        }
      }
    })

    this.device.on('connected', async () => {
      await sleep(1)
      if (this.device.isConnected()) {
        console.log('[tuya-mqtt] connected to', this.toString())
        this.connected = true
        this.heartbeatsMissed = 0
        this.publishAvailability('online')
        this.init()
      }
    })

    this.device.on('disconnected', async () => {
      this.connected = false
      this.publishAvailability('offline')
      console.log('[tuya-mqtt] disconnected from', this.toString())
      await sleep(5)
      this.reconnect()
    })

    this.device.on('error', (err) => {
      console.error('[tuya-mqtt:error]', err)
      sleep(1).then(() => this.reconnect())
    })

    this.device.on('heartbeat', () => {
      this.heartbeatsMissed = 0
    })

    this.connectDevice()
    this.monitorHeartbeat()
  }

  protected abstract init(): Promise<void>

  protected abstract publishHaDiscovery(): void

  protected publishAvailability(status: string): void {
    this.mqttClient.publish(`homeassistant/sensor/${this.deviceId}/status`, status, { retain: true, qos: 1 })
  }

  protected publishHaConfig(
    entityName: string,
    component: string,
    stateTopic: string,
    commandTopic: string | undefined,
    entry: TemplateEntry,
  ): void {
    const configTopic = `homeassistant/${component}/${this.deviceId}/${entityName}/config`

    const payload: HaEntityConfig = {
      name: `${this.deviceName} ${entry.name || entityName}`,
      state_topic: stateTopic,
      unique_id: `${this.deviceId}_${entityName}`,
      device: {
        identifiers: [this.deviceId],
        name: this.deviceName,
        manufacturer: 'Tuya',
      },
    }

    if (commandTopic) payload.command_topic = commandTopic
    if (component === 'switch') {
      payload.payload_on = 'ON'
      payload.payload_off = 'OFF'
    }
    if (component === 'number') {
      if (entry.topicMin !== undefined) payload.min = entry.topicMin
      if (entry.topicMax !== undefined) payload.max = entry.topicMax
      payload.step = entry.type === 'float' ? 0.5 : 1
      payload.mode = 'box'
    }
    if (component === 'select' && entry.options) {
      payload.options = entry.options
    }

    this.mqttClient.publish(configTopic, JSON.stringify(payload), { retain: true, qos: 1 })
  }

  async getStates(): Promise<void> {
    this.connected = false
    for (const topicKey of Object.keys(this.deviceTopics)) {
      const key = this.deviceTopics[topicKey].key
      if (!this.dpsState[key]) {
        this.dpsState[key] = { val: undefined, updated: false }
      }
      try {
        const val = await this.device.get({ dps: key })
        this.dpsState[key] = { val, updated: true }
      } catch {
        console.error('[tuya-mqtt:error] Could not get DPS key', key)
      }
    }
    this.connected = true
    this.publishTopics()
  }

  updateState(dps: Record<string, unknown>): void {
    if (!dps) return

    for (const keyStr of Object.keys(dps)) {
      const key = Number(keyStr)
      const val = dps[keyStr]
      if (this.dpsState[key]?.val !== val) {
        this.dpsState[key] = { val, updated: true }
      }

      if (this.isRgbtwLight) {
        const dpsColorKey = this.config.dpsColor
        const dpsModeKey = this.config.dpsMode
        if (dpsColorKey && dpsColorKey === key) {
          this.updateColorState(val as string)
        } else if (dpsModeKey && dpsModeKey === key && this.config.dpsColor) {
          this.dpsState[this.config.dpsColor].updated = true
        }
      }
    }

    if (this.connected) this.publishTopics()
  }

  publishTopics(): void {
    if (!this.connected) return

    for (const topicKey of Object.keys(this.deviceTopics)) {
      const entry = this.deviceTopics[topicKey]
      const key = entry.key
      if (this.dpsState[key]?.updated) {
        const state = this.getTopicState(entry, this.dpsState[key].val)
        if (state !== null) {
          const haTopic = this.getHaStateTopic(topicKey, entry)
          this.mqttClient.publish(haTopic, state, { retain: true, qos: 1 })
          this.dpsState[key].updated = false
        }
      }
    }

    this.publishDpsTopics()
  }

  publishDpsTopics(): void {
    const data: Record<string, unknown> = {}
    for (const key of Object.keys(this.dpsState)) {
      if (this.dpsState[Number(key)]?.updated) {
        data[key] = this.dpsState[Number(key)].val
      }
    }

    if (Object.keys(data).length > 0) {
      this.mqttClient.publish(this.baseTopic + 'dps/state', JSON.stringify(data), { retain: false, qos: 1 })
    }
  }

  protected getHaStateTopic(entityName: string, entry: TemplateEntry): string {
    return `homeassistant/${this.getHaComponent(entry)}/${this.deviceId}/${entityName}/state`
  }

  protected getHaCommandTopic(entityName: string, entry: TemplateEntry): string | undefined {
    if (entry.type === 'float' || entry.type === 'int') {
      if (entry.topicMin === undefined && entry.topicMax === undefined) return undefined
    }
    if (entry.type === 'str' && !entry.options) return undefined
    if (entry.type === 'bool') {
      return `homeassistant/switch/${this.deviceId}/${entityName}/set`
    }
    return `homeassistant/${this.getHaComponent(entry)}/${this.deviceId}/${entityName}/set`
  }

  protected getHaComponent(entry: TemplateEntry): string {
    switch (entry.type) {
      case 'bool': return 'switch'
      case 'float':
      case 'int':
        return (entry.topicMin !== undefined || entry.topicMax !== undefined) ? 'number' : 'sensor'
      case 'str':
        return entry.options ? 'select' : 'sensor'
      default:
        return 'sensor'
    }
  }

  protected getTopicState(entry: TemplateEntry, value: unknown): string | null {
    if (value === undefined || value === null) return null

    switch (entry.type) {
      case 'bool':
        return value ? 'ON' : 'OFF'
      case 'int':
      case 'float':
        return this.parseNumberState(Number(value), entry)
      case 'hsb':
      case 'hsbhex': {
        const components = (entry.components || 'h,s,b').split(',')
        return components.map(c => {
          if (c === 's' && this.isRgbtwLight && this.config.dpsMode &&
              this.dpsState[this.config.dpsMode]?.val === 'white') {
            return '0'
          }
          return String(this.color[c as keyof ColorState])
        }).join(',')
      }
      case 'str':
        return String(value || '')
      default:
        return String(value)
    }
  }

  protected parseNumberState(value: number, entry: TemplateEntry): string | null {
    if (isNaN(value)) return null
    if (entry.stateMath) {
      value = entry.type === 'int'
        ? Math.round(calc(`${value}${entry.stateMath}`))
        : calc(`${value}${entry.stateMath}`)
    }
    return String(value)
  }

  processCommand(message: string, commandTopic: string): void {
    const parsed = isJsonString(message)
    const command = parsed ? JSON.parse(message) : message.toLowerCase()

    if (commandTopic === 'command' && command === 'get-states') {
      this.getStates()
    } else {
      this.processDeviceCommand(command, commandTopic)
    }
  }

  processDeviceCommand(command: unknown, commandTopic: string): void {
    const stateTopic = commandTopic.replace('/set', '/state')
    const entityName = Object.keys(this.deviceTopics).find(
      k => this.getHaStateTopic(k, this.deviceTopics[k]) === stateTopic ||
           (this.getHaCommandTopic(k, this.deviceTopics[k]) === commandTopic)
    )

    if (!entityName) {
      console.log('[tuya-mqtt:command] unknown topic', commandTopic)
      return
    }

    this.handleHaCommand(entityName, String(command))
  }

  handleHaCommand(entityName: string, message: string): void {
    const entry = this.deviceTopics[entityName]
    if (!entry) {
      console.log('[tuya-mqtt:command] unknown entity', entityName)
      return
    }
    this.sendTuyaCommand(message, entry)
  }

  sendTuyaCommand(message: string, entry: TemplateEntry): void {
    let setVal: string | number | boolean | '!!!INVALID!!!'

    switch (entry.type) {
      case 'bool': {
        const msg = message.toLowerCase()
        if (msg === 'toggle') {
          setVal = !Boolean(this.dpsState[entry.key]?.val)
        } else {
          setVal = msg === 'on' || msg === '1' || msg === 'true'
        }
        break
      }
      case 'int':
      case 'float':
        setVal = this.parseNumberCommand(message, entry)
        break
      case 'hsb':
        this.updateCommandColor(message, entry.components || 'h,s,b')
        setVal = this.parseTuyaHsbColor()
        break
      case 'hsbhex':
        this.updateCommandColor(message, entry.components || 'h,s,b')
        setVal = this.parseTuyaHsbHexColor()
        break
      default:
        setVal = message
    }

    if (setVal === '!!!INVALID!!!') {
      console.log('[tuya-mqtt:command] invalid value', message)
      return
    }

    this.set({ dps: entry.key, set: setVal })
  }

  protected parseNumberCommand(message: string, entry: TemplateEntry): number | '!!!INVALID!!!' {
    const value = Number(message)
    if (isNaN(value)) return '!!!INVALID!!!'

    let clamped = value
    if (entry.topicMin !== undefined && value < entry.topicMin) {
      clamped = entry.topicMin
    }
    if (entry.topicMax !== undefined && value > entry.topicMax) {
      clamped = entry.topicMax
    }

    if (entry.commandMath) {
      return entry.type === 'int'
        ? Math.round(calc(`${clamped}${entry.commandMath}`))
        : calc(`${clamped}${entry.commandMath}`)
    }

    return entry.type === 'int' ? Math.round(clamped) : clamped
  }

  processDpsCommand(message: string): void {
    const parsed = isJsonString(message)
    if (parsed) {
      const command = parsed as { dps?: number; set?: unknown; multiple?: boolean; data?: Record<string, unknown> }
      if (command.multiple && command.data) {
        for (const key of Object.keys(command.data)) {
          this.device.set({ dps: Number(key), set: command.data[key] as string | number | boolean })
        }
      } else if (command.dps !== undefined) {
        this.set(command as { dps: number; set: string | number | boolean })
      }
    } else {
      console.log('[tuya-mqtt:command] DPS topic requires JSON')
    }
  }

  processDpsKeyCommand(message: string, dpsKey: number): void {
    if (isJsonString(message)) {
      console.log('[tuya-mqtt:command] DPS key topics do not accept JSON')
    } else {
      this.set({ dps: dpsKey, set: this.parseDpsMessage(message) })
    }
  }

  parseDpsMessage(message: string): boolean | number | string {
    if (message === 'true') return true
    if (message === 'false') return false
    if (!isNaN(Number(message))) return Number(message)
    return message
  }

  set(command: { dps: number; set: string | number | boolean }): void {
    console.log('[tuya-mqtt] set', this.options.id, JSON.stringify(command))
    this.device.set(command).catch((err: Error) => console.error('[tuya-mqtt:error] set failed', err.message))
  }

  protected updateColorState(value: string): void {
    let h: number, s: number, b: number
    if (this.config.colorType === 'hsbhex') {
      const match = (value || '0000000000ffff').match(/^.{6}([0-9a-f]{4})([0-9a-f]{2})([0-9a-f]{2})$/i)
      h = parseInt(match?.[1] || '0', 16)
      s = Math.round(parseInt(match?.[2] || 'ff', 16) / 2.55)
      b = Math.round(parseInt(match?.[3] || 'ff', 16) / 2.55)
    } else {
      const match = (value || '000003e803e8').match(/^([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{4})$/i)
      h = parseInt(match?.[1] || '0', 16)
      s = Math.round(parseInt(match?.[2] || '3e8', 16) / 10)
      b = Math.round(parseInt(match?.[3] || '3e8', 16) / 10)
    }
    this.color = { h, s, b }
    if (!this.cmdColor) {
      this.cmdColor = { h, s, b }
    }
  }

  protected updateCommandColor(value: string, components: string): void {
    const comps = components.split(',')
    const values = value.split(',')
    for (let i = 0; i < comps.length; i++) {
      const c = comps[i]
      if (c === 'h' || c === 's' || c === 'b') {
        this.cmdColor[c] = Math.round(Number(values[i]))
      }
    }
  }

  protected parseTuyaHsbColor(): string {
    const { h, s, b } = this.cmdColor
    return h.toString(16).padStart(4, '0') +
      (10 * s).toString(16).padStart(4, '0') +
      (10 * b).toString(16).padStart(4, '0')
  }

  protected parseTuyaHsbHexColor(): string {
    const { h, s, b } = this.cmdColor
    const hsb = h.toString(16).padStart(4, '0') +
      Math.round(2.55 * s).toString(16).padStart(2, '0') +
      Math.round(2.55 * b).toString(16).padStart(2, '0')

    const hNorm = h / 60
    const sNorm = s / 100
    const bNorm = b * 2.55
    const i = Math.floor(hNorm)
    const f = hNorm - i
    const p = bNorm * (1 - sNorm)
    const q = bNorm * (1 - sNorm * f)
    const t = bNorm * (1 - sNorm * (1 - f))

    let rgb: number[]
    switch (i % 6) {
      case 0: rgb = [bNorm, t, p]; break
      case 1: rgb = [q, bNorm, p]; break
      case 2: rgb = [p, bNorm, t]; break
      case 3: rgb = [p, q, bNorm]; break
      case 4: rgb = [t, p, bNorm]; break
      case 5: rgb = [bNorm, p, q]; break
      default: rgb = [0, 0, 0]
    }

    const hex = rgb.map(c => Math.round(c).toString(16).padStart(2, '0')).join('')
    return hex + hsb
  }

  protected connectDevice(): void {
    console.log('[tuya-mqtt] searching for', this.options.id)
    this.device.find().then(() => {
      console.log('[tuya-mqtt] found', this.options.id)
      this.device.connect().catch((error: Error) => {
        console.error('[tuya-mqtt:error]', error.message)
        this.reconnect()
      })
    }).catch(async (error: Error) => {
      console.error('[tuya-mqtt:error]', error.message)
      console.log('[tuya-mqtt] retry in 60s')
      await sleep(60)
      this.connectDevice()
    })
  }

  protected async reconnect(): Promise<void> {
    if (!this.reconnecting) {
      this.reconnecting = true
      console.log('[tuya-mqtt] reconnecting', this.options.id)
      await sleep(10)
      this.connectDevice()
      this.reconnecting = false
    }
  }

  disconnect(): void {
    this.device.disconnect()
  }

  republish(): void {
    const status = this.device.isConnected() ? 'online' : 'offline'
    this.publishAvailability(status)
    if (this.device.isConnected()) {
      this.publishHaDiscovery()
    }
  }

  protected monitorHeartbeat(): void {
    setInterval(async () => {
      if (this.connected) {
        if (this.heartbeatsMissed > 3) {
          console.error('[tuya-mqtt:error]', this.options.id, 'missed 3 heartbeats, reconnecting')
          this.device.disconnect()
          await sleep(1)
          this.connectDevice()
        } else if (this.heartbeatsMissed > 0) {
          console.log('[tuya-mqtt]', this.options.id, 'missed', this.heartbeatsMissed, 'heartbeat(s)')
        }
        this.heartbeatsMissed++
      }
    }, 10000)
  }

  toString(): string {
    return this.config.name + ' (' + (this.config.ip ? this.config.ip + ', ' : '') + this.options.id + ')'
  }
}
