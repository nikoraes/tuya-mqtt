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
  /** Optional HA device_class for the sensor (e.g. "power"). */
  device_class?: string
  /** Optional unit_of_measurement for the sensor (e.g. "W"). */
  unit_of_measurement?: string
}

export interface ClimateEntityRefs {
  /** Template entity name for current temperature (e.g. "current_temperature") */
  current_temperature: string
  /** Template entity name for target temperature (e.g. "set_temperature") */
  target_temperature: string
  /** Template entity name for power switch (e.g. "power") */
  power: string
  /** Template entity name for operating mode string (e.g. "operating_mode") */
  mode?: string
  /** Map HA preset names to template entity names (e.g. { "boost": "boost" }) */
  preset_modes?: Record<string, string>
}

export interface ClimateConfig {
  /** Display name for the climate entity (defaults to device name) */
  name?: string
  /** Supported HVAC modes */
  modes: string[]
  /** Map HA HVAC mode names to Tuya operating_mode values (e.g. { "heat": "warm" }) */
  mode_map?: Record<string, string>
  /** Template entity references */
  entities: ClimateEntityRefs
  min_temp?: number
  max_temp?: number
  temp_step?: number
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
  /** Optional climate entity configuration. When set, a unified climate entity is published alongside template entities. */
  climate?: ClimateConfig
}

export interface HaEntityConfig {
  name: string
  state_topic?: string
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
