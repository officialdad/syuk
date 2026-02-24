# Smart Cone — IoT Competition Project

## Problem

Construction work zones have no way to detect when safety cones are knocked over or hit. Breaches go unnoticed, putting workers at risk and leaving zero documentation for incidents.

## Solution

A cone embedded with a sensor that detects impact/knockover and instantly sends a push notification + updates a live dashboard.

## Demo Flow

1. Knock the cone over
2. Phone buzzes with an alert
3. Dashboard goes red in real-time

---

## Hardware

### Essential

| # | Component | Est. Price (MYR) | Links |
|---|-----------|-------------------|-------|
| 1 | ESP32 dev board (CH340, Micro USB) | RM 8 - RM 40 | <a href="https://shopee.com.my/NodeMCU-ESP32-Wi-Fi-Bluetooth-Development-Board-CH340-CP2012-For-IOT-Project-i.1165814930.22789260417" target="_blank">MakerHub</a> |
| 2 | MPU6050 module (GY-521) | RM 9 - RM 16 | <a href="https://shopee.com.my/GY-521-Gyroscope-Accelerometer-Module-MPU6050-MPU-6050-Motion-Measurement-Drone-Robotic-Application-i.1165814930.25564691626" target="_blank">MakerHub</a> |
| 3 | Jumper wires (M-M, 20cm, 40pcs pack) | RM 2 - RM 5 | <a href="https://shopee.com.my/40pcs-Dupont-Wire-10cm-20cm-30cm-for-Breadboard-DIY-Experiment-Jumper-Wire-Breadboard-wire-i.1165814930.24676987244" target="_blank">MakerHub</a> |
| 4 | Jumper wires (M-F, 30cm, 40pcs pack) | RM 2 - RM 5 | <a href="https://shopee.com.my/40pcs-Dupont-Wire-10cm-20cm-30cm-for-Breadboard-DIY-Experiment-Jumper-Wire-Breadboard-wire-i.1165814930.24676987244" target="_blank">MakerHub</a> |
| 5 | Data cable (Type-A to Micro USB, 0.5m-1m) | RM 2 - RM 5 | <a href="https://shopee.com.my/Data-Cable-Type-A-Type-C-MicroUSB-Type-B-0.5m-1m-30cm-0.3m-100cm-Data-Transfer-Upload-Code-i.1165814930.29671198885" target="_blank">MakerHub</a> |
| 6 | Rechargeable AA batteries | RM 8 - RM 15 | <a href="https://shopee.com.my/Rechargeable-AA-Battery-1.2V-NiMH-High-Capacity-2000mAh-3000mAh-Long-Life-Battery-for-Electronics-DIY-Projects-i.1165814930.29534820333" target="_blank">MakerHub</a> |
| 7 | AA battery holder (3-slot) | RM 2 - RM 5 | <a href="https://makerhub.my/shop/electrical/aa-battery-holder-with-cover-on-off-switch-2-3-4-slots-battery-aa-holder-red-black-wire/" target="_blank">MakerHub</a> |
| 8 | Soldering iron + solder | RM 15 - RM 30 |
| 9 | Traffic cone (30") | RM 20 - RM 30 | <a href="https://shopee.com.my/30-inch-Safety-Traffic-Pvc-Cone-Kon-Keselamatan-Jalan-Raya-30inci''(READY-STOCK)-i.195518124.7007655240" target="_blank">Shopee</a> |
| 10 | Breadboard (400 holes) | RM 5 - RM 12 | <a href="https://shopee.com.my/MB102-Breadboard-170-400-830-Holes-Breadboard-Donut-Board-Arduino-Prototype-Multi-Color-i.1165814930.25477002583" target="_blank">MakerHub</a> |

### Optional

| Component | Est. Price (MYR) | Why | Links |
|-----------|-------------------|-----|-------|
| LED module (KY-016 RGB, x1) | RM 1 - RM 5 | Green = upright, red = knocked over | <a href="https://shopee.com.my/RGB-LED-Module-Electronic-Component-KY-016-Tri-Color-i.1165814930.27823191316" target="_blank">MakerHub</a> |
| Active buzzer module (x1) | RM 2 - RM 5 | Beeps on impact, no tone code needed | <a href="https://shopee.com.my/Buzzer-Active-Passive-Buzzer-5V-Electronic-Sound-Alarm-Module-Tone-Piezo-i.1165814930.28621911858" target="_blank">MakerHub</a> |
| Rubber bands / velcro strips | RM 2 - RM 5 | Mount breadboard inside cone base | — |
| GPS module (NEO-6M) | RM 35 - RM 45 | Location tracking (future scope) | <a href="https://shopee.com.my/GPS-Module-GY-NEO-6M-8M-with-Ceramic-Antenna-Time-and-Location-Tracking-For-Arduino-IOT-Project-i.1165814930.25064660228" target="_blank">MakerHub</a> |

> Recommended shop: <a href="https://shopee.com.my/makerhub" target="_blank">MakerHub (Shopee)</a> · <a href="https://makerhub.my" target="_blank">makerhub.my</a> — KL-based, ships within 24hrs.
> Prices as of Feb 2026. Links may expire — search the component name on either platform if a link is dead.

### Wiring

```
ESP32            MPU6050              (M-M 20cm, both on breadboard)
─────            ───────
3.3V  ────────►  VCC
GND   ────────►  GND
GPIO21 (SDA) ──► SDA
GPIO22 (SCL) ──► SCL

ESP32            KY-016 RGB LED       (M-F 30cm, LED at top of cone)
─────            ──────────────
GPIO16 ────────► R
GPIO17 ────────► G
GND    ────────► GND (-)

ESP32            Active Buzzer        (M-M 20cm, stays at base)
─────            ─────────────
GPIO19 ────────► Signal (+)
GND    ────────► GND (-)
```

> **Assembly notes:**
> - Solder header pins onto MPU6050 module before use (comes unsoldered)
> - ESP32 + MPU6050 + buzzer sit on the 400-hole breadboard at the cone base
> - LED module mounts at the top of the cone with 30cm M-F wires running down inside
> - M-M wires for breadboard-to-breadboard connections, M-F wires for reaching the LED

---

## Software Stack

```
ESP32 + MPU6050
    |
    └──► MQTT (HiveMQ Cloud, free tier)
            |
            ├──► Ntfy.sh ──► Phone push notification
            └──► Web dashboard (JS MQTT client, no backend)
```

### Firmware (ESP32)

- Arduino / PlatformIO (C++)
- Read accelerometer via I2C
- Detect impact (acceleration > 3g) or tilt (> 45 degrees sustained)
- Publish MQTT message on event

### Notifications

- Ntfy.sh — free, no app to build, HTTP POST from ESP32

### Dashboard

- Static HTML/JS page
- Connects to MQTT broker via websocket
- Shows cone status (upright / knocked over), live accel graph, event log

---

## Detection Logic

| Event | Trigger |
|-------|---------|
| Impact | Acceleration spike > 3g on any axis |
| Knockover | Tilt > 45 degrees sustained for > 1 second |

---

## MQTT Message Format

```json
{
  "cone_id": "cone-001",
  "event": "impact",
  "accel_g": 4.2,
  "tilt_deg": 72,
  "battery_pct": 85,
  "timestamp": 1707840000
}
```

Topic: `smartcones/{cone_id}/event`

---

## Build Phases

### Phase 1 — Sensor
- Wire ESP32 + MPU6050
- Read accelerometer data on serial monitor
- Calibrate impact and tilt thresholds

### Phase 2 — Connectivity
- Connect ESP32 to Wi-Fi
- Publish events to MQTT broker
- Receive push notification on phone via Ntfy

### Phase 3 — Dashboard
- Web page subscribing to MQTT
- Live cone status and event history
- Accelerometer graph (nice visual for judges)

### Phase 4 — Package
- Mount electronics inside cone base
- Clean up wiring
- Rehearse the demo

---

## Cost Per Cone (approx, MYR)

| Part | Est. Price (MYR) |
|------|-------------------|
| ESP32 dev board | RM 15 |
| MPU6050 (GY-521) | RM 10 |
| Breadboard (400 holes) | RM 8 |
| Jumper wires (M-M + M-F) | RM 8 |
| Micro USB cable | RM 3 |
| Soldering iron + solder | RM 20 |
| Rechargeable AA batteries | RM 10 |
| AA battery holder (3-slot) | RM 3 |
| Traffic cone (30") | RM 25 |
| **Total** | **~RM 102** |

> Optional add-ons: LED module (~RM 3), buzzer (~RM 3), GPS NEO-6M (~RM 40).

---

## Future Scope (competition slide material)

- Cone-to-cone chain alerts (mesh network)
- Wearable integration (buzz worker's wristband on breach)
- Fleet dashboard with GPS tracking across job sites
- Automated incident reports for insurance/compliance
- Solar charging for long-term deployment
