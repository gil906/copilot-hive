#!/bin/bash

# Load central configuration
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/config.sh"

# ── Config ────────────────────────────────────────────────────────────────────
PROJECT_DIR="/opt/yourproject"
LOG_FILE="/opt/copilot-hive/copilot-reporter.log"
CHANGELOG_DIR="/opt/copilot-hive/changelogs"
NOTIFY="/opt/copilot-hive/notify-smartthings.sh"
COPILOT="/usr/local/bin/copilot"
DB_USER="${DB_USER:-postgres}"
DB_NAME="${DB_NAME:-yourproject}"
DB_CONTAINER="${DB_CONTAINER:-yourproject-db}"

# ── Pause check ───────────────────────────────────────────────────────────────
PAUSE_FILE="/opt/copilot-hive/.agents-paused"
AGENT_PAUSE_FILE="/opt/copilot-hive/.agent-paused-reporter"
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
a = data.setdefault('agents', {}).setdefault('reporter', {})
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
import tempfile, os as _os
tmp = f + '.tmp'
with open(tmp, 'w') as fh: json.dump(data, fh, indent=2)
_os.replace(tmp, f)
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
  OVERRIDE_PROMPT="You are temporarily a DEVELOPER for Your Project. Your normal role is Reporter but the ADMIN has an urgent request.
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

# Called with: copilot-reporter.sh <daily|weekly>
REPORT_TYPE="${1:-daily}"

# ── Gather data ───────────────────────────────────────────────────────────────
echo "======================================" >> "$LOG_FILE"
echo "Reporter Started: $(date) (type: $REPORT_TYPE)" >> "$LOG_FILE"

cd "$PROJECT_DIR" || { echo "ERROR: project dir not found" >> "$LOG_FILE"; exit 1; }

if [ "$REPORT_TYPE" = "weekly" ]; then
  SINCE="7 days ago"
  PERIOD="Weekly"
  MTIME_DAYS=7
else
  SINCE="1 day ago"
  PERIOD="Daily"
  MTIME_DAYS=1
fi

# Git stats
COMMIT_COUNT=$(git -C "$PROJECT_DIR" log --oneline --since="$SINCE" 2>/dev/null | wc -l)
COMMIT_LIST=$(git -C "$PROJECT_DIR" log --oneline --since="$SINCE" 2>/dev/null | head -30)
FILES_CHANGED=$(git -C "$PROJECT_DIR" diff --stat "$(git -C "$PROJECT_DIR" log -1 --before="$SINCE" --format=%H 2>/dev/null || echo HEAD~20)..HEAD" 2>/dev/null | tail -1 || echo "unknown")
AUTHORS=$(git -C "$PROJECT_DIR" log --since="$SINCE" --format="%an" 2>/dev/null | sort -u | tr '\n' ', ')
DIFF_SUMMARY=$(git -C "$PROJECT_DIR" diff --stat "$(git -C "$PROJECT_DIR" log -1 --before="$SINCE" --format=%H 2>/dev/null || echo HEAD~20)..HEAD" 2>/dev/null | head -30)

# Changelog summaries
if [ "$REPORT_TYPE" = "weekly" ]; then
  CHANGELOGS=$(find "$CHANGELOG_DIR" -name "*.txt" -mtime -7 2>/dev/null | sort)
else
  CHANGELOGS=$(find "$CHANGELOG_DIR" -name "*.txt" -mtime -1 2>/dev/null | sort)
fi
IMPROVE_RUNS=$(echo "$CHANGELOGS" | grep "improve_" | wc -l)
AUDIT_RUNS=$(echo "$CHANGELOGS" | grep "audit_" | wc -l)
EMERGENCY_RUNS=$(echo "$CHANGELOGS" | grep "emergencyfix_" | wc -l)
RADICAL_RUNS=$(find /opt/copilot-hive/ideas -name "radical_*.md" -not -name "radical_latest.md" -mtime -${MTIME_DAYS:-1} 2>/dev/null | wc -l)
LAWYER_RUNS=$(find /opt/copilot-hive/ideas -name "lawyer_*.md" -not -name "lawyer_latest.md" -mtime -${MTIME_DAYS:-1} 2>/dev/null | wc -l)
TOTAL_RUNS=$((IMPROVE_RUNS + AUDIT_RUNS + EMERGENCY_RUNS + RADICAL_RUNS + LAWYER_RUNS))
COMPLIANCE_RUNS=$(find /opt/copilot-hive/ideas -name "compliance_*.md" -not -name "compliance_latest.md" -mtime -${MTIME_DAYS:-1} 2>/dev/null | wc -l)

# Container status
CONTAINER_STATUS=$(docker ps --filter name=yourproject --format "{{.Names}}: {{.Status}}" 2>/dev/null)

# Log stats
IMPROVE_FAILURES=$(grep -c "IMPROVE failed" /opt/copilot-hive/copilot-improve.log 2>/dev/null || echo 0)
AUDIT_FAILURES=$(grep -c "AUDIT failed" /opt/copilot-hive/copilot-audit.log 2>/dev/null || echo 0)

# ── Database stats ─────────────────────────────────────────────────────
DB_CMD="docker exec ${DB_CONTAINER} psql -U ${DB_USER} -d ${DB_NAME} -t -A"

# Try to get activity stats from the database (tables vary by project)
ACTIVITY_STATS=$($DB_CMD -c "
  SELECT table_name FROM information_schema.tables 
  WHERE table_schema = 'public' ORDER BY table_name;
" 2>/dev/null || echo "unavailable")

RECENT_ACTIVITY=$($DB_CMD -c "
  SELECT schemaname, relname, n_tup_ins, n_tup_upd, n_tup_del 
  FROM pg_stat_user_tables ORDER BY n_tup_ins DESC LIMIT 10;
" 2>/dev/null || echo "unavailable")

DB_SIZE=$($DB_CMD -c "
  SELECT pg_size_pretty(pg_database_size(current_database()));
" 2>/dev/null || echo "unavailable")

# ── Generate HTML report from template ────────────────────────────────────────
generate_html_report() {
  local period="$1" git_stats="$2" container_stats="$3" agent_stats="$4"
  cat <<HTMLEOF
<!DOCTYPE html>
<html><head><style>
body{font-family:sans-serif;background:#1a1a2e;color:#e0e0e0;padding:20px}
h1{color:#00d4ff}h2{color:#7c3aed;border-bottom:1px solid #333;padding-bottom:8px}
table{border-collapse:collapse;width:100%;margin:10px 0}
td,th{border:1px solid #333;padding:8px;text-align:left}
th{background:#2d2d44}.ok{color:#22c55e}.warn{color:#f59e0b}.err{color:#ef4444}
.card{background:#2d2d44;border-radius:8px;padding:16px;margin:10px 0}
</style></head><body>
<h1>🐝 Copilot Hive — ${period} Report</h1>
<p>Generated: $(date '+%Y-%m-%d %H:%M UTC')</p>
<div class="card"><h2>📊 Git Activity</h2><pre>${git_stats}</pre></div>
<div class="card"><h2>🐳 Container Status</h2><pre>${container_stats}</pre></div>
<div class="card"><h2>🤖 Agent Activity</h2><pre>${agent_stats}</pre></div>
</body></html>
HTMLEOF
}

PROMPT="You are the REPORTER agent for the project at ${PROJECT_DIR}. Your job is to compose a professional ${PERIOD} summary email.

You have the mailreporter MCP tool available. Use the send_report tool to send the email.

Generate a RICH HTML email with the following data and send it using the send_report tool. The email should be visually stunning with:
- Dark theme (background #0a0e1a, cards #1a1f35, accent #00d4ff)
- Inline CSS only (no external stylesheets)
- Summary statistics in colored metric cards
- A progress/activity bar showing the pipeline runs
- Bullet points for each commit with the commit message
- File change summary
- Container health status
- Color-coded: green for success, red for failures, blue for info

EMAIL SUBJECT: ${PERIOD} Development Report — $(date '+%b %d, %Y')

DATA TO INCLUDE:

PERIOD: ${PERIOD} (${SINCE})

PIPELINE ACTIVITY:
- Total agent runs: ${TOTAL_RUNS}
- Feature Engineer runs: ${IMPROVE_RUNS}
- Auditor runs: ${AUDIT_RUNS}
- Emergency Fixer runs: ${EMERGENCY_RUNS}
- Radical Restructure runs: ${RADICAL_RUNS}
- Lawyer runs: ${LAWYER_RUNS}
- Compliance Officer runs: ${COMPLIANCE_RUNS}

GIT ACTIVITY:
- Commits: ${COMMIT_COUNT}
- Contributors: ${AUTHORS}
- Files summary: ${FILES_CHANGED}

COMMIT LOG:
${COMMIT_LIST}

FILE CHANGES:
${DIFF_SUMMARY}

CONTAINER STATUS:
${CONTAINER_STATUS}

FAILURE COUNTS (all time):
- Improve failures: ${IMPROVE_FAILURES}
- Audit failures: ${AUDIT_FAILURES}

DATABASE INFO:
- Tables: ${ACTIVITY_STATS}
- Recent activity: ${RECENT_ACTIVITY}
- Database size: ${DB_SIZE}

Include a DATABASE ACTIVITY section in the email with the table activity statistics.

Send the email now using the send_report MCP tool. Do not ask for confirmation."

# ── Run ───────────────────────────────────────────────────────────────────────
update_agent_status "running" "Running Copilot CLI"
"$COPILOT" --prompt "$PROMPT" --yolo --allow-all-paths >> "$LOG_FILE" 2>&1

EXIT_CODE=$?
echo "Reporter Finished: $(date) (exit code: $EXIT_CODE)" >> "$LOG_FILE"

if [ $EXIT_CODE -ne 0 ]; then
  "$NOTIFY" "REPORTER email failed (update_agent_status "idle" "" "$EXIT_CODE"
exit $EXIT_CODE) at $(date '+%H:%M')" >> "$LOG_FILE" 2>&1
fi

update_agent_status "idle" "" "$EXIT_CODE"
exit $EXIT_CODE
