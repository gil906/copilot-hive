#!/bin/bash
# ══════════════════════════════════════════════════════════════════════
#  Copilot Hive — Central Configuration
#  All agent scripts source this file for shared settings.
#  Customize these values for your project.
# ══════════════════════════════════════════════════════════════════════

# ── Load cross-platform compatibility library ────────────────────────
_CONFIG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${_CONFIG_DIR}/platform-detect.sh"

# ── Project Settings ─────────────────────────────────────────────────
export SCRIPTS_DIR="${SCRIPTS_DIR:-${_CONFIG_DIR}}"
export PROJECT_DIR="${PROJECT_DIR:-/opt/yourproject}"
export GH_REPO="${GH_REPO:-owner/yourproject}"

# ── Docker ───────────────────────────────────────────────────────────
export COMPOSE_FILE="${COMPOSE_FILE:-/opt/docker-compose/yourproject.yml}"
export CONTAINER_API="${CONTAINER_API:-yourproject-api}"
export CONTAINER_WEB="${CONTAINER_WEB:-yourproject-web}"
export CONTAINER_DB="${CONTAINER_DB:-yourproject-db}"

# ── URLs ─────────────────────────────────────────────────────────────
export HEALTH_URL="${HEALTH_URL:-http://localhost:8080/}"
export VERSION_URL="${VERSION_URL:-http://localhost:8080/api/version}"

# ── Database ─────────────────────────────────────────────────────────
export DB_USER="${DB_USER:-postgres}"
export DB_NAME="${DB_NAME:-yourproject}"

# ── Timeouts & Limits ────────────────────────────────────────────────
export DEPLOY_TIMEOUT="${DEPLOY_TIMEOUT:-1800}"
export STALE_AGENT_TIMEOUT="${STALE_AGENT_TIMEOUT:-3600}"
export MAX_FIX_RETRIES="${MAX_FIX_RETRIES:-2}"

# ── Orchestration Topology & Context-Mode ────────────────────────────
export HIVE_TOPOLOGY="${HIVE_TOPOLOGY:-adaptive-swarm}"
export CONTEXT_MODE_ENABLED="${CONTEXT_MODE_ENABLED:-true}"

# ── Paths (preserve per-project overrides from load-project.sh) ──────
export IDEAS_DIR="${IDEAS_DIR:-${SCRIPTS_DIR}/ideas}"
export CHANGELOG_DIR="${CHANGELOG_DIR:-${SCRIPTS_DIR}/changelogs}"
export LOG_DIR="${LOG_DIR:-${SCRIPTS_DIR}}"
export PIPELINE_STATUS_FILE="${PIPELINE_STATUS_FILE:-${SCRIPTS_DIR}/.pipeline-status}"
export STATUS_FILE="${STATUS_FILE:-${PIPELINE_STATUS_FILE}}"
export PAUSE_FILE="${PAUSE_FILE:-${SCRIPTS_DIR}/.agents-paused}"
export NOTIFY="${NOTIFY:-${SCRIPTS_DIR}/notify-smartthings.sh}"
export COPILOT="${COPILOT:-$(command -v copilot 2>/dev/null || echo /usr/local/bin/copilot)}"

# ── Agent Status (JSON telemetry file, distinct from .pipeline-status)
export AGENT_STATUS_FILE="${AGENT_STATUS_FILE:-${IDEAS_DIR}/agent_status.json}"

# ── Hive Health ──────────────────────────────────────────────────────
# The dispatcher writes a heartbeat to .dispatcher-heartbeat every run.
# Monitor with Uptime Kuma: check if file is <120s old
# Example: [ $(($(date +%s) - $(cat .dispatcher-heartbeat))) -lt 120 ]

# ── Ensure directories exist ─────────────────────────────────────────
mkdir -p "${IDEAS_DIR}" "${CHANGELOG_DIR}"
