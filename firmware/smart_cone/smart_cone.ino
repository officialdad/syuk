#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include "config.h"
#include "connectivity.h"

// --- State Machine ---
enum ConeState {
  UPRIGHT,
  IMPACT_ALERT,
  KNOCKED_OVER
};

Adafruit_MPU6050 mpu;
ConeState state = UPRIGHT;

unsigned long tiltStartTime = 0;
unsigned long alertStartTime = 0;
unsigned long buzzerStartTime = 0;
bool buzzerActive = false;
bool tiltTimerRunning = false;
bool mqttConnected = false;

// --- Helper Functions ---

void setLED(bool red, bool green) {
  digitalWrite(LED_RED_PIN, red ? HIGH : LOW);
  digitalWrite(LED_GREEN_PIN, green ? HIGH : LOW);
}

void buzzerOn() {
  digitalWrite(BUZZER_PIN, HIGH);
  buzzerActive = true;
  buzzerStartTime = millis();
}

void buzzerOff() {
  digitalWrite(BUZZER_PIN, LOW);
  buzzerActive = false;
}

const char* stateToString(ConeState s) {
  switch (s) {
    case UPRIGHT:      return "UPRIGHT";
    case IMPACT_ALERT: return "IMPACT_ALERT";
    case KNOCKED_OVER: return "KNOCKED_OVER";
    default:           return "UNKNOWN";
  }
}

// --- Setup ---

void setup() {
  Serial.begin(115200);
  while (!Serial) delay(10);

  Serial.println("\n=== Smart Cone v2.0 ===");
  Serial.println("Initializing...\n");

  // Init LED pins
  pinMode(LED_RED_PIN, OUTPUT);
  pinMode(LED_GREEN_PIN, OUTPUT);
  setLED(true, false); // Red = initializing / not connected

  // Init buzzer pin
  pinMode(BUZZER_PIN, OUTPUT);
  buzzerOff();

  // Init MPU6050
  if (!mpu.begin()) {
    Serial.println("ERROR: MPU6050 not found! Check wiring:");
    Serial.println("  3.3V -> VCC");
    Serial.println("  GND  -> GND");
    Serial.println("  GPIO21 -> SDA");
    Serial.println("  GPIO22 -> SCL");

    // Blink red LED to indicate error
    while (1) {
      setLED(true, false);
      delay(500);
      setLED(false, false);
      delay(500);
    }
  }

  mpu.setAccelerometerRange(MPU6050_RANGE_8_G);
  mpu.setGyroRange(MPU6050_RANGE_500_DEG);
  mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);

  Serial.println("MPU6050 OK");
  Serial.println("LED OK (yellow = initializing)");
  Serial.println("Buzzer OK");

  // Phase 2: Connectivity
  bool wifiOk = setupWiFi();
  setupMQTT();

  if (wifiOk && mqttReconnect()) {
    mqttConnected = true;
    setLED(false, true); // Green = WiFi + MQTT connected
    Serial.println("WiFi + MQTT ready — LED green");
  } else {
    Serial.println("Not fully connected — LED stays yellow");
  }

  Serial.println("\nSmart Cone ready!\n");
  Serial.println("Accel X(g) | Y(g)  | Z(g)  | Mag(g) | Tilt(°) | State");
  Serial.println("---------- | ----- | ----- | ------ | ------- | -----");
}

// --- Main Loop ---

void loop() {
  mqttLoop();

  // Track MQTT connection state for LED
  bool wasConnected = mqttConnected;
  mqttConnected = mqttClient.connected();
  if (mqttConnected && !wasConnected) {
    Serial.println("MQTT connected — LED green");
  } else if (!mqttConnected && wasConnected) {
    Serial.println("MQTT disconnected — LED yellow");
  }

  // Read sensor
  sensors_event_t accel, gyro, temp;
  mpu.getEvent(&accel, &gyro, &temp);

  // Convert from m/s² to g (9.81 m/s² = 1g)
  float ax = accel.acceleration.x / 9.81;
  float ay = accel.acceleration.y / 9.81;
  float az = accel.acceleration.z / 9.81;

  // Calculate magnitude and tilt
  float magnitude = sqrt(ax * ax + ay * ay + az * az);
  float tiltDeg = acos(constrain(az / magnitude, -1.0, 1.0)) * 180.0 / PI;

  // Print readings
  Serial.printf("%10.2f | %5.2f | %5.2f | %6.2f | %7.1f | %s\n",
                ax, ay, az, magnitude, tiltDeg, stateToString(state));

  // Auto-off buzzer after duration
  if (buzzerActive && (millis() - buzzerStartTime >= BUZZER_DURATION_MS)) {
    buzzerOff();
  }

  // --- State Machine ---

  switch (state) {

    case UPRIGHT:
      if (mqttConnected) {
        setLED(false, true); // Green = connected
      } else {
        setLED(true, false); // Red = not connected
      }

      // Skip detection while buzzer is vibrating (prevents false triggers)
      if (buzzerActive) break;

      // Check for impact
      if (magnitude > IMPACT_THRESHOLD_G) {
        Serial.println("\n*** IMPACT DETECTED! ***\n");
        state = IMPACT_ALERT;
        alertStartTime = millis();
        setLED(true, false); // Red
        buzzerOn();
        publishEvent("impact", magnitude, tiltDeg);
        sendNtfyAlert("impact", magnitude, tiltDeg);
      }
      // Check for tilt (start of potential knockover)
      else if (tiltDeg > TILT_THRESHOLD_DEG) {
        if (!tiltTimerRunning) {
          tiltTimerRunning = true;
          tiltStartTime = millis();
        } else if (millis() - tiltStartTime >= TILT_SUSTAIN_MS) {
          Serial.println("\n*** KNOCKED OVER! ***\n");
          state = KNOCKED_OVER;
          setLED(true, false); // Red
          buzzerOn();
          publishEvent("knockover", magnitude, tiltDeg);
          sendNtfyAlert("knockover", magnitude, tiltDeg);
          tiltTimerRunning = false;
        }
      } else {
        tiltTimerRunning = false; // Reset if tilt goes back below threshold
      }
      break;

    case IMPACT_ALERT:
      // Wait for cooldown, then return to upright
      if (millis() - alertStartTime >= ALERT_COOLDOWN_MS) {
        Serial.println("\n--- Cooldown complete, resuming monitoring ---\n");
        publishEvent("recovery", magnitude, tiltDeg);
        state = UPRIGHT;
      }
      break;

    case KNOCKED_OVER:
      // Wait for recovery (tilt back below recovery threshold)
      if (tiltDeg < TILT_RECOVERY_DEG) {
        Serial.println("\n--- Cone recovered! Back upright ---\n");
        publishEvent("recovery", magnitude, tiltDeg);
        state = UPRIGHT;
      }
      break;
  }

  delay(50); // 20Hz sampling rate
}
