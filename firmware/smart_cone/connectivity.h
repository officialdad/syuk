#ifndef CONNECTIVITY_H
#define CONNECTIVITY_H

#include <WiFiManager.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include "config.h"
#include "secrets.h"

WiFiClientSecure espClient;
PubSubClient mqttClient(espClient);

Preferences preferences;
char dynamicConeId[CONE_ID_MAX_LEN] = "";

unsigned long lastMqttReconnect = 0;

bool setupWiFi() {
  // Load or generate Cone ID
  preferences.begin("smartcone", false);
  String savedId = preferences.getString("cone_id", "");

  if (savedId.length() > 0) {
    savedId.toCharArray(dynamicConeId, CONE_ID_MAX_LEN);
  } else {
    // Auto-generate from ESP32 MAC address (last 4 hex chars)
    uint8_t mac[6];
    WiFi.macAddress(mac);
    snprintf(dynamicConeId, CONE_ID_MAX_LEN, "%s%02x%02x", CONE_ID_PREFIX, mac[4], mac[5]);
    Serial.printf("WiFi: Auto-generated Cone ID: %s\n", dynamicConeId);
  }

  WiFiManager wm;
  wm.setConfigPortalTimeout(180);

  // Custom parameter for Cone ID
  WiFiManagerParameter coneIdParam("cone_id", "Cone ID (e.g. cone-002)", dynamicConeId, CONE_ID_MAX_LEN);
  wm.addParameter(&coneIdParam);

  // Dynamic AP name based on Cone ID (always uses ID, never "Setup")
  String apName = String(AP_NAME_PREFIX) + String(dynamicConeId);

  Serial.printf("WiFi: AP name: %s\n", apName.c_str());
  Serial.printf("WiFi: Current Cone ID: %s\n", dynamicConeId);
  Serial.println("WiFi: Starting WiFiManager...");

  if (!wm.autoConnect(apName.c_str())) {
    Serial.println("WiFi: Failed to connect. Continuing offline.");
    preferences.end();
    return false;
  }

  // Always read the parameter value (works even on auto-connect if previously set)
  String newId = String(coneIdParam.getValue());
  newId.trim();
  if (newId.length() > 0) {
    newId.toCharArray(dynamicConeId, CONE_ID_MAX_LEN);
    preferences.putString("cone_id", newId);
    Serial.printf("WiFi: Cone ID: %s\n", dynamicConeId);
  }

  preferences.end();
  Serial.print("WiFi: Connected! IP: ");
  Serial.println(WiFi.localIP());
  return true;
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  // Parse command
  char msg[256];
  unsigned int copyLen = length < 255 ? length : 255;
  memcpy(msg, payload, copyLen);
  msg[copyLen] = '\0';

  Serial.printf("MQTT Command: %s\n", msg);

  JsonDocument doc;
  if (deserializeJson(doc, msg)) return;

  const char* action = doc["action"];
  if (!action) return;

  if (strcmp(action, "reset") == 0) {
    Serial.println("MQTT: Reset command received! Clearing config and restarting...");
    // Clear WiFi credentials
    WiFiManager wm;
    wm.resetSettings();
    // Clear saved Cone ID
    preferences.begin("smartcone", false);
    preferences.clear();
    preferences.end();
    delay(1000);
    ESP.restart();
  } else if (strcmp(action, "identify") == 0) {
    Serial.println("MQTT: Identify command — flashing LED!");
    // Flash LED rapidly for 5 seconds (purple = identify)
    for (int i = 0; i < 25; i++) {
      digitalWrite(LED_RED_PIN, HIGH); digitalWrite(LED_BLUE_PIN, HIGH); // purple
      delay(100);
      digitalWrite(LED_RED_PIN, LOW); digitalWrite(LED_BLUE_PIN, LOW); // off
      delay(100);
    }
    // Restore normal state
    if (mqttClient.connected()) {
      digitalWrite(LED_RED_PIN, LOW); digitalWrite(LED_GREEN_PIN, HIGH); digitalWrite(LED_BLUE_PIN, LOW); // green
    } else {
      digitalWrite(LED_RED_PIN, LOW); digitalWrite(LED_GREEN_PIN, LOW); digitalWrite(LED_BLUE_PIN, HIGH); // blue
    }
  }
}

void setupMQTT() {
  espClient.setInsecure();
  mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
  mqttClient.setBufferSize(512);
  mqttClient.setCallback(mqttCallback);
}

bool mqttReconnect() {
  if (mqttClient.connected()) return true;
  if (WiFi.status() != WL_CONNECTED) return false;

  unsigned long now = millis();
  if (now - lastMqttReconnect < MQTT_RECONNECT_MS) return false;
  lastMqttReconnect = now;

  Serial.print("MQTT: Connecting to ");
  Serial.print(MQTT_BROKER);
  Serial.print("...");

  String clientId = "smartcone-" + String(dynamicConeId);
  char statusTopic[64];
  snprintf(statusTopic, sizeof(statusTopic), MQTT_TOPIC_STATUS, dynamicConeId);
  // LWT: broker publishes "offline" if device disconnects unexpectedly
  if (mqttClient.connect(clientId.c_str(), MQTT_USER, MQTT_PASSWORD,
                         statusTopic, 0, true, "{\"status\":\"offline\"}")) {
    Serial.println(" connected!");
    mqttClient.publish(statusTopic, "{\"status\":\"online\"}", true);
    // Subscribe to command topic
    char cmdTopic[64];
    snprintf(cmdTopic, sizeof(cmdTopic), "smartcones/%s/command", dynamicConeId);
    mqttClient.subscribe(cmdTopic);
    Serial.printf("MQTT: Subscribed to %s\n", cmdTopic);
    return true;
  } else {
    Serial.print(" failed (rc=");
    Serial.print(mqttClient.state());
    Serial.println("). Retrying...");
    return false;
  }
}

void mqttLoop() {
  if (!mqttClient.connected()) {
    mqttReconnect();
  }
  mqttClient.loop();
}

bool publishEvent(const char* event, float accelG, float tiltDeg) {
  if (!mqttClient.connected()) return false;

  JsonDocument doc;
  doc["cone_id"] = dynamicConeId;
  doc["event"] = event;
  doc["accel_g"] = round(accelG * 100) / 100.0;
  doc["tilt_deg"] = round(tiltDeg * 10) / 10.0;
  doc["uptime_s"] = millis() / 1000;

  char payload[256];
  serializeJson(doc, payload, sizeof(payload));

  char topic[64];
  snprintf(topic, sizeof(topic), MQTT_TOPIC_EVENT, dynamicConeId);

  bool ok = mqttClient.publish(topic, payload);
  if (ok) {
    Serial.printf("MQTT: Published to %s\n", topic);
  } else {
    Serial.println("MQTT: Publish failed");
  }
  return ok;
}

void sendNtfyAlert(const char* event, float accelG, float tiltDeg) {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  String url = String(NTFY_SERVER) + "/" + String(NTFY_TOPIC);
  http.begin(url);
  http.addHeader("Title", "Smart Cone Alert");
  http.addHeader("Priority", "high");
  http.addHeader("Tags", "warning,construction");

  String body;
  if (strcmp(event, "knockover") == 0) {
    body = "Cone " + String(dynamicConeId) + " KNOCKED OVER! Tilt: " + String(tiltDeg, 1) + "deg";
  } else if (strcmp(event, "intrusion") == 0) {
    body = "Cone " + String(dynamicConeId) + " INTRUSION detected nearby!";
  } else {
    body = "Cone " + String(dynamicConeId) + " IMPACT detected! Force: " + String(accelG, 1) + "g";
  }

  int code = http.POST(body);
  if (code > 0) {
    Serial.printf("Ntfy: Sent (%d)\n", code);
  } else {
    Serial.printf("Ntfy: Failed (%s)\n", http.errorToString(code).c_str());
  }
  http.end();
}

void publishTelemetry(float tiltDeg) {
  if (!mqttClient.connected()) return;

  JsonDocument doc;
  doc["cone_id"] = dynamicConeId;
  doc["rssi"] = WiFi.RSSI();
  doc["uptime_s"] = millis() / 1000;
  doc["free_heap"] = ESP.getFreeHeap();
  doc["tilt_deg"] = round(tiltDeg * 10) / 10.0;

  char payload[256];
  serializeJson(doc, payload, sizeof(payload));

  char topic[64];
  snprintf(topic, sizeof(topic), MQTT_TOPIC_TELEMETRY, dynamicConeId);

  mqttClient.publish(topic, payload);
}

#endif
