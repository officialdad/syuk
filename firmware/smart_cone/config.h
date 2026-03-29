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
#define CONE_RESTING_TILT    76.0  // Resting tilt when mounted inside cone (degrees)
#define DISTURBED_DEV        3.0   // Disturbed: 3° deviation from resting (either direction)
#define KNOCKOVER_DEV        10.0  // Knockover: 10° deviation from resting (either direction)
#define RECOVERY_DEV         2.0   // Recovery: within 2° of resting
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
#define PIR_PIN 27
#define INTRUSION_COOLDOWN_MS 5000
#define PIR_WARMUP_MS 10000

// --- WS2812B LED Matrix (4x4) ---
#define MATRIX_PIN 14
#define MATRIX_NUM_LEDS 16
#define MATRIX_BRIGHTNESS 255  // Max brightness

// --- WiFi Reset Button ---
#define WIFI_RESET_PIN 26
#define WIFI_RESET_HOLD_MS 3000  // Hold 3s to reset WiFi

// --- Firmware Version & OTA ---
#define FIRMWARE_VERSION "1.1.0"
#define OTA_VERSION_URL DASHBOARD_API "/api/firmware/version"

// --- Cone ID ---
#define CONE_ID_PREFIX "cone-"
#define AP_NAME_PREFIX "Smart-Cone-"
#define CONE_ID_MAX_LEN 32

#endif
