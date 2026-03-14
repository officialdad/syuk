#!/bin/bash
# Reads .env and generates secrets.h for the firmware
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$ROOT_DIR/.env"
OUT_FILE="$ROOT_DIR/firmware/smart_cone/secrets.h"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: .env not found at $ENV_FILE"
  exit 1
fi

source "$ENV_FILE"

cat > "$OUT_FILE" << EOF
#ifndef SECRETS_H
#define SECRETS_H

// Auto-generated from .env — do not edit manually
#define MQTT_BROKER   "${CLUSTER_URL}"
#define MQTT_PORT     8883
#define MQTT_USER     "${CLUSTER_USERNAME}"
#define MQTT_PASSWORD "${CLUSTER_PASSWORD}"
#define NTFY_TOPIC    "${NTFY_TOPIC}"
#define CONE_ID       "cone-001"

#endif
EOF

echo "Generated $OUT_FILE"
