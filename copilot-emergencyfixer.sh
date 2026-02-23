#!/bin/bash

# ── Config ────────────────────────────────────────────────────────────────────
PROJECT_DIR="/opt/yourproject"
LOG_FILE="/opt/copilot-hive/copilot-emergencyfixer.log"
COMPOSE_FILE="/opt/docker-compose/yourproject.yml"
NOTIFY="/opt/copilot-hive/notify-smartthings.sh"
CHANGELOG_DIR="/opt/copilot-hive/changelogs"
COPILOT="/usr/local/bin/copilot"

# Called with: copilot-emergencyfixer.sh <which_agent> <exit_code>
FAILED_AGENT="${1:-unknown}"
FAILED_EXIT_CODE="${2:-1}"
FAILED_LOG="/opt/copilot-hive/copilot-${FAILED_AGENT}.log"
ALERT_CONTEXT_FILE="/opt/copilot-hive/.alert-context.json"
PIPELINE_STATUS="/opt/copilot-hive/.pipeline-status"

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
$(docker ps -a --filter name=yourproject --format "{{.Names}}: {{.Status}} (restarts={{.RunningFor}})" 2>/dev/null)

API CONTAINER LOGS (last 30 lines):
$(docker logs yourproject-api --tail 30 2>&1)

WEB CONTAINER LOGS (last 15 lines):
$(docker logs yourproject-web --tail 15 2>&1)

DB CONTAINER LOGS (last 10 lines):
$(docker logs yourproject-db --tail 10 2>&1)

DOCKER HEALTH:
API: $(docker inspect -f '{{.State.Health.Status}}' yourproject-api 2>/dev/null || echo "unknown")
WEB: $(docker inspect -f '{{.State.Health.Status}}' yourproject-web 2>/dev/null || echo "unknown")
DB:  $(docker inspect -f '{{.State.Health.Status}}' yourproject-db 2>/dev/null || echo "unknown")

HTTP CHECK:
$(curl -sf -o /dev/null -w "Website: %{http_code} (%{time_total}s)" --max-time 5 http://localhost:8080/ 2>/dev/null || echo "Website: unreachable")
$(curl -sf -o /dev/null -w "API: %{http_code} (%{time_total}s)" --max-time 5 http://localhost:8080/api/version 2>/dev/null || echo "API: unreachable")
DIAGEOF
)

# ── Pause check ───────────────────────────────────────────────────────────────
PAUSE_FILE="/opt/copilot-hive/.agents-paused"
AGENT_PAUSE_FILE="/opt/copilot-hive/.agent-paused-emergencyfixer"
if [ -f "$PAUSE_FILE" ] || [ -f "$AGENT_PAUSE_FILE" ]; then
  echo "$(date) — SKIPPED: Agent paused by admin" >> "$LOG_FILE"
  exit 0
fi

# ── Agent Status Helper ──────────────────────────────────────────────────────
STATUS_FILE="/opt/copilot-hive/ideas/agent_status.json"
update_agent_status() {
  local st="$1" step="$2" ec="${3:-}"
  python3 -c "
import json, datetime
f='${STATUS_FILE}'
try:
    with open(f) as fh: data = json.load(fh)
except: data = {'agents': {}}
a = data.setdefault('agents', {}).setdefault('emergencyfixer', {})
a['status'] = '$st'
if '$st' == 'running':
    a['started_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    a['finished_at'] = None
if '$step':
    a['current_step'] = '$step'
elif '$st' == 'idle':
    a['current_step'] = None
    a['finished_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
if '$ec':
    try: a['last_exit_code'] = int('$ec')
    except: pass
with open(f, 'w') as fh: json.dump(data, fh, indent=2)
" 2>/dev/null
}

update_agent_status "running" "Starting up"

# ── Urgent Admin Ideas Check ─────────────────────────────────────────────────
_IDEAS_DIR="/opt/copilot-hive/ideas"
URGENT_IDEA=$(python3 -c "
import json
try:
    with open('${_IDEAS_DIR}/admin_ideas.json') as f:
        data = json.load(f)
    urgent = [i for i in data.get('ideas',[]) if i.get('urgent') and i.get('status')=='pending']
    if urgent:
        idea = urgent[0]
        print(idea['title'] + '|||' + idea['description'] + '|||' + idea['id'])
except: pass
" 2>/dev/null)

if [ -n "$URGENT_IDEA" ]; then
  URGENT_TITLE=$(echo "$URGENT_IDEA" | cut -d'|||' -f1)
  URGENT_DESC=$(echo "$URGENT_IDEA" | cut -d'|||' -f2)
  URGENT_ID=$(echo "$URGENT_IDEA" | cut -d'|||' -f3)
  echo "$(date) — URGENT ADMIN IDEA: $URGENT_TITLE" >> "$LOG_FILE"
  update_agent_status "running" "Urgent admin request: $URGENT_TITLE"
  OVERRIDE_PROMPT="You are temporarily a DEVELOPER for Your Project. Your normal role is Emergency Fixer but the ADMIN has an urgent request.
The source code is at ${PROJECT_DIR}. Docker-compose at /opt/docker-compose/yourproject.yml.
URGENT: ${URGENT_TITLE}
Details: ${URGENT_DESC}
RULES: Implement completely. Do not break existing functionality."
  cd "$PROJECT_DIR"
  "$COPILOT" --prompt "$OVERRIDE_PROMPT" --yolo --allow-all-paths >> "$LOG_FILE" 2>&1
  URGENT_EXIT=$?
  if [ $URGENT_EXIT -eq 0 ]; then
    python3 -c "
import json, datetime
with open('${_IDEAS_DIR}/admin_ideas.json') as f: data = json.load(f)
for i in data['ideas']:
    if i['id'] == '$URGENT_ID':
        i['status'] = 'implemented'; i['urgent'] = False
        i['implemented_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        break
with open('${_IDEAS_DIR}/admin_ideas.json', 'w') as f: json.dump(data, f, indent=2)
" 2>/dev/null
    echo "✅ DONE | $(date '%Y-%m-%d %H:%M') | admin | $URGENT_TITLE" >> "${_IDEAS_DIR}/implemented.log"
  fi
  if git -C "$PROJECT_DIR" status --porcelain | grep -q .; then
    git -C "$PROJECT_DIR" add -A
    git -C "$PROJECT_DIR" commit -m "urgent: admin request — $URGENT_TITLE

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
    git -C "$PROJECT_DIR" push origin main 2>&1 || true
  fi
fi

PROMPT="You are the EMERGENCY FIXER agent for Your Project (yourproject.example.com), a professional Docker-based web application security platform. You are part of an eleven-agent autonomous team.

You have been called because something is BROKEN. Here is why:

TRIGGER: ${FAILED_AGENT^^} (exit code: ${FAILED_EXIT_CODE})

If trigger is 'health', it means Uptime Kuma detected a container/service failure for 20+ minutes and NO other agent was working on the issue. The alert context below tells you exactly which monitor failed.

The source code is in this directory. The docker-compose file is at ${COMPOSE_FILE}. Update both source code and docker-compose as needed.

YOUR ROLE:
You are the on-call incident responder — a senior DevOps engineer and debugger. You diagnose why the service is down and fix the root cause. You are surgical and precise — fix only what is broken, do not add features or refactor.

YOUR RESPONSIBILITIES:

1. DIAGNOSE — Read ALL the context below: alert details, container logs, error logs, pipeline state. Identify the exact root cause.

2. FIX ROOT CAUSE — Common issues: Python syntax errors, import failures, broken templates, Docker build failures, database errors, missing dependencies, crashed containers, port conflicts, memory limits, bad configs.

3. CONTAINER RECOVERY — If containers are crashed/looping:
   - Check docker logs for the error
   - Fix the code/config causing the crash
   - If needed, rebuild: cd /opt/docker-compose && docker compose -f yourproject.yml up -d --build
   - Verify containers come up healthy after your fix

4. VERIFY — After fixing, confirm: containers running, HTTP 200 on port 9090, /api/version responding.

5. MINIMAL CHANGES — Only fix what is broken. Do not add features.

IMPORTANT RULES:
- ONLY fix the failure — do not add features or make improvements
- Never break existing working features
- Never delete data directories (data/, pgdata/, reports/, scans_db/)
- Never commit secrets or tokens
- Be fast and precise — the team depends on you to unblock them"

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
  "$NOTIFY" "EMERGENCY FIXER also failed (update_agent_status "idle" "" "$EXIT_CODE"
exit $EXIT_CODE) — manual intervention needed!" >> "$LOG_FILE" 2>&1
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
  BUILD_ID="$(date +%s)-emergency"
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

update_agent_status "idle" "" "$EXIT_CODE"

# Clean up alert context after handling
rm -f "$ALERT_CONTEXT_FILE" 2>/dev/null

exit $EXIT_CODE