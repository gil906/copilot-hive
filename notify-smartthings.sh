#!/bin/bash
# Sends a notification via SmartThings by toggling the CopilotAlert switch.
# Usage: notify-smartthings.sh "Your message here"

ENV_FILE="/opt/smartthings-mcp/.env"
MESSAGE="${1:-Copilot script alert}"

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

echo "SmartThings notification sent: ${MESSAGE}"
