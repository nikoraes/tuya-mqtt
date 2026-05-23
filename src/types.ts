export interface TemplateEntry {
  key: number
  type: 'bool' | 'int' | 'float' | 'str' | 'hsb' | 'hsbhex'
  name?: string
  topicMin?: number
  topicMax?: number
  stateMath?: string
  commandMath?: string
  components?: string
  options?: string[]
}

export interface DeviceConfig {
  name?: string
  id: string
  key: string
  ip?: string
  version?: string
  type?: string
  template?: Record<string, TemplateEntry>
  allowMerge?: boolean
  dpsPower?: number
  dpsBrightness?: number
  brightnessScale?: number
  dpsMode?: number
  dpsWhiteValue?: number
  whiteValueScale?: number
  dpsColorTemp?: number
  minColorTemp?: number
  maxColorTemp?: number
  colorTempScale?: number
  dpsColor?: number
  colorType?: string
}

export interface HaEntityConfig {
  name: string
  state_topic: string
  command_topic?: string
  unique_id: string
  device: {
    identifiers: string[]
    name: string
    manufacturer: string
    model?: string
  }
  unit_of_measurement?: string
  device_class?: string
  min?: number
  max?: number
  step?: number
  mode?: string
  options?: string[]
  payload_on?: string
  payload_off?: string
  availability_topic?: string
  payload_available?: string
  payload_not_available?: string
  [key: string]: unknown
}
