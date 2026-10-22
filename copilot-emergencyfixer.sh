#!/bin/bash

# Load central configuration & shared agent helpers
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/config.sh"
source "${SCRIPT_DIR}/lib/agent-helpers.sh"
init_agent_env "emergencyfixer" "$@"

# ── Config ────────────────────────────────────────────────────────────────────
PROJECT_DIR="${PROJECT_DIR:-/opt/yourproject}"
COMPOSE_FILE="${COMPOSE_FILE:-/opt/docker-compose/yourproject.yml}"
CONTAINER_API="${CONTAINER_API:-yourproject-api}"
CONTAINER_WEB="${CONTAINER_WEB:-yourproject-web}"
CONTAINER_DB="${CONTAINER_DB:-yourproject-db}"
NOTIFY="${NOTIFY:-${SCRIPT_DIR}/notify-smartthings.sh}"
CHANGELOG_DIR="${CHANGELOG_DIR:-${SCRIPT_DIR}/changelogs}"
COPILOT="${COPILOT:-$(command -v copilot 2>/dev/null || echo /usr/local/bin/copilot)}"

# Called with: copilot-emergencyfixer.sh <which_agent> <exit_code>
FAILED_AGENT="${1:-unknown}"
FAILED_EXIT_CODE="${2:-1}"
FAILED_LOG="${LOG_DIR}/copilot-${FAILED_AGENT}${PROJECT_LOG_SUFFIX:-}.log"
ALERT_CONTEXT_FILE="${ALERT_CONTEXT_FILE:-${SCRIPTS_DIR}/.alert-context.json}"
PIPELINE_STATUS="${PIPELINE_STATUS_FILE:-${SCRIPTS_DIR}/.pipeline-status}"

check_agent_paused "emergencyfixer"
update_agent_status "emergencyfixer" "running" "Diagnosing ${FAILED_AGENT} failure (exit ${FAILED_EXIT_CODE})"

# ── Read alert context (written by health-webhook or dispatcher) ─────
ALERT_CONTEXT=""
if [ -f "$ALERT_CONTEXT_FILE" ]; then
  ALERT_CONTEXT=$(cat "$ALERT_CONTEXT_FILE" 2>/dev/null)
  echo "$(date) — Alert context: $ALERT_CONTEXT" >> "$LOG_FILE"
fi

# ── Read pipeline state to know what's going on ──────────────────────
PIPELINE_INFO=""
if [ -f "$PIPELINE_STATUS" ]; then
  PIPELINE_INFO=$(cat "$PIPELINE_STATUS" 2>/dev/null)
fi

# ── Gather container diagnostics ─────────────────────────────────────
CONTAINER_DIAG=$(cat <<DIAGEOF
CONTAINER STATUS:
$(docker ps -a --filter name="${CONTAINER_API%-*}" --format "{{.Names}}: {{.Status}} (restarts={{.RunningFor}})" 2>/dev/null)

API CONTAINER LOGS (last 30 lines):
$(docker logs "$CONTAINER_API" --tail 30 2>&1)

WEB CONTAINER LOGS (last 15 lines):
$(docker logs "$CONTAINER_WEB" --tail 15 2>&1)

DB CONTAINER LOGS (last 10 lines):
$(docker logs "$CONTAINER_DB" --tail 10 2>&1)

DOCKER HEALTH:
API: $(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER_API" 2>/dev/null || echo "unknown")
WEB: $(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER_WEB" 2>/dev/null || echo "unknown")
DB:  $(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER_DB" 2>/dev/null || echo "unknown")

HTTP CHECK:
$(curl -sf -o /dev/null -w "Website: %{http_code} (%{time_total}s)" --max-time 5 "${HEALTH_URL:-http://localhost:8080/}" 2>/dev/null || echo "Website: unreachable")
$(curl -sf -o /dev/null -w "API: %{http_code} (%{time_total}s)" --max-time 5 "${VERSION_URL:-http://localhost:8080/api/version}" 2>/dev/null || echo "API: unreachable")
DIAGEOF
)

# Write structured diagnostics to JSON for better context passing
python3 -c "
import json, subprocess, datetime
diag = {
    'timestamp': datetime.datetime.now().isoformat(),
    'failed_agent': '${FAILED_AGENT}',
    'exit_code': int('${FAILED_EXIT_CODE}') if '${FAILED_EXIT_CODE}'.isdigit() else 1,
    'containers': {},
    'http_checks': {}
}
for c in ['${CONTAINER_API}', '${CONTAINER_WEB}', '${CONTAINER_DB:-}']:
    if not c: continue
    try:
        s = subprocess.run(['docker', 'inspect', '-f', '{{.State.Status}}', c], capture_output=True, text=True, timeout=5)
        diag['containers'][c] = {'status': s.stdout.strip(), 'running': s.stdout.strip() == 'running'}
    except: diag['containers'][c] = {'status': 'unknown', 'running': False}
for name, url in [('website', '${HEALTH_URL:-http://localhost:8080/}'), ('api', '${VERSION_URL:-http://localhost:8080/api/version}')]:
    try:
        r = subprocess.run(['curl', '-sf', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '5', url], capture_output=True, text=True, timeout=10)
        diag['http_checks'][name] = {'url': url, 'status_code': r.stdout.strip()}
    except: diag['http_checks'][name] = {'url': url, 'status_code': 'timeout'}
with open('${SCRIPTS_DIR}/.diagnostics.json', 'w') as f: json.dump(diag, f, indent=2)
" 2>/dev/null

# ── Urgent Admin Ideas Check ─────────────────────────────────────────────────
handle_urgent_admin_idea "emergencyfixer" "Emergency Fixer" || true

# ── Load prompt from file if available ────────────────────────────────
PROMPT_FILE="${SCRIPTS_DIR}/prompts/emergency-fixer.md"
if [ -f "$PROMPT_FILE" ]; then
  PROMPT=$(cat "$PROMPT_FILE")
  echo "Loaded prompt from $PROMPT_FILE" >> "$LOG_FILE"
else
  # Fallback to inline prompt below
PROMPT="You are the EMERGENCY FIXER agent for the project at ${PROJECT_DIR}. You are part of an autonomous multi-agent team.

You have been called because something is BROKEN. Here is why:

TRIGGER: ${FAILED_AGENT^^} (exit code: ${FAILED_EXIT_CODE})

If trigger is 'health', it means the monitoring system detected a container/service failure for 20+ minutes and NO other agent was working on the issue. The alert context below tells you exactly which monitor failed.

The source code is in this directory. The docker-compose file is at ${COMPOSE_FILE}. Update both source code and docker-compose as needed.

YOUR ROLE:
You are the on-call incident responder — a senior DevOps engineer and debugger. You diagnose why the service is down and fix the root cause. You are surgical and precise — fix only what is broken, do not add features or refactor.

YOUR RESPONSIBILITIES:

1. DIAGNOSE — Read ALL the context below: alert details, container logs, error logs, pipeline state. Identify the exact root cause.

2. FIX ROOT CAUSE — Common issues: syntax errors, import failures, broken templates, Docker build failures, database errors, missing dependencies, crashed containers, port conflicts, memory limits, bad configs.

3. CONTAINER RECOVERY — If containers are crashed/looping:
   - Check docker logs for the error
   - Fix the code/config causing the crash
   - If needed, rebuild: cd /opt/docker-compose && docker compose -f ${COMPOSE_FILE} up -d --build
   - Verify containers come up healthy after your fix

4. VERIFY — After fixing, confirm: containers running, HTTP health checks passing, API responding.

5. MINIMAL CHANGES — Only fix what is broken. Do not add features.

IMPORTANT RULES:
- ONLY fix the failure — do not add features or make improvements
- Never break existing working features
- Never delete data directories (data/, pgdata/, reports/, or any persistent storage)
- Never commit secrets or tokens
- Be fast and precise — the team depends on you to unblock them"
fi  # end prompt file fallback

# Inject project-specific context if available
if [ -n "${PROJECT_CONTEXT:-}" ]; then
  PROMPT="${PROMPT}

═══════════════════════════════════════════════════════════════════════
PROJECT-SPECIFIC CONTEXT:
${PROJECT_CONTEXT}
═══════════════════════════════════════════════════════════════════════"
fi

# ── Run ───────────────────────────────────────────────────────────────────────
echo "======================================" >> "$LOG_FILE"
echo "Emergency Fix Started: $(date)" >> "$LOG_FILE"
echo "Failed agent: ${FAILED_AGENT}, exit code: ${FAILED_EXIT_CODE}" >> "$LOG_FILE"

cd "$PROJECT_DIR" || { echo "ERROR: project dir not found: $PROJECT_DIR" >> "$LOG_FILE"; exit 1; }

# ── Build context from failure ────────────────────────────────────────
RECENT_CHANGES=$(git -C "$PROJECT_DIR" log --oneline -10 2>/dev/null || echo "  (no git history)")
LAST_MSG=$(git -C "$PROJECT_DIR" log -1 --pretty=format:"%s" 2>/dev/null || echo "  (no commits)")
ERROR_TAIL=$(tail -100 "$FAILED_LOG" 2>/dev/null || echo "  (log not available)")

CONTEXT=$(cat <<CTXEOF

════════════════════════════════════════════════════════════════════
ALERT CONTEXT (from Uptime Kuma / dispatcher):
${ALERT_CONTEXT:-  (No alert context — called directly by another agent)}
════════════════════════════════════════════════════════════════════

════════════════════════════════════════════════════════════════════
PIPELINE STATE (who was working, what happened):
${PIPELINE_INFO:-  (No pipeline info)}
════════════════════════════════════════════════════════════════════

════════════════════════════════════════════════════════════════════
LIVE CONTAINER DIAGNOSTICS:
${CONTAINER_DIAG}
════════════════════════════════════════════════════════════════════

RECENT COMMITS (last 10):
${RECENT_CHANGES}

LAST COMMIT:
${LAST_MSG}

ERROR LOG (last 100 lines from ${FAILED_AGENT^^} agent):
${ERROR_TAIL}
CTXEOF
)

FULL_PROMPT="${PROMPT}${CONTEXT}"
"$COPILOT" --prompt "$FULL_PROMPT" --yolo --allow-all-paths >> "$LOG_FILE" 2>&1

EXIT_CODE=$?
echo "Emergency Fix Finished: $(date) (exit code: $EXIT_CODE)" >> "$LOG_FILE"

if [ $EXIT_CODE -ne 0 ]; then
  "$NOTIFY" "EMERGENCY FIXER also failed (exit $EXIT_CODE) — manual intervention needed!" >> "$LOG_FILE" 2>&1
fi

# ── Changelog ─────────────────────────────────────────────────────────
mkdir -p "$CHANGELOG_DIR"
TIMESTAMP=$(date '+%Y-%m-%d_%H%M')
CHANGELOG_FILE="${CHANGELOG_DIR}/emergencyfix_${TIMESTAMP}.txt"
{
  echo "============================================"
  echo "  EMERGENCY FIX RUN — $(date)"
  echo "  Failed Agent: ${FAILED_AGENT}"
  echo "  Failed Exit Code: ${FAILED_EXIT_CODE}"
  echo "  Fixer Exit Code: $EXIT_CODE"
  echo "============================================"
  echo ""
  echo "FILES CHANGED:"
  git -C "$PROJECT_DIR" diff --name-status HEAD 2>/dev/null || echo "  (no git diff available)"
  echo ""
  echo "DIFF SUMMARY:"
  git -C "$PROJECT_DIR" diff --stat HEAD 2>/dev/null || echo "  (no stats available)"
  echo ""
  echo "DETAILED CHANGES:"
  git -C "$PROJECT_DIR" diff HEAD 2>/dev/null | head -500
  echo ""
  echo "(truncated to 500 lines — see full log at $LOG_FILE)"
} > "$CHANGELOG_FILE"
echo "Changelog saved: $CHANGELOG_FILE" >> "$LOG_FILE"

# ── Git push changes ─────────────────────────────────────────────────
if git -C "$PROJECT_DIR" status --porcelain | grep -q .; then
  BUILD_ID="$(generate_build_id emergency)"
  echo "$BUILD_ID" > "$PROJECT_DIR/.build-id"
  echo "Pushing emergency fix to GitHub (build: $BUILD_ID)..." >> "$LOG_FILE"
  git -C "$PROJECT_DIR" add -A >> "$LOG_FILE" 2>&1
  git -C "$PROJECT_DIR" commit -m "auto: emergency fix for ${FAILED_AGENT} failure (exit ${FAILED_EXIT_CODE}) $(date '+%Y-%m-%d %H:%M')" >> "$LOG_FILE" 2>&1
  git -C "$PROJECT_DIR" push origin main >> "$LOG_FILE" 2>&1
  PUSH_CODE=$?
  if [ $PUSH_CODE -ne 0 ]; then
    "$NOTIFY" "EMERGENCY FIXER git push failed — manual intervention needed!" >> "$LOG_FILE" 2>&1
  fi
else
  echo "No changes to push." >> "$LOG_FILE"
fi

index_agent_output "emergencyfixer" "$CHANGELOG_FILE"
update_agent_status "emergencyfixer" "idle" "" "$EXIT_CODE"

# Clean up alert context after handling
rm -f "$ALERT_CONTEXT_FILE" 2>/dev/null

exit $EXIT_CODE