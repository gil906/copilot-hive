#!/bin/bash

# ── Config ────────────────────────────────────────────────────────────────────
PROJECT_DIR="/opt/yourproject"
LOG_FILE="/opt/copilot-hive/copilot-audit.log"
COMPOSE_FILE="/opt/docker-compose/yourproject.yml"
NOTIFY="/opt/copilot-hive/notify-smartthings.sh"
CHANGELOG_DIR="/opt/copilot-hive/changelogs"
COPILOT="/usr/local/bin/copilot"

# ── Pause check ───────────────────────────────────────────────────────────────
PAUSE_FILE="/opt/copilot-hive/.agents-paused"
AGENT_PAUSE_FILE="/opt/copilot-hive/.agent-paused-audit"
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
a = data.setdefault('agents', {}).setdefault('audit', {})
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
  OVERRIDE_PROMPT="You are temporarily a DEVELOPER for Your Project. Your normal role is Auditor but the ADMIN has an urgent request.
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

PROMPT="You are the AUDITOR agent for Your Project (yourproject.example.com), a professional Docker-based web application security platform. You are part of an eight-agent autonomous team:

1. FEATURE ENGINEER — builds and implements features (runs every 3 hours, reads ideas from Radical, Lawyer & Compliance)
2. YOU (AUDITOR) — tests, audits, and fixes issues (runs 90 min after Feature Engineer)
3. EMERGENCY FIXER — called automatically if you or the Feature Engineer fail
4. RADICAL RESTRUCTURE — researches competitors, AI trends, and new features (runs daily)
5. LAWYER — researches legal compliance and competitor legal pages (runs daily)
6. COMPLIANCE OFFICER — audits compliance readiness, tracks certifications (runs every 12h)
7. REPORTER — sends daily/weekly email summaries
8. DEPLOYER (GitHub Actions) — deploys changes on push

Your job is to TEST, AUDIT, FIX, and ensure RELIABILITY.

The source code is in this directory. The docker-compose file is at ${COMPOSE_FILE}. Update both source code and docker-compose as needed.

YOUR ROLE:
You are the quality gatekeeper — a senior QA engineer, security auditor, and reliability specialist. You systematically test everything the Feature Engineer built (and anything that was already there), find every bug, broken flow, and issue, and FIX them all. You ensure the platform is rock-solid, professional, and production-ready.

YOUR RESPONSIBILITIES:

1. GUI TESTING — Click-test every page, button, form, link, modal, dropdown, tab, and interactive element. Find and fix broken interactions, dead links, missing feedback, JS errors, and confusing UX flows. Every user action must work correctly.

2. CODE REVIEW — Review recent changes and the full codebase for bugs, syntax errors, import errors, undefined variables, broken templates, missing dependencies, unhandled exceptions, and logic errors. Fix every issue you find.

3. SCANNER VALIDATION — Test that all scanner modules work correctly, return proper results, handle errors gracefully, and produce accurate severity ratings. Fix scanners that crash, timeout, or return incorrect data.

4. API TESTING — Test every API endpoint for correct responses, proper error handling, authentication enforcement, input validation, and CORS configuration. Fix broken or insecure endpoints.

5. CONTENT AUDIT — Check all pages for accuracy, completeness, and professionalism. Fix empty states, placeholder text, broken images, missing descriptions, and outdated content. Ensure every scan result includes: vulnerability name, description, severity, affected component, proof of concept, and remediation steps.

6. MOBILE TESTING — Verify all pages render correctly on mobile and tablet viewports. Fix layout breaks, overflow issues, unreadable text, untouchable buttons, and missing responsive styles.

7. PERFORMANCE & SECURITY — Find and fix slow queries, missing database indexes, memory leaks, unhandled errors, missing auth checks, CORS misconfigurations, and any security vulnerabilities in the codebase itself.

8. AUTO-FIX — Do not just report issues. Implement every fix directly in the codebase. After fixing, verify your fixes don't introduce new issues.

IMPORTANT RULES:
- Never break existing working features — always maintain backward compatibility
- Never delete data directories (data/, pgdata/, reports/, scans_db/)
- Never commit secrets or tokens
- Fix everything you find — do not just list problems
- Be thorough and systematic — the Feature Engineer depends on you to catch what they missed"

# ── Run ───────────────────────────────────────────────────────────────────────
echo "======================================" >> "$LOG_FILE"
echo "Audit Started: $(date)" >> "$LOG_FILE"

cd "$PROJECT_DIR" || { echo "ERROR: project dir not found: $PROJECT_DIR" >> "$LOG_FILE"; exit 1; }

# ── Build context from recent changes ─────────────────────────────────
RECENT_CHANGES=$(git -C "$PROJECT_DIR" log --oneline -10 2>/dev/null || echo "  (no git history)")
LAST_DIFF=$(git -C "$PROJECT_DIR" diff HEAD~1 --stat 2>/dev/null | tail -20)
LAST_MSG=$(git -C "$PROJECT_DIR" log -1 --pretty=format:"%s" 2>/dev/null || echo "  (no commits)")

CONTEXT=$(cat <<CTXEOF

RECENT HISTORY (last 10 commits — the team: Feature Engineer, Auditor, Emergency Fixer, Radical, Lawyer):
${RECENT_CHANGES}

LAST COMMIT BY YOUR PARTNER (the Feature Engineer):
${LAST_MSG}

FILES CHANGED IN LAST COMMIT:
${LAST_DIFF}

CRITICAL: You are a team with the Feature Engineer. Preserve their improvements whenever possible. However, if the Feature Engineer broke something — introduced bugs, syntax errors, broken pages, or regressions — you MUST fix or revert those specific changes to restore a working state. Your top priority is a stable, working application. Fix what's broken, keep what works.
CTXEOF
)

FULL_PROMPT="${PROMPT}${CONTEXT}"
update_agent_status "running" "Running Copilot CLI"
"$COPILOT" --prompt "$FULL_PROMPT" --yolo --allow-all-paths >> "$LOG_FILE" 2>&1

EXIT_CODE=$?
echo "Audit Finished: $(date) (exit code: $EXIT_CODE)" >> "$LOG_FILE"

if [ $EXIT_CODE -ne 0 ]; then
  "$NOTIFY" "YourProject AUDIT failed (update_agent_status "idle" "" "$EXIT_CODE"
exit $EXIT_CODE) at $(date '+%H:%M')" >> "$LOG_FILE" 2>&1
  echo "Calling Emergency Fixer agent..." >> "$LOG_FILE"
  /opt/copilot-hive/copilot-emergencyfixer.sh audit "$EXIT_CODE" >> "$LOG_FILE" 2>&1
fi

# ── Changelog ─────────────────────────────────────────────────────────
mkdir -p "$CHANGELOG_DIR"
TIMESTAMP=$(date '+%Y-%m-%d_%H%M')
CHANGELOG_FILE="${CHANGELOG_DIR}/audit_${TIMESTAMP}.txt"
{
  echo "============================================"
  echo "  AUDIT RUN — $(date)"
  echo "  Exit Code: $EXIT_CODE"
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
PUSHED="no"
BUILD_ID=""
if git -C "$PROJECT_DIR" status --porcelain | grep -q .; then
  BUILD_ID="$(date +%s)-$(head -c 4 /dev/urandom | xxd -p)"
  echo "$BUILD_ID" > "$PROJECT_DIR/.build-id"
  echo "Pushing changes to GitHub (build: $BUILD_ID)..." >> "$LOG_FILE"
  git -C "$PROJECT_DIR" add -A >> "$LOG_FILE" 2>&1
  git -C "$PROJECT_DIR" commit -m "auto: audit & fix $(date '+%Y-%m-%d %H:%M')" >> "$LOG_FILE" 2>&1
  git -C "$PROJECT_DIR" push origin main >> "$LOG_FILE" 2>&1
  PUSH_CODE=$?
  if [ $PUSH_CODE -eq 0 ]; then
    PUSHED="yes"
  else
    "$NOTIFY" "YourProject AUDIT git push failed at $(date '+%H:%M')" >> "$LOG_FILE" 2>&1
  fi
else
  echo "No changes to push." >> "$LOG_FILE"
fi

# ── Report to pipeline dispatcher ────────────────────────────────────
PIPELINE_FILE="/opt/copilot-hive/.pipeline-status"
if [ -f "$PIPELINE_FILE" ]; then
  source "$PIPELINE_FILE"
  if [ "$PUSHED" = "yes" ]; then
    COMMIT_SHA=$(git -C "$PROJECT_DIR" rev-parse HEAD 2>/dev/null)
    cat > "$PIPELINE_FILE" <<PEOF
PIPELINE_STATE=waiting_deploy
CURRENT_AGENT=
CURRENT_PID=
LAST_AGENT=audit
LAST_FINISHED=$(date +%s)
LAST_COMMIT=$COMMIT_SHA
LAST_BUILD_ID=$BUILD_ID
PUSH_TIME=$(date +%s)
DEPLOY_VERIFIED=no
NEXT_AGENT=${NEXT_AGENT:-improve}
PEOF
    echo "Pipeline: waiting for deploy (build: $BUILD_ID)" >> "$LOG_FILE"
  else
    cat > "$PIPELINE_FILE" <<PEOF
PIPELINE_STATE=idle
CURRENT_AGENT=
CURRENT_PID=
LAST_AGENT=audit
LAST_FINISHED=$(date +%s)
LAST_COMMIT=${LAST_COMMIT:-}
LAST_BUILD_ID=${LAST_BUILD_ID:-}
PUSH_TIME=${PUSH_TIME:-0}
DEPLOY_VERIFIED=yes
NEXT_AGENT=${NEXT_AGENT:-improve}
PEOF
    echo "Pipeline: idle (no changes pushed)" >> "$LOG_FILE"
  fi
fi

update_agent_status "idle" "" "$EXIT_CODE"
exit $EXIT_CODE
