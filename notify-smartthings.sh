#!/bin/bash
# Sends a notification via SmartThings by toggling the CopilotAlert switch.
# Usage: notify-smartthings.sh "Your message here"

ENV_FILE="/opt/smartthings-mcp/.env"
MESSAGE="${1:-Copilot script alert}"

# Cleanup trap — ensure switch is turned off even if script is interrupted
cleanup() {
  if [ -n "$DEVICE_ID" ] && [ -n "$ST_TOKEN" ]; then
    curl -sf -X POST "https://api.smartthings.com/v1/devices/${DEVICE_ID}/commands" \
      -H "Authorization: Bearer ${ST_TOKEN}" \
      -H "Content-Type: application/json" \
      -d '{"commands":[{"component":"main","capability":"switch","command":"off"}]}' > /dev/null 2>&1
  fi
}
trap cleanup EXIT INT TERM

# Load PAT from .env
ST_TOKEN=$(grep '^SMARTTHINGS_PAT=' "$ENV_FILE" | cut -d= -f2-)

if [ -z "$ST_TOKEN" ]; then
  echo "ERROR: SMARTTHINGS_PAT not found in $ENV_FILE"
  exit 1
fi

# Find CopilotAlert device ID
DEVICE_ID=$(curl -sf "https://api.smartthings.com/v1/devices" \
  -H "Authorization: Bearer ${ST_TOKEN}" 2>/dev/null | \
  python3 -c "
import sys, json
data = json.load(sys.stdin)
for d in data.get('items', []):
    if d.get('label') == 'CopilotAlert':
        print(d['deviceId'])
        break
" 2>/dev/null)

if [ -z "$DEVICE_ID" ]; then
  echo "ERROR: CopilotAlert device not found in SmartThings"
  exit 1
fi

# Set device status to carry the message (SmartThings automation can read this)
curl -sf -X PUT "https://api.smartthings.com/v1/devices/${DEVICE_ID}" \
  -H "Authorization: Bearer ${ST_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"label\": \"CopilotAlert: ${MESSAGE:0:100}\"}" > /dev/null 2>&1

# Toggle ON (triggers automation)
curl -sf -X POST "https://api.smartthings.com/v1/devices/${DEVICE_ID}/commands" \
  -H "Authorization: Bearer ${ST_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"commands":[{"component":"main","capability":"switch","command":"on"}]}' > /dev/null 2>&1

# Toggle OFF (reset)
sleep 1
curl -sf -X POST "https://api.smartthings.com/v1/devices/${DEVICE_ID}/commands" \
  -H "Authorization: Bearer ${ST_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"commands":[{"component":"main","capability":"switch","command":"off"}]}' > /dev/null 2>&1

# Restore original label
curl -sf -X PUT "https://api.smartthings.com/v1/devices/${DEVICE_ID}" \
  -H "Authorization: Bearer ${ST_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"label": "CopilotAlert"}' > /dev/null 2>&1

echo "SmartThings notification sent: ${MESSAGE}"
