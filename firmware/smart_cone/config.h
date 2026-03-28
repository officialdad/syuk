#ifndef CONFIG_H
#define CONFIG_H

// --- Pin Definitions ---

// I2C (MPU6050)
#define SDA_PIN 21
#define SCL_PIN 22

// RGB LED (KY-016)
#define LED_RED_PIN   16
#define LED_GREEN_PIN 17
#define LED_BLUE_PIN  5

// Active Buzzer
#define BUZZER_PIN 13

// --- Detection Thresholds ---

#define IMPACT_THRESHOLD_G   3.0   // Acceleration magnitude to trigger impact (in g)
#define TILT_THRESHOLD_DEG   45.0  // Tilt angle to start knockover detection (degrees)
#define TILT_RECOVERY_DEG    30.0  // Tilt angle to consider recovered (degrees)
#define TILT_SUSTAIN_MS      1000  // How long tilt must hold before knockover triggers (ms)
#define ALERT_COOLDOWN_MS    10000 // Cooldown between alerts to prevent spam (ms)
#define BUZZER_DURATION_MS   2000  // How long buzzer beeps on alert (ms)

// --- Connectivity (Phase 2) ---

#define WIFI_AP_NAME      "SmartCone-Setup"
#define MQTT_TOPIC_EVENT  "smartcones/%s/event"
#define MQTT_TOPIC_STATUS "smartcones/%s/status"
#define NTFY_SERVER       "https://ntfy.sh"
#define DASHBOARD_API     "https://kon.automasi.my"
#define MQTT_RECONNECT_MS 5000

// --- Telemetry ---
#define TELEMETRY_INTERVAL_MS 30000
#define MQTT_TOPIC_TELEMETRY "smartcones/%s/telemetry"

// --- Intrusion Detection (PIR) ---
#define PIR_PIN 23
#define INTRUSION_COOLDOWN_MS 15000
#define PIR_WARMUP_MS 60000

// --- Firmware Version & OTA ---
#define FIRMWARE_VERSION "1.0.0"
#define OTA_VERSION_URL DASHBOARD_API "/api/firmware/version"

// --- Cone ID ---
#define CONE_ID_PREFIX "cone-"
#define AP_NAME_PREFIX "SmartCone-"
#define CONE_ID_MAX_LEN 32

#endif
