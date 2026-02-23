#!/bin/bash

# ── Config ────────────────────────────────────────────────────────────────────
PROJECT_DIR="/opt/yourproject"
LOG_FILE="/opt/copilot-hive/copilot-deployer.log"
COMPOSE_FILE="/opt/docker-compose/yourproject.yml"
NOTIFY="/opt/copilot-hive/notify-smartthings.sh"
CHANGELOG_DIR="/opt/copilot-hive/changelogs"

# ── Run ───────────────────────────────────────────────────────────────────────
echo "======================================" >> "$LOG_FILE"
echo "Deploy Started: $(date)" >> "$LOG_FILE"

cd "$PROJECT_DIR" || { echo "ERROR: project dir not found: $PROJECT_DIR" >> "$LOG_FILE"; exit 1; }

# Check if there are new commits since last deploy
LAST_DEPLOY_SHA_FILE="/opt/copilot-hive/.last_deploy_sha"
CURRENT_SHA=$(git -C "$PROJECT_DIR" rev-parse HEAD 2>/dev/null)
LAST_SHA=$(cat "$LAST_DEPLOY_SHA_FILE" 2>/dev/null || echo "none")

if [ "$CURRENT_SHA" = "$LAST_SHA" ]; then
  echo "No new commits since last deploy ($CURRENT_SHA). Skipping." >> "$LOG_FILE"
  exit 0
fi

echo "New commits detected: $LAST_SHA -> $CURRENT_SHA" >> "$LOG_FILE"
echo "Changes since last deploy:" >> "$LOG_FILE"
git -C "$PROJECT_DIR" log --oneline "${LAST_SHA}..${CURRENT_SHA}" 2>/dev/null >> "$LOG_FILE" || true

# Check which files changed to determine what needs rebuilding
CHANGED_FILES=$(git -C "$PROJECT_DIR" diff --name-only "${LAST_SHA}..${CURRENT_SHA}" 2>/dev/null || echo "all")

REBUILD_API=false
REBUILD_WEB=false

if echo "$CHANGED_FILES" | grep -qE "^(app/|Dockerfile\.api|requirements)"; then
  REBUILD_API=true
fi
if echo "$CHANGED_FILES" | grep -qE "^(frontend/|Dockerfile\.frontend)"; then
  REBUILD_WEB=true
fi
# If we can't determine, rebuild both
if [ "$CHANGED_FILES" = "all" ]; then
  REBUILD_API=true
  REBUILD_WEB=true
fi

DEPLOY_OK=true

if [ "$REBUILD_API" = true ]; then
  echo "Rebuilding yourproject-api..." >> "$LOG_FILE"
  docker compose -f "$COMPOSE_FILE" build --no-cache yourproject-api >> "$LOG_FILE" 2>&1
  if [ $? -ne 0 ]; then
    echo "ERROR: API build failed!" >> "$LOG_FILE"
    "$NOTIFY" "DEPLOYER: API Docker build FAILED at $(date '+%H:%M')" >> "$LOG_FILE" 2>&1
    DEPLOY_OK=false
  else
    echo "Restarting yourproject-api..." >> "$LOG_FILE"
    docker compose -f "$COMPOSE_FILE" up -d yourproject-api >> "$LOG_FILE" 2>&1
  fi
fi

if [ "$REBUILD_WEB" = true ]; then
  echo "Rebuilding yourproject-web..." >> "$LOG_FILE"
  docker compose -f "$COMPOSE_FILE" build --no-cache yourproject-web >> "$LOG_FILE" 2>&1
  if [ $? -ne 0 ]; then
    echo "ERROR: Web build failed!" >> "$LOG_FILE"
    "$NOTIFY" "DEPLOYER: Web Docker build FAILED at $(date '+%H:%M')" >> "$LOG_FILE" 2>&1
    DEPLOY_OK=false
  else
    echo "Restarting yourproject-web..." >> "$LOG_FILE"
    docker compose -f "$COMPOSE_FILE" up -d yourproject-web >> "$LOG_FILE" 2>&1
  fi
fi

if [ "$REBUILD_API" = false ] && [ "$REBUILD_WEB" = false ]; then
  echo "No Docker-relevant files changed. Skipping rebuild." >> "$LOG_FILE"
fi

# Wait for containers to start, then health check
if [ "$REBUILD_API" = true ] || [ "$REBUILD_WEB" = true ]; then
  echo "Waiting 30s for containers to start..." >> "$LOG_FILE"
  sleep 30

  echo "Health checks:" >> "$LOG_FILE"
  API_STATUS=$(curl -sf -o /dev/null -w "%{http_code}" http://localhost:8080/ 2>/dev/null || echo "000")
  WEB_STATUS=$(curl -sf -o /dev/null -w "%{http_code}" http://localhost:8080/ 2>/dev/null || echo "000")

  echo "  API (port 8080): $API_STATUS" >> "$LOG_FILE"
  echo "  Web (port 9090): $WEB_STATUS" >> "$LOG_FILE"

  if [ "$API_STATUS" = "000" ] || [ "$WEB_STATUS" = "000" ]; then
    echo "WARNING: Some containers may not be healthy!" >> "$LOG_FILE"
    "$NOTIFY" "DEPLOYER: Containers unhealthy after deploy at $(date '+%H:%M')" >> "$LOG_FILE" 2>&1
    DEPLOY_OK=false
  fi
fi

# Record successful deploy SHA
if [ "$DEPLOY_OK" = true ]; then
  echo "$CURRENT_SHA" > "$LAST_DEPLOY_SHA_FILE"
  echo "Deploy successful. SHA recorded: $CURRENT_SHA" >> "$LOG_FILE"
else
  echo "Deploy had issues. SHA NOT recorded (will retry next run)." >> "$LOG_FILE"
fi

# ── Changelog ─────────────────────────────────────────────────────────
mkdir -p "$CHANGELOG_DIR"
TIMESTAMP=$(date '+%Y-%m-%d_%H%M')
CHANGELOG_FILE="${CHANGELOG_DIR}/deploy_${TIMESTAMP}.txt"
{
  echo "============================================"
  echo "  DEPLOY RUN — $(date)"
  echo "  Previous SHA: $LAST_SHA"
  echo "  Current SHA:  $CURRENT_SHA"
  echo "  Rebuilt API:  $REBUILD_API"
  echo "  Rebuilt Web:  $REBUILD_WEB"
  echo "  Success:      $DEPLOY_OK"
  echo "============================================"
  echo ""
  echo "COMMITS DEPLOYED:"
  git -C "$PROJECT_DIR" log --oneline "${LAST_SHA}..${CURRENT_SHA}" 2>/dev/null || echo "  (all)"
} > "$CHANGELOG_FILE"
echo "Changelog saved: $CHANGELOG_FILE" >> "$LOG_FILE"

echo "Deploy Finished: $(date)" >> "$LOG_FILE"
