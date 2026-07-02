# tuya-mqtt

Bridge for controlling Tuya IoT devices locally via MQTT with Home Assistant MQTT Discovery.

## Features

- Connects to Tuya devices locally using the TuyAPI library (no cloud dependency)
- Automatic Home Assistant MQTT Discovery — devices appear in HA automatically
- Template engine for mapping Tuya DPS values to HA entities (switch, sensor, number, select)
- Supports math transforms for DPS value conversion
- MQTT configuration via environment variables (12-factor app style)

## Prerequisites

- Node.js 20+
- MQTT broker (e.g., Mosquitto)
- Home Assistant with MQTT integration
- Device ID and local key for each Tuya device (see [TuyAPI setup](https://github.com/codetheweb/tuyapi/blob/master/docs/SETUP.md))

## Installation

```bash
git clone https://github.com/nikoraes/tuya-mqtt
cd tuya-mqtt
npm install
npm run build
```

## Configuration

### MQTT Connection

Configure via environment variables (or copy `.env.sample` to `.env`):

| Variable                | Default          | Description                           |
| ----------------------- | ---------------- | ------------------------------------- |
| `MQTT_HOST`             | `localhost`      | MQTT broker host                      |
| `MQTT_PORT`             | `1883`           | MQTT broker port                      |
| `MQTT_USERNAME`         | (empty)          | MQTT username                         |
| `MQTT_PASSWORD`         | (empty)          | MQTT password                         |
| `MQTT_DISCOVERY_PREFIX` | `homeassistant`  | Home Assistant discovery topic prefix |
| `DEVICES_CONFIG_PATH`   | `./devices.conf` | Path to devices configuration file    |

### Device Configuration

Create a `devices.conf` file (strict JSON, **do not commit to git**):

```json
[
  {
    "name": "Pool Heater",
    "id": "***",
    "key": "***",
    "template": {
      "power": { "key": 1, "type": "bool" },
      "current_temperature": { "key": 102, "type": "float" },
      "set_temperature": {
        "key": 106,
        "type": "float",
        "topicMin": 18,
        "topicMax": 45
      },
      "operating_mode": { "key": 105, "type": "str" },
      "boost": { "key": 117, "type": "bool" }
    }
  }
]
```

The template engine maps each entry to a Home Assistant MQTT entity:

| Template Type          | HA Component | Description                 |
| ---------------------- | ------------ | --------------------------- |
| `bool`                 | `switch`     | ON/OFF control              |
| `float` (no range)     | `sensor`     | Read-only floating point    |
| `float` (with min/max) | `number`     | Settable number with range  |
| `int` (no range)       | `sensor`     | Read-only integer           |
| `int` (with min/max)   | `number`     | Settable integer with range |
| `str`                  | `sensor`     | String value display        |
| `str` (with options)   | `select`     | Dropdown selection          |

### Climate Entity (Heat Pump / Thermostat)

For heat pumps, pool heaters, or any HVAC device, you can add a **climate entity** that presents a unified thermostat dial in Home Assistant. This publishes an MQTT climate discovery config alongside the individual template entities.

Add a `climate` section to your device config:

```json
{
  "name": "Pool Heater",
  "id": "***",
  "key": "***",
  "ip": "192.168.1.55",
  "version": "3.3",
  "template": {
    "power": { "key": 1, "type": "bool" },
    "current_temperature": { "key": 102, "type": "float" },
    "set_temperature": { "key": 106, "type": "float", "topicMin": 18, "topicMax": 45 },
    "operating_mode": { "key": 105, "type": "str" },
    "boost": { "key": 117, "type": "bool" }
  },
  "climate": {
    "name": "Pool Heat Pump",
    "modes": ["off", "heat"],
    "mode_map": { "heat": "warm" },
    "min_temp": 18,
    "max_temp": 45,
    "temp_step": 0.5,
    "entities": {
      "current_temperature": "current_temperature",
      "target_temperature": "set_temperature",
      "power": "power",
      "mode": "operating_mode",
      "preset_modes": { "boost": "boost" }
    }
  }
}
```

**Climate config options:**

| Option | Type | Description |
| ------ | ---- | ----------- |
| `name` | string | Display name for the climate entity (defaults to device name) |
| `modes` | string[] | Supported HVAC modes, e.g. `["off", "heat"]` |
| `mode_map` | object | Maps HA mode names to Tuya operating_mode values, e.g. `{ "heat": "warm" }` |
| `min_temp` | number | Minimum target temperature |
| `max_temp` | number | Maximum target temperature |
| `temp_step` | number | Temperature step (default: 1.0) |
| `entities.current_temperature` | string | Template entity name for current temperature sensor |
| `entities.target_temperature` | string | Template entity name for set temperature number |
| `entities.power` | string | Template entity name for power switch |
| `entities.mode` | string | Template entity name for operating mode sensor (optional) |
| `entities.preset_modes` | object | Map of HA preset names to template entity names, e.g. `{ "boost": "boost" }` |

The climate entity reads `current_temperature` and `target_temperature` from the same MQTT topics as the template entities. HVAC mode commands are translated: `off` sets the power switch off, `heat` sets power on and optionally sets the operating mode via `mode_map`.

### Template Options

| Option        | Type     | Description                                                               |
| ------------- | -------- | ------------------------------------------------------------------------- |
| `key`         | number   | Tuya DPS key                                                              |
| `type`        | string   | `bool`, `int`, `float`, `str`, `hsb`, `hsbhex`                            |
| `topicMin`    | number   | Minimum command value                                                     |
| `topicMax`    | number   | Maximum command value                                                     |
| `stateMath`   | string   | Math expression applied to DPS value before publishing (e.g., `/10`)      |
| `commandMath` | string   | Math expression applied to command value before setting DPS (e.g., `*10`) |
| `options`     | string[] | Enum values for `str` type (enables `select` entity)                      |

## Usage

```bash
# Development
npm run dev

# Production
npm run build && npm start

# Enable debug logging
DEBUG=tuya-mqtt:* npm start
```

## Docker

```bash
docker build -t tuya-mqtt .
docker run -d \
  --name tuya-mqtt \
  -e MQTT_HOST=mqtt.example.com \
  -e MQTT_PORT=1883 \
  -e MQTT_USERNAME=user \
  -e MQTT_PASSWORD=pass \
  -v $(pwd)/devices.conf:/app/devices.conf \
  tuya-mqtt
```

## Kubernetes Deployment

Create a ConfigMap with your device configuration:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: tuya-mqtt-config
  namespace: tuya-mqtt
data:
  devices.conf: |
    [
      {
        name: 'Pool Heater',
        id: '627786609c9c1f448791',
        key: '|*7(%WY[qk}_L/<&',
        template: { ... }
      }
    ]
```

See the `deploy/` directory for example Kubernetes manifests.

## Merging Device Configs

When you acquire new device keys via `tuya-cli wizard`, save the output to `new-devices.conf` and run:

```bash
npm run merge-devices
```

This will update `devices.conf` with new/updated devices while preserving your templates.

## License

MIT
