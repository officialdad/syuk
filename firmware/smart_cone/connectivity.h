#ifndef CONNECTIVITY_H
#define CONNECTIVITY_H

#include <WiFiManager.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "config.h"
#include "secrets.h"

WiFiClientSecure espClient;
PubSubClient mqttClient(espClient);

unsigned long lastMqttReconnect = 0;

bool setupWiFi() {
  WiFiManager wm;
  wm.setConfigPortalTimeout(180);
  Serial.println("WiFi: Starting WiFiManager...");
  if (!wm.autoConnect(WIFI_AP_NAME)) {
    Serial.println("WiFi: Failed to connect. Continuing offline.");
    return false;
  }
  Serial.print("WiFi: Connected! IP: ");
  Serial.println(WiFi.localIP());
  return true;
}

void setupMQTT() {
  espClient.setInsecure();
  mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
  mqttClient.setBufferSize(512);
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

  String clientId = "smartcone-" + String(CONE_ID);
  char statusTopic[64];
  snprintf(statusTopic, sizeof(statusTopic), MQTT_TOPIC_STATUS, CONE_ID);
  // LWT: broker publishes "offline" if device disconnects unexpectedly
  if (mqttClient.connect(clientId.c_str(), MQTT_USER, MQTT_PASSWORD,
                         statusTopic, 0, true, "{\"status\":\"offline\"}")) {
    Serial.println(" connected!");
    mqttClient.publish(statusTopic, "{\"status\":\"online\"}", true);
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
  doc["cone_id"] = CONE_ID;
  doc["event"] = event;
  doc["accel_g"] = round(accelG * 100) / 100.0;
  doc["tilt_deg"] = round(tiltDeg * 10) / 10.0;
  doc["uptime_s"] = millis() / 1000;

  char payload[256];
  serializeJson(doc, payload, sizeof(payload));

  char topic[64];
  snprintf(topic, sizeof(topic), MQTT_TOPIC_EVENT, CONE_ID);

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
    body = "Cone " + String(CONE_ID) + " KNOCKED OVER! Tilt: " + String(tiltDeg, 1) + "deg";
  } else if (strcmp(event, "intrusion") == 0) {
    body = "Cone " + String(CONE_ID) + " INTRUSION detected nearby!";
  } else {
    body = "Cone " + String(CONE_ID) + " IMPACT detected! Force: " + String(accelG, 1) + "g";
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
  doc["cone_id"] = CONE_ID;
  doc["rssi"] = WiFi.RSSI();
  doc["uptime_s"] = millis() / 1000;
  doc["free_heap"] = ESP.getFreeHeap();
  doc["tilt_deg"] = round(tiltDeg * 10) / 10.0;

  char payload[256];
  serializeJson(doc, payload, sizeof(payload));

  char topic[64];
  snprintf(topic, sizeof(topic), MQTT_TOPIC_TELEMETRY, CONE_ID);

  mqttClient.publish(topic, payload);
}

#endif
