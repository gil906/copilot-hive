#!/bin/bash

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

TOTAL=0
PASSED=0
FAILED=0
FAILURES=""

check() {
  local name="$1"
  local url="$2"
  local expected="${3:-200}"
  TOTAL=$((TOTAL + 1))
  STATUS=$(curl -sf -o /dev/null -w "%{http_code}" --max-time 15 "$url" 2>/dev/null || echo "000")
  if [ "$STATUS" = "$expected" ]; then
    PASSED=$((PASSED + 1))
    echo "  PASS  $name ($STATUS)" >> "$LOG_FILE"
  else
    FAILED=$((FAILED + 1))
    echo "  FAIL  $name (got $STATUS, expected $expected)" >> "$LOG_FILE"
    FAILURES="${FAILURES}\n  - ${name}: got ${STATUS}, expected ${expected}"
  fi
}

check_json() {
  local name="$1"
  local url="$2"
  TOTAL=$((TOTAL + 1))
  RESPONSE=$(curl -sf --max-time 15 "$url" 2>/dev/null)
  if echo "$RESPONSE" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null; then
    PASSED=$((PASSED + 1))
    echo "  PASS  $name (valid JSON)" >> "$LOG_FILE"
  else
    FAILED=$((FAILED + 1))
    STATUS=$(curl -sf -o /dev/null -w "%{http_code}" --max-time 15 "$url" 2>/dev/null || echo "000")
    echo "  FAIL  $name (invalid JSON or unreachable, status $STATUS)" >> "$LOG_FILE"
    FAILURES="${FAILURES}\n  - ${name}: invalid JSON or unreachable (status ${STATUS})"
  fi
}

echo "" >> "$LOG_FILE"
echo "── Web Frontend Tests ──" >> "$LOG_FILE"
check "Homepage"               "$WEB_BASE/"
check "Dashboard"              "$WEB_BASE/dashboard"
check "Portal"                 "$WEB_BASE/portal"
check "Tools"                  "$WEB_BASE/tools"
check "Pricing"                "$WEB_BASE/pricing"
check "About"                  "$WEB_BASE/about"
check "Demo"                   "$WEB_BASE/demo"
check "Services"               "$WEB_BASE/services"
check "Contact"                "$WEB_BASE/contact"
check "Blog"                   "$WEB_BASE/blog"
check "How It Works"           "$WEB_BASE/how-it-works"
check "API Docs"               "$WEB_BASE/api-docs"
check "Privacy"                "$WEB_BASE/privacy"
check "Terms"                  "$WEB_BASE/terms"

echo "" >> "$LOG_FILE"
echo "── API Endpoint Tests ──" >> "$LOG_FILE"
check_json "GET /api/scans"    "$API_BASE/api/scans"
check      "API Health"        "$API_BASE/api/scans"

echo "" >> "$LOG_FILE"
echo "── Container Health ──" >> "$LOG_FILE"
for container in yourproject-api yourproject-web yourproject-db; do
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
  docker ps --format "  {{.Names}}\t{{.Status}}" --filter "name=yourproject" 2>/dev/null
} > "$CHANGELOG_FILE"
echo "Changelog saved: $CHANGELOG_FILE" >> "$LOG_FILE"

echo "Regression Test Finished: $(date)" >> "$LOG_FILE"
exit $FAILED
