# Smart Cone — IoT Cone Knockover Detection

## Problem

Construction work zones have no way to detect when safety cones are knocked over or hit. Breaches go unnoticed, putting workers at risk and leaving zero documentation for incidents. Navigation apps like Waze only learn about closures when a driver manually reports it.

## Solution

An ESP32-powered traffic cone that detects impact/knockover in real-time, sends push notifications, updates a live fleet dashboard, and auto-generates navigation system hazard feeds (Waze CIFS).

## Demo Flow

1. Place cones at a site using Setup Mode (phone GPS captures locations)
2. Knock a cone over → buzzer sounds, LED turns red
3. Phone buzzes with Ntfy push notification
4. Dashboard map marker goes red in real-time
5. CIFS feed auto-updates — ready for Waze/Google Maps integration
6. Stand cone back up → recovery event, marker returns to green

---

## Architecture

```
ESP32 + MPU6050 + Buzzer + LED
    │
    ├──► WiFi (WiFiManager captive portal)
    │
    └──► MQTT over TLS (HiveMQ Cloud)
            │
            ├──► smartcones/{id}/event     → impact, knockover, recovery
            ├──► smartcones/{id}/status    → online/offline (LWT)
            ├──► smartcones/{id}/telemetry → RSSI, uptime, heap, tilt
            └──► smartcones/{id}/command   → reset, identify
                    │
                    ├──► Ntfy.sh ──► Phone push notification
                    │
                    └──► Cloudflare Workers Dashboard
                            ├── Fleet Map (Leaflet.js)
                            ├── Stats Bar (cones, online, alerts)
                            ├── Event Log
                            ├── Cone Detail Panel + Health
                            ├── Public Hazard Map (/hazards.html)
                            ├── CIFS Feed Viewer (/cifs-viewer.html)
                            ├── CIFS XML (/api/feed/cifs.xml)
                            └── CIFS JSON (/api/feed/cifs.json)
```

---

## Features

### Firmware (ESP32)

- **Impact detection** — acceleration spike > 3g triggers alert
- **Knockover detection** — tilt > 45° sustained for 1 second
- **Recovery detection** — publishes recovery event when cone returns upright
- **WiFiManager** — captive portal for WiFi + Cone ID setup (no hardcoded credentials)
- **Dynamic Cone ID** — configurable per device, stored in ESP32 Preferences
- **MQTT over TLS** — publishes events, status (with LWT), and telemetry to HiveMQ Cloud
- **Ntfy push notifications** — HTTP POST to ntfy.sh on impact/knockover/intrusion
- **Health telemetry** — publishes WiFi RSSI, uptime, free heap, tilt every 30s
- **MQTT commands** — listens for reset (wipe config + restart) and identify (flash LED)
- **LED status** — red = initializing/offline, green = connected & ready, red = alert
- **Buzzer** — continuous buzz on impact/knockover, 3 quick beeps on intrusion
- **Intrusion detection** — PIR sensor support (HC-SR501, code ready, commented out until wired)

### Dashboard (Cloudflare Workers + Hono)

- **Fleet Map** — Leaflet.js map with colored cone markers (green/red/orange/gray)
- **Setup Mode** — place cones using phone GPS, stored in Cloudflare KV
- **Cone Simulator** — generates 4 fake cones near real cone for demo
- **Stats Bar** — Total Cones, Online, Alerts Today, Last Incident
- **Latest Alert Card** — shows last event with state, cone ID, timestamp
- **Event Log** — last 50 events with type badges and icons (Font Awesome)
- **Detail Panel** — slide-in panel on marker click: state, coordinates, health, event history
- **Fleet List** — click Total Cones stat to see all cones, click row to pan map
- **Remove/Reset** — remove cone from dashboard + send MQTT reset to device
- **Identify** — flash LED on specific cone from dashboard
- **Health Monitoring** — WiFi signal, uptime, free memory, current tilt (color-coded)
- **Public Hazard Map** — read-only map at `/hazards.html` for drivers/public
- **CIFS XML Feed** — Waze-compatible road closure feed at `/api/feed/cifs.xml`
- **CIFS JSON Feed** — same data in JSON at `/api/feed/cifs.json`
- **CIFS Feed Viewer** — polished page explaining Waze integration with copy buttons
- **Shortcut Pills** — quick links to hazard map, CIFS viewer, feeds
- **Auto-deploy** — GitHub Actions deploys on push to `dashboard/**`

---

## Hardware

### Bill of Materials

| # | Component | Est. Price (MYR) | GPIO | Links |
|---|-----------|-------------------|------|-------|
| 1 | ESP32 dev board (CH340, USB-C) | RM 15 | — | [MakerHub](https://shopee.com.my/makerhub) |
| 2 | MPU6050 module (GY-521) | RM 10 | SDA=21, SCL=22 | [MakerHub](https://shopee.com.my/makerhub) |
| 3 | Active buzzer module (5V) | RM 3 | GPIO 19 | [MakerHub](https://shopee.com.my/makerhub) |
| 4 | KY-016 RGB LED | RM 3 | R=16, G=17 | [MakerHub](https://shopee.com.my/makerhub) |
| 5 | HC-SR501 PIR sensor | RM 3 | GPIO 23 | [MakerHub](https://shopee.com.my/makerhub) |
| 6 | WS2812B 4x4 LED matrix (x2) | RM 10-16 | GPIO 18 | [MakerHub](https://shopee.com.my/makerhub) |
| 7 | MB102 breadboard power supply | RM 7 | — | [MakerHub](https://shopee.com.my/makerhub) |
| 8 | USB to DC barrel jack cable | RM 3 | — | — |
| 9 | Breadboard (400 holes, x2) | RM 10 | — | [MakerHub](https://shopee.com.my/makerhub) |
| 10 | Jumper wires (M-M + M-F) | RM 8 | — | [MakerHub](https://shopee.com.my/makerhub) |
| 11 | USB-C data cable | RM 3 | — | — |
| 12 | Traffic cone (30") | RM 25 | — | — |
| | **Total** | **~RM 100-115** | | |

### Pin Map

| GPIO | Function | Component |
|------|----------|-----------|
| 21 | SDA (I2C) | MPU6050 |
| 22 | SCL (I2C) | MPU6050 |
| 16 | LED Red | KY-016 |
| 17 | LED Green | KY-016 |
| 18 | NeoPixel Data | WS2812B (future) |
| 19 | Buzzer | Active buzzer |
| 23 | PIR Motion | HC-SR501 (future) |

### Power Setup

- **ESP32** — powered via USB-C from laptop (flashing + serial monitor)
- **MB102** — powered via USB power bank → DC barrel jack
- **MB102 outputs** — 5V rail for buzzer, WS2812B, PIR sensor
- Two 400-hole breadboards joined (center rails removed), ESP32 straddles both

---

## Project Structure

```
syuk/
├── firmware/
│   └── smart_cone/
│       ├── smart_cone.ino     # Main sketch — state machine, sensor loop
│       ├── config.h           # Pin defs, thresholds, MQTT topics
│       ├── connectivity.h     # WiFiManager, MQTT, Ntfy, telemetry, commands
│       └── secrets.h          # Generated from .env — NEVER commit
├── dashboard/
│   ├── src/
│   │   └── index.ts           # Hono app — /api/config, /api/cones, /api/hazards, CIFS feeds
│   ├── public/
│   │   ├── index.html         # Main dashboard
│   │   ├── app.js             # MQTT client, map, fleet list, detail panel, simulator
│   │   ├── style.css          # Dark theme styles
│   │   ├── hazards.html       # Public hazard map (read-only)
│   │   └── cifs-viewer.html   # CIFS feed viewer with copy + instructions
│   ├── wrangler.toml          # Cloudflare Workers config + KV binding
│   └── package.json           # Hono, wrangler deps
├── scripts/
│   └── gen_secrets.sh         # Generates secrets.h from .env
├── .github/
│   └── workflows/
│       └── deploy-dashboard.yml  # Auto-deploy on push
├── CLAUDE.md                  # Project instructions for Claude Code
├── AGENTS.md                  # bd (beads) issue tracking workflow
└── .env                       # MQTT + Ntfy + CF credentials (gitignored)
```

---

## MQTT Topics

| Topic | Direction | Payload | Description |
|-------|-----------|---------|-------------|
| `smartcones/{id}/event` | ESP32 → Cloud | `{"cone_id","event","accel_g","tilt_deg","uptime_s"}` | Impact, knockover, recovery, intrusion |
| `smartcones/{id}/status` | ESP32 → Cloud | `{"status":"online\|offline"}` | Online on connect, offline via LWT |
| `smartcones/{id}/telemetry` | ESP32 → Cloud | `{"cone_id","rssi","uptime_s","free_heap","tilt_deg"}` | Health data every 30s |
| `smartcones/{id}/command` | Cloud → ESP32 | `{"action":"reset\|identify"}` | Remote reset or LED identify |

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/config` | MQTT broker credentials for dashboard |
| GET | `/api/cones` | List all cone locations from KV |
| POST | `/api/cones` | Create/update cone location |
| DELETE | `/api/cones/:id` | Remove a cone |
| GET | `/api/hazards` | JSON hazard zones from cone positions |
| GET | `/api/feed/cifs.xml` | Waze-compatible CIFS XML feed |
| GET | `/api/feed/cifs.json` | CIFS data in JSON format |

---

## Detection Logic

| Event | Trigger | LED | Buzzer |
|-------|---------|-----|--------|
| Impact | Acceleration > 3g | Red | 2s continuous |
| Knockover | Tilt > 45° for 1s | Red | 2s continuous |
| Recovery | Tilt < 30° after knockover | Green | — |
| Intrusion | PIR motion detected | — | 3 quick beeps |

---

## Deployment

### Firmware

```bash
# Generate secrets from .env
bash scripts/gen_secrets.sh

# Compile
arduino-cli compile --fqbn esp32:esp32:esp32 firmware/smart_cone/

# Flash
arduino-cli upload --fqbn esp32:esp32:esp32 --port /dev/ttyUSB0 firmware/smart_cone/

# Monitor
arduino-cli monitor --port /dev/ttyUSB0 --config baudrate=115200
```

### Dashboard (Cloudflare Workers)

```bash
cd dashboard

# Local dev
echo "MQTT_BROKER_WSS=wss://xxx.hivemq.cloud:8884/mqtt" > .dev.vars
echo "MQTT_USER=xxx" >> .dev.vars
echo "MQTT_PASSWORD=xxx" >> .dev.vars
npx wrangler dev

# Production deploy (first time)
npx wrangler kv namespace create CONE_LOCATIONS
# Update wrangler.toml with KV namespace ID
npx wrangler secret put MQTT_BROKER_WSS
npx wrangler secret put MQTT_USER
npx wrangler secret put MQTT_PASSWORD
npx wrangler deploy

# Subsequent deploys — automatic via GitHub Actions on push to dashboard/**
```

### WiFi Setup (per cone)

1. Power on ESP32 → opens "SmartCone-Setup" WiFi AP
2. Connect from phone → captive portal appears
3. Enter WiFi credentials + Cone ID (e.g. "cone-002")
4. ESP32 connects, starts publishing to MQTT
5. On dashboard, use Setup Mode to place cone at GPS location

---

## Credentials

| File | Contains | Committed? |
|------|----------|------------|
| `.env` | MQTT, Ntfy, CF credentials | No (gitignored) |
| `secrets.h` | Generated from .env | No (gitignored) |
| `.dev.vars` | Dashboard local dev MQTT creds | No (gitignored) |
| GitHub Secrets | CF_ACCOUNT_ID, CF_TOKEN | N/A (GitHub) |
| Wrangler Secrets | MQTT_BROKER_WSS, MQTT_USER, MQTT_PASSWORD | N/A (Cloudflare) |

---

## Libraries

### Firmware (Arduino)
- Adafruit MPU6050
- Adafruit Unified Sensor
- WiFiManager
- PubSubClient
- ArduinoJson
- Preferences (ESP32 built-in)

### Dashboard
- Hono (Cloudflare Workers framework)
- Leaflet.js (maps)
- MQTT.js (WebSocket MQTT client)
- Font Awesome 6 (icons)

---

## Issue Tracking

Uses `bd` (beads) for task management. See `AGENTS.md` for workflow.

```bash
bd ready          # Find available work
bd show <id>      # View issue details
bd update <id> --claim  # Claim work
bd close <id>     # Complete work
```

---

## References

- [ESP32 + MPU6050 Wiring Guide — Random Nerd Tutorials](https://randomnerdtutorials.com/esp32-mpu-6050-accelerometer-gyroscope-arduino/)
- [ESP32 Pinout Reference — Random Nerd Tutorials](https://randomnerdtutorials.com/esp32-pinout-reference-gpios/)
- [Waze CIFS Road Closure Specification](https://developers.google.com/waze/data-feed/road-closure-information)
- [HiveMQ Cloud — Free MQTT Broker](https://www.hivemq.com/cloud/)
- [Ntfy.sh — Push Notifications](https://ntfy.sh)
- [Hono — Cloudflare Workers Framework](https://hono.dev)
- [Leaflet.js — Interactive Maps](https://leafletjs.com)

---

&copy; Smart Cone 2026. All Rights Reserved.
