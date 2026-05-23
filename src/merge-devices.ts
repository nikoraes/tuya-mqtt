import fs from 'fs'
import type { DeviceConfig } from './types'

function pad(n: number): string {
  return n.toString().padStart(2, '0')
}

function formatDevices(devices: DeviceConfig[]): string {
  return JSON.stringify(devices, null, '  ')
}

function main(): void {
  const now = new Date()
  const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const configFile = 'devices.conf'
  const backupFile = `${configFile}_${dateStr}.bak`
  const newConfigFile = `new-${configFile}`

  let configDevices: DeviceConfig[]
  let configNewDevices: DeviceConfig[]

  try {
    console.log('Loading', newConfigFile, '...')
    configNewDevices = JSON.parse(fs.readFileSync('./' + newConfigFile, 'utf8'))
  } catch (e) {
    console.error('Could not parse', newConfigFile)
    console.error(e)
    process.exit(1)
  }

  try {
    console.log('Loading', configFile, '...')
    configDevices = JSON.parse(fs.readFileSync('./' + configFile, 'utf8'))
  } catch (e) {
    console.error('Could not parse', configFile)
    console.error(e)
    process.exit(1)
  }

  try {
    console.log('Backing up to', backupFile, '...')
    fs.copyFileSync('./' + configFile, './' + backupFile)
  } catch (e) {
    console.error('Could not backup', configFile)
    console.error(e)
    process.exit(1)
  }

  const dict: Record<string, DeviceConfig> = {}
  for (const dev of configDevices) {
    dict[dev.id] = dev
  }

  for (const newDev of configNewDevices) {
    const existing = dict[newDev.id]
    if (!existing) {
      console.log('Adding device:', newDev.name, `(${newDev.id})`)
      configDevices.push(newDev)
      dict[newDev.id] = newDev
      continue
    }

    if (existing.allowMerge === false) continue

    if (existing.name !== newDev.name) {
      console.log('Updating name:', existing.name, '->', newDev.name)
      existing.name = newDev.name
    }
    if (existing.key !== newDev.key) {
      console.log('Updating key for:', existing.name)
      existing.key = newDev.key
    }
  }

  configDevices.sort((a, b) => (a.name || '').localeCompare(b.name || ''))

  try {
    fs.writeFileSync('./' + configFile, formatDevices(configDevices), { encoding: 'utf8' })
    console.log('Saved', configFile)
  } catch (e) {
    console.error('Could not write', configFile)
    console.error(e)
    process.exit(1)
  }

  console.log('Done!')
}

main()
