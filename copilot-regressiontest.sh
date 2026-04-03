#!/bin/bash

# Load central configuration
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/config.sh"

# ── Config ────────────────────────────────────────────────────────────────────
PROJECT_DIR="/opt/yourproject"
LOG_FILE="/opt/copilot-hive/copilot-regressiontest.log"
NOTIFY="/opt/copilot-hive/notify-smartthings.sh"
CHANGELOG_DIR="/opt/copilot-hive/changelogs"

API_BASE="http://localhost:8080"
WEB_BASE="http://localhost:8080"

# ── Run ───────────────────────────────────────────────────────────────────────
echo "======================================" >> "$LOG_FILE"
echo "Regression Test Started: $(date)" >> "$LOG_FILE"

RESULTS_FILE=$(mktemp)
trap "rm -f '$RESULTS_FILE'" EXIT

check() {
  local name="$1" url="$2" expected="${3:-200}"
  local code
  code=$(curl -sf -o /dev/null -w "%{http_code}" --max-time 15 "$url" 2>/dev/null || echo "000")
  if [ "$code" = "$expected" ]; then
    echo "PASS|$name|$code|$expected" >> "$RESULTS_FILE"
  else
    echo "FAIL|$name|$code|$expected" >> "$RESULTS_FILE"
  fi
}

check_json() {
  local name="$1" url="$2"
  local response code
  response=$(curl -sf --max-time 15 "$url" 2>/dev/null)
  if echo "$response" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null; then
    echo "PASS|$name|valid JSON|200" >> "$RESULTS_FILE"
  else
    code=$(curl -sf -o /dev/null -w "%{http_code}" --max-time 15 "$url" 2>/dev/null || echo "000")
    echo "FAIL|$name|$code (invalid JSON)|200" >> "$RESULTS_FILE"
  fi
}

# Run HTTP checks in parallel
echo "" >> "$LOG_FILE"
echo "── Core Health Tests ──" >> "$LOG_FILE"
check "Homepage" "$WEB_BASE/" &

# Test common pages — these will gracefully PASS or FAIL based on what exists
for page in dashboard portal admin login about pricing services contact blog; do
  check "$page" "$WEB_BASE/$page" &
done

# Test API endpoints if they exist
echo "" >> "$LOG_FILE"
echo "── API Endpoint Tests ──" >> "$LOG_FILE"
check "API Root" "$API_BASE/api/" &
check "API Health" "$API_BASE/api/health" &

wait

# Collect parallel check results
TOTAL=0; PASSED=0; FAILED=0; FAILURES=""
while IFS='|' read -r result name status expected; do
  TOTAL=$((TOTAL + 1))
  if [ "$result" = "PASS" ]; then
    PASSED=$((PASSED + 1))
    echo "  PASS  $name ($status)" >> "$LOG_FILE"
  else
    FAILED=$((FAILED + 1))
    echo "  FAIL  $name (got $status, expected $expected)" >> "$LOG_FILE"
    FAILURES="${FAILURES}\n  - ${name}: got ${status}, expected ${expected}"
  fi
done < "$RESULTS_FILE"

echo "" >> "$LOG_FILE"
echo "── Container Health ──" >> "$LOG_FILE"
for container in ${CONTAINER_API:-yourproject-api} ${CONTAINER_WEB:-yourproject-web} ${CONTAINER_DB:-yourproject-db}; do
  TOTAL=$((TOTAL + 1))
  STATE=$(docker inspect -f '{{.State.Status}}' "$container" 2>/dev/null || echo "missing")
  HEALTH=$(docker inspect -f '{{.State.Health.Status}}' "$container" 2>/dev/null || echo "none")
  if [ "$STATE" = "running" ]; then
    PASSED=$((PASSED + 1))
    echo "  PASS  Container $container ($STATE, health: $HEALTH)" >> "$LOG_FILE"
  else
    FAILED=$((FAILED + 1))
    echo "  FAIL  Container $container ($STATE, health: $HEALTH)" >> "$LOG_FILE"
    FAILURES="${FAILURES}\n  - Container ${container}: ${STATE} (health: ${HEALTH})"
  fi
done

# ── Results ───────────────────────────────────────────────────────────
echo "" >> "$LOG_FILE"
echo "Results: $PASSED/$TOTAL passed, $FAILED failed" >> "$LOG_FILE"

if [ $FAILED -gt 0 ]; then
  "$NOTIFY" "REGRESSION: $FAILED/$TOTAL tests failed at $(date '+%H:%M')" >> "$LOG_FILE" 2>&1
fi

# ── Changelog ─────────────────────────────────────────────────────────
mkdir -p "$CHANGELOG_DIR"
TIMESTAMP=$(date '+%Y-%m-%d_%H%M')
CHANGELOG_FILE="${CHANGELOG_DIR}/regression_${TIMESTAMP}.txt"
{
  echo "============================================"
  echo "  REGRESSION TEST RUN — $(date)"
  echo "  Results: $PASSED/$TOTAL passed, $FAILED failed"
  echo "============================================"
  if [ $FAILED -gt 0 ]; then
    echo ""
    echo "FAILURES:"
    echo -e "$FAILURES"
  fi
  echo ""
  echo "Current containers:"
  docker ps --format "  {{.Names}}\t{{.Status}}" 2>/dev/null | head -20
} > "$CHANGELOG_FILE"
echo "Changelog saved: $CHANGELOG_FILE" >> "$LOG_FILE"

echo "Regression Test Finished: $(date)" >> "$LOG_FILE"
exit $FAILED
