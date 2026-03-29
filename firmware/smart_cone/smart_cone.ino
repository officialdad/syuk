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
  DISTURBED,
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

// Resting orientation (calibrated at boot)
float restAx = 0, restAy = 0, restAz = 1.0; // Default: flat
bool calibrated = false;

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
    case DISTURBED:    return "DISTURBED";
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
    case DISTURBED: {
      // Amber pulse
      bool pulseOn = ((now / 800) % 2) == 0;
      if (pulseOn) {
        matrix.fill(matrix.Color(255, 150, 0)); // Amber
      } else {
        matrix.clear();
      }
      matrix.show();
      break;
    }
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

  // Calibrate resting orientation (average 20 samples)
  Serial.println("Calibrating resting orientation...");
  float sumAx = 0, sumAy = 0, sumAz = 0;
  for (int i = 0; i < 20; i++) {
    sensors_event_t a, g, t;
    mpu.getEvent(&a, &g, &t);
    sumAx += a.acceleration.x / 9.81;
    sumAy += a.acceleration.y / 9.81;
    sumAz += a.acceleration.z / 9.81;
    delay(50);
  }
  restAx = sumAx / 20.0;
  restAy = sumAy / 20.0;
  restAz = sumAz / 20.0;
  float restMag = sqrt(restAx * restAx + restAy * restAy + restAz * restAz);
  restAx /= restMag;
  restAy /= restMag;
  restAz /= restMag;
  calibrated = true;
  Serial.printf("Resting orientation: (%.2f, %.2f, %.2f)\n", restAx, restAy, restAz);

  Serial.println("\nSmart Cone ready!\n");
  Serial.println("Accel X(g) | Y(g)  | Z(g)  | Mag(g) | Dev(°) | State");
  Serial.println("---------- | ----- | ----- | ------ | ------ | -----");
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

  // Calculate magnitude and deviation from resting orientation
  float magnitude = sqrt(ax * ax + ay * ay + az * az);
  // Normalize current reading
  float nax = ax / magnitude, nay = ay / magnitude, naz = az / magnitude;
  // Dot product with resting orientation = cos(angle between them)
  float dotProduct = nax * restAx + nay * restAy + naz * restAz;
  float tiltDev = acos(constrain(dotProduct, -1.0, 1.0)) * 180.0 / PI;
  float tiltDeg = tiltDev; // For display/logging compatibility

  // Publish telemetry periodically
  if (mqttClient.connected() && (millis() - lastTelemetryTime >= TELEMETRY_INTERVAL_MS)) {
    lastTelemetryTime = millis();
    publishTelemetry(tiltDeg);
  }

  // Print readings
  Serial.printf("%10.2f | %5.2f | %5.2f | %6.2f | %6.1f | %s\n",
                ax, ay, az, magnitude, tiltDev, stateToString(state));

  // Auto-off buzzer after duration (only for IMPACT_ALERT, not KNOCKED_OVER)
  if (buzzerActive && state != KNOCKED_OVER && state != DISTURBED && (millis() - buzzerStartTime >= BUZZER_DURATION_MS)) {
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
      // Check for tilt — knockover (high) or disturbed (moderate)
      else if (tiltDev > KNOCKOVER_DEV) {
        if (!tiltTimerRunning) {
          tiltTimerRunning = true;
          tiltStartTime = millis();
        } else if (millis() - tiltStartTime >= TILT_SUSTAIN_MS) {
          Serial.println("\n*** KNOCKED OVER! ***\n");
          knockoverStartTime = millis();
          state = KNOCKED_OVER;
          setLED(true, false); // Red
          digitalWrite(BUZZER_PIN, HIGH);
          buzzerActive = true;
          buzzerStartTime = millis();
          publishEvent("knockover", magnitude, tiltDeg);
          tiltTimerRunning = false;
        }
      }
      else if (tiltDev > DISTURBED_DEV) {
        Serial.println("\n*** CONE DISTURBED ***\n");
        state = DISTURBED;
        setLED(true, true, false); // Yellow
        // Single short beep
        digitalWrite(BUZZER_PIN, HIGH);
        delay(200);
        digitalWrite(BUZZER_PIN, LOW);
        publishEvent("disturbed", magnitude, tiltDeg);
        tiltTimerRunning = false;
      } else {
        tiltTimerRunning = false;
      }
      break;

    case DISTURBED:
      // Check for escalation to knockover
      if (tiltDev > KNOCKOVER_DEV) {
        if (!tiltTimerRunning) {
          tiltTimerRunning = true;
          tiltStartTime = millis();
        } else if (millis() - tiltStartTime >= TILT_SUSTAIN_MS) {
          Serial.println("\n*** KNOCKED OVER (from disturbed)! ***\n");
          knockoverStartTime = millis();
          state = KNOCKED_OVER;
          setLED(true, false); // Red
          digitalWrite(BUZZER_PIN, HIGH);
          buzzerActive = true;
          buzzerStartTime = millis();
          publishEvent("knockover", magnitude, tiltDeg);
          tiltTimerRunning = false;
        }
      }
      // Check for recovery back to upright
      else if (tiltDev < RECOVERY_DEV) {
        Serial.println("\n--- Cone settled, back upright ---\n");
        publishEventNoNtfy("recovery", magnitude, tiltDeg);
        state = UPRIGHT;
        tiltTimerRunning = false;
      } else {
        tiltTimerRunning = false;
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
      if (tiltDev < RECOVERY_DEV) {
        Serial.println("\n--- Cone recovered! Back upright ---\n");
        unsigned long durationS = (millis() - knockoverStartTime) / 1000;
        publishEventNoNtfy("recovery", magnitude, tiltDeg, durationS);
        buzzerOff(); // Ensure buzzer stops on recovery
        state = UPRIGHT;
      }
      break;
  }

  // --- Intrusion Detection (PIR) — only when UPRIGHT ---
  if (state == UPRIGHT && millis() - pirWarmupStart >= PIR_WARMUP_MS) {
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
