import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'
import mqtt from 'mqtt'
import type { DeviceConfig } from './types'
import { GenericDevice } from './generic-device'
import { sleep } from './utils'

dotenv.config()

const devices: GenericDevice[] = []

function shutdown(exitCode?: number): void {
  for (const device of devices) {
    device.disconnect()
  }
  if (exitCode !== undefined) {
    console.log('[tuya-mqtt] exit', exitCode)
  }
  sleep(1).then(() => process.exit(exitCode ?? 0))
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
process.on('uncaughtException', (err) => {
  console.error('[tuya-mqtt:error]', err)
  shutdown(1)
})

function loadDevices(): DeviceConfig[] {
  const configPath = process.env.DEVICES_CONFIG_PATH || './devices.conf'
  try {
    const content = fs.readFileSync(path.resolve(configPath), 'utf8')
    const parsed: DeviceConfig[] = JSON.parse(content)
    if (!Array.isArray(parsed) || parsed.length === 0) {
      console.error('[tuya-mqtt] no devices in', configPath)
      process.exit(1)
    }
    return parsed
  } catch (e) {
    console.error('[tuya-mqtt] failed to load', process.env.DEVICES_CONFIG_PATH || './devices.conf')
    console.error(e)
    process.exit(1)
  }
}

let republishTimer: ReturnType<typeof setTimeout> | null = null

async function onHaRestart(): Promise<void> {
  for (let i = 0; i < 2; i++) {
    console.log('[tuya-mqtt] re-publishing in 30s')
    await sleep(30)
    for (const device of devices) {
      device.republish()
    }
    await sleep(2)
  }
}

function main(): void {
  const mqttHost = process.env.MQTT_HOST || 'localhost'
  const mqttPort = Number(process.env.MQTT_PORT) || 1883
  const mqttUser = process.env.MQTT_USERNAME || undefined
  const mqttPass = process.env.MQTT_PASSWORD || undefined
  const topicPrefix = process.env.MQTT_DISCOVERY_PREFIX || 'homeassistant'

  const deviceConfigs = loadDevices()

  const client = mqtt.connect({ host: mqttHost, port: mqttPort, username: mqttUser, password: mqttPass, protocol: mqttPort === 8883 ? 'mqtts' : 'mqtt' })

  console.log(`[tuya-mqtt] connecting to ${mqttHost}:${mqttPort} (protocol: ${mqttPort === 8883 ? 'mqtts' : 'mqtt'}, username: ${mqttUser ? '✓' : '✗'})`)

  client.on('connect', () => {
    console.log('[tuya-mqtt] connected to MQTT')
    client.subscribe(topicPrefix + '/#')
    client.subscribe('homeassistant/status')

    for (const config of deviceConfigs) {
      devices.push(new GenericDevice(config, client, topicPrefix))
    }
  })

  client.on('reconnect', () => {
    console.log('[tuya-mqtt] MQTT reconnecting...')
  })

  client.on('error', (error) => {
    console.error('[tuya-mqtt:error] MQTT', error.message)
  })

  client.on('message', (topic, buffer) => {
    try {
      const message = buffer.toString()
      if (topic === 'homeassistant/status') {
        if (message === 'online') {
          if (republishTimer) clearTimeout(republishTimer)
          republishTimer = setTimeout(onHaRestart, 1000)
        }
        return
      }

      for (const device of devices) {
        device.processMqttMessage(topic, message)
      }
    } catch (e) {
      console.error('[tuya-mqtt:error]', e)
    }
  })
}

main()
