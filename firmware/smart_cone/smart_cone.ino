#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_NeoPixel.h>
#include "config.h"
#include "connectivity.h"

Adafruit_NeoPixel matrix(MATRIX_NUM_LEDS, MATRIX_PIN, NEO_GRB + NEO_KHZ800);

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
unsigned long lastTelemetryTime = 0;
unsigned long knockoverStartTime = 0;
unsigned long lastIntrusionTime = 0;
unsigned long pirWarmupStart = 0;

// --- Helper Functions ---

void setLED(bool red, bool green, bool blue = false) {
  digitalWrite(LED_RED_PIN, red ? HIGH : LOW);
  digitalWrite(LED_GREEN_PIN, green ? HIGH : LOW);
  digitalWrite(LED_BLUE_PIN, blue ? HIGH : LOW);
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

// --- LED Matrix display (non-blocking animations) ---
bool intrusionFlashing = false;
unsigned long intrusionFlashStart = 0;

void updateMatrix(ConeState s, bool connected) {
  unsigned long now = millis();

  // Intrusion flash: blue/white chase for 3 seconds
  if (intrusionFlashing) {
    if (now - intrusionFlashStart >= 3000) {
      intrusionFlashing = false;
      matrix.clear();
      matrix.show();
      return;
    }
    unsigned long phase = (now / 150) % MATRIX_NUM_LEDS;
    for (int i = 0; i < MATRIX_NUM_LEDS; i++) {
      if (i == (int)phase || i == (int)((phase + 4) % MATRIX_NUM_LEDS) ||
          i == (int)((phase + 8) % MATRIX_NUM_LEDS) || i == (int)((phase + 12) % MATRIX_NUM_LEDS)) {
        matrix.setPixelColor(i, matrix.Color(255, 255, 255)); // White
      } else {
        matrix.setPixelColor(i, matrix.Color(0, 0, 80)); // Blue
      }
    }
    matrix.show();
    return;
  }

  switch (s) {
    case UPRIGHT:
      // Idle = off (save power)
      matrix.clear();
      matrix.show();
      break;
    case IMPACT_ALERT:
      // Red flash once then off — handled by state transition
      matrix.clear();
      matrix.show();
      break;
    case KNOCKED_OVER: {
      // Red flash synced with buzzer (500ms on/off)
      bool flashOn = ((now / 500) % 2) == 0;
      if (flashOn) {
        matrix.fill(matrix.Color(255, 0, 0)); // Red
      } else {
        matrix.clear();
      }
      matrix.show();
      break;
    }
  }
}

// --- Setup ---

void setup() {
  Serial.begin(115200);
  while (!Serial) delay(10);

  Serial.printf("\n=== Smart Cone %s ===\n", FIRMWARE_VERSION);
  Serial.println("Initializing...\n");

  // Init LED pins
  pinMode(LED_RED_PIN, OUTPUT);
  pinMode(LED_GREEN_PIN, OUTPUT);
  pinMode(LED_BLUE_PIN, OUTPUT);
  setLED(false, false, true); // Blue = initializing

  // WiFi reset button
  pinMode(WIFI_RESET_PIN, INPUT);

  // Init buzzer pin
  pinMode(BUZZER_PIN, OUTPUT);
  buzzerOff();

  // Init LED matrix (off by default)
  matrix.begin();
  matrix.setBrightness(MATRIX_BRIGHTNESS);
  matrix.clear();
  matrix.show();
  Serial.println("LED Matrix OK");

  // PIR sensor
  pinMode(PIR_PIN, INPUT);
  pirWarmupStart = millis();
  Serial.println("PIR warming up (60s)...");

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
  setupNetworkTask();

  if (wifiOk && mqttReconnect()) {
    mqttConnected = true;
    setLED(false, true); // Green = WiFi + MQTT connected
    Serial.println("WiFi + MQTT ready — LED green");
  } else {
    Serial.println("Not fully connected — LED stays yellow");
  }

  // Check for firmware updates at boot
  checkFirmwareUpdate();

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

  // Publish telemetry periodically
  if (mqttClient.connected() && (millis() - lastTelemetryTime >= TELEMETRY_INTERVAL_MS)) {
    lastTelemetryTime = millis();
    publishTelemetry(tiltDeg);
  }

  // Print readings
  Serial.printf("%10.2f | %5.2f | %5.2f | %6.2f | %7.1f | %s\n",
                ax, ay, az, magnitude, tiltDeg, stateToString(state));

  // Auto-off buzzer after duration (only for IMPACT_ALERT, not KNOCKED_OVER)
  if (buzzerActive && state != KNOCKED_OVER && (millis() - buzzerStartTime >= BUZZER_DURATION_MS)) {
    buzzerOff();
  }

  // --- State Machine ---

  switch (state) {

    case UPRIGHT:
      if (mqttConnected) {
        setLED(false, true); // Green = connected
      } else {
        setLED(false, false, true); // Blue = not connected
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
      }
      // Check for tilt (start of potential knockover)
      else if (tiltDeg > TILT_THRESHOLD_DEG) {
        if (!tiltTimerRunning) {
          tiltTimerRunning = true;
          tiltStartTime = millis();
        } else if (millis() - tiltStartTime >= TILT_SUSTAIN_MS) {
          Serial.println("\n*** KNOCKED OVER! ***\n");
          knockoverStartTime = millis();
          state = KNOCKED_OVER;
          setLED(true, false); // Red
          // Start buzzer immediately
          digitalWrite(BUZZER_PIN, HIGH);
          buzzerActive = true;
          buzzerStartTime = millis();
          // Network calls (non-blocking, queued to core 0)
          publishEvent("knockover", magnitude, tiltDeg);
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
        publishEventNoNtfy("recovery", magnitude, tiltDeg);
        state = UPRIGHT;
      }
      break;

    case KNOCKED_OVER:
      // Emergency alarm pulse (500ms on, 500ms off)
      if (!buzzerActive && (millis() - buzzerStartTime >= 500)) {
        digitalWrite(BUZZER_PIN, HIGH);
        buzzerActive = true;
        buzzerStartTime = millis();
      } else if (buzzerActive && (millis() - buzzerStartTime >= 500)) {
        digitalWrite(BUZZER_PIN, LOW);
        buzzerActive = false;
        buzzerStartTime = millis();
      }

      // Wait for recovery (tilt back below recovery threshold)
      if (tiltDeg < TILT_RECOVERY_DEG) {
        Serial.println("\n--- Cone recovered! Back upright ---\n");
        unsigned long durationS = (millis() - knockoverStartTime) / 1000;
        publishEventNoNtfy("recovery", magnitude, tiltDeg, durationS);
        buzzerOff(); // Ensure buzzer stops on recovery
        state = UPRIGHT;
      }
      break;
  }

  // --- Intrusion Detection (PIR) ---
  if (millis() - pirWarmupStart >= PIR_WARMUP_MS) {
    if (digitalRead(PIR_PIN) == HIGH) {
      unsigned long now = millis();
      if (now - lastIntrusionTime >= INTRUSION_COOLDOWN_MS) {
        lastIntrusionTime = now;
        Serial.println("\n*** INTRUSION DETECTED! ***\n");
        // Quick triple beep
        for (int i = 0; i < 3; i++) {
          digitalWrite(BUZZER_PIN, HIGH);
          delay(100);
          digitalWrite(BUZZER_PIN, LOW);
          delay(100);
        }
        // Trigger matrix intrusion animation
        intrusionFlashing = true;
        intrusionFlashStart = millis();
        publishEvent("intrusion", magnitude, tiltDeg);
      }
    }
  }

  // --- WiFi Reset Button (hold 3s anytime) ---
  static unsigned long btnHoldStart = 0;
  static bool btnHeld = false;
  if (digitalRead(WIFI_RESET_PIN) == HIGH) {
    if (!btnHeld) {
      btnHeld = true;
      btnHoldStart = millis();
      setLED(true, true, false); // Yellow = holding
    } else if (millis() - btnHoldStart >= WIFI_RESET_HOLD_MS) {
      Serial.println("WiFi credentials cleared! Rebooting into portal...");
      // Notify dashboard before resetting
      if (mqttClient.connected()) {
        char topic[64];
        snprintf(topic, sizeof(topic), MQTT_TOPIC_STATUS, dynamicConeId);
        char payload[128];
        snprintf(payload, sizeof(payload), "{\"cone_id\":\"%s\",\"status\":\"reset\"}", dynamicConeId);
        mqttClient.publish(topic, payload);
        delay(500); // Give MQTT time to send
      }
      // Mark as user-initiated reset
      preferences.begin("smartcone", false);
      preferences.putBool("wifi_reset", true);
      preferences.end();
      for (int i = 0; i < 3; i++) {
        setLED(true, true, false); delay(300);
        setLED(false, false, false); delay(200);
      }
      WiFiManager wm;
      wm.resetSettings();
      ESP.restart();
    }
  } else {
    if (btnHeld) {
      // Released too early — restore normal LED
      btnHeld = false;
      if (mqttClient.connected()) setLED(false, true, false);
      else setLED(false, false, true);
    }
  }

  // Update LED matrix to match state
  updateMatrix(state, mqttClient.connected());

  delay(50); // 20Hz sampling rate
}
