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

| # | Component | Notes |
|---|-----------|-------|
| 1 | ESP32 dev board | DevKit V1 or ESP32-C3 SuperMini |
| 2 | MPU6050 module (GY-521) | Accelerometer + gyro breakout |
| 3 | Jumper wires (x4) | VCC, GND, SDA, SCL |
| 4 | Micro USB cable | Power + flashing |
| 5 | USB power bank | Powers the cone during demo |
| 6 | Traffic cone | Hollow base fits the electronics |
| 7 | Mini breadboard | Keeps wiring clean inside the cone |

### Optional

| Component | Why |
|-----------|-----|
| LED (any color) | Visual feedback on impact |
| Buzzer | Audio feedback on impact |
| Rubber bands / velcro strips | Mount breadboard inside cone base |
| GPS module (NEO-6M) | Location tracking (future scope) |

### Wiring

```
ESP32            MPU6050
─────            ───────
3.3V  ────────►  VCC
GND   ────────►  GND
GPIO21 (SDA) ──► SDA
GPIO22 (SCL) ──► SCL
```

No soldering needed. MPU6050 module has built-in pull-up resistors.

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

## Cost Per Cone (approx)

| Part | Cost |
|------|------|
| ESP32 | ~$4 |
| MPU6050 | ~$2 |
| Breadboard + wires | ~$2 |
| USB power bank | ~$5 |
| Cone | ~$3 |
| **Total** | **~$16** |

---

## Future Scope (competition slide material)

- Cone-to-cone chain alerts (mesh network)
- Wearable integration (buzz worker's wristband on breach)
- Fleet dashboard with GPS tracking across job sites
- Automated incident reports for insurance/compliance
- Solar charging for long-term deployment
