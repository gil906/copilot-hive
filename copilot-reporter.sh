#!/bin/bash

# ── Config ────────────────────────────────────────────────────────────────────
PROJECT_DIR="/opt/yourproject"
LOG_FILE="/opt/copilot-hive/copilot-reporter.log"
CHANGELOG_DIR="/opt/copilot-hive/changelogs"
NOTIFY="/opt/copilot-hive/notify-smartthings.sh"
COPILOT="/usr/local/bin/copilot"

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

# ── Database stats (scan activity) ────────────────────────────────────
DB_CMD="docker exec yourproject-db psql -U dbuser -d yourproject -t -A"

if [ "$REPORT_TYPE" = "weekly" ]; then
  DATE_FILTER="created_at >= NOW() - INTERVAL '7 days'"
else
  DATE_FILTER="created_at >= NOW() - INTERVAL '1 day'"
fi

SCAN_STATS=$($DB_CMD -c "
  SELECT COUNT(*) || ' total, ' ||
         COUNT(DISTINCT target) || ' unique targets, ' ||
         COUNT(*) FILTER (WHERE status='completed') || ' completed, ' ||
         COUNT(*) FILTER (WHERE status='pending') || ' pending, ' ||
         COUNT(*) FILTER (WHERE status='failed') || ' failed'
  FROM scan_requests WHERE ${DATE_FILTER};
" 2>/dev/null || echo "unavailable")

SCAN_STATS_ALLTIME=$($DB_CMD -c "
  SELECT COUNT(*) || ' total scans, ' ||
         COUNT(DISTINCT target) || ' unique targets'
  FROM scan_requests;
" 2>/dev/null || echo "unavailable")

SCANNER_USAGE=$($DB_CMD -c "
  SELECT scanner || ': ' || COUNT(*) || ' times'
  FROM scan_requests, jsonb_array_elements_text(enabled_scanners::jsonb) AS scanner
  WHERE ${DATE_FILTER}
  GROUP BY scanner ORDER BY COUNT(*) DESC LIMIT 15;
" 2>/dev/null | tr '\n' ', ' || echo "unavailable")

SCANNER_USAGE_ALLTIME=$($DB_CMD -c "
  SELECT scanner || ': ' || COUNT(*) || ' times'
  FROM scan_requests, jsonb_array_elements_text(enabled_scanners::jsonb) AS scanner
  GROUP BY scanner ORDER BY COUNT(*) DESC;
" 2>/dev/null | tr '\n' ', ' || echo "unavailable")

TARGETS_SCANNED=$($DB_CMD -c "
  SELECT target || ' (' || scan_type || ', ' || status || ')'
  FROM scan_requests WHERE ${DATE_FILTER}
  ORDER BY created_at DESC LIMIT 20;
" 2>/dev/null | tr '\n' ', ' || echo "none")

VULN_BREAKDOWN=$($DB_CMD -c "
  SELECT severity || ': ' || COUNT(*)
  FROM vulnerabilities GROUP BY severity ORDER BY COUNT(*) DESC;
" 2>/dev/null | tr '\n' ', ' || echo "none")

TOTAL_VULNS=$($DB_CMD -c "SELECT COUNT(*) FROM vulnerabilities;" 2>/dev/null || echo "0")

FINDING_COUNTS=$($DB_CMD -c "
  SELECT target || ': ' || finding_count || ' findings'
  FROM scan_reports WHERE ${DATE_FILTER}
  ORDER BY created_at DESC LIMIT 10;
" 2>/dev/null | tr '\n' ', ' || echo "none")

PROMPT="You are the REPORTER agent for Your Project (yourproject.example.com). Your job is to compose a professional ${PERIOD} summary email.

You have the mailreporter MCP tool available. Use the send_report tool to send the email.

Generate a RICH HTML email with the following data and send it using the send_report tool. The email should be visually stunning with:
- Dark theme matching Your Project brand (background #0a0e1a, cards #1a1f35, accent #00d4ff)
- Inline CSS only (no external stylesheets)
- Summary statistics in colored metric cards
- A progress/activity bar showing the pipeline runs
- Bullet points for each commit with the commit message
- File change summary
- Container health status
- Color-coded: green for success, red for failures, blue for info

EMAIL SUBJECT: Your Project ${PERIOD} Report — $(date '+%b %d, %Y')

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

SCAN ACTIVITY (this ${PERIOD}):
${SCAN_STATS}

SCAN ACTIVITY (all time):
${SCAN_STATS_ALLTIME}

TARGETS SCANNED (this ${PERIOD}):
${TARGETS_SCANNED}

SCANNER TOOLS USED (this ${PERIOD}):
${SCANNER_USAGE}

SCANNER TOOLS USED (all time):
${SCANNER_USAGE_ALLTIME}

SCAN REPORTS (this ${PERIOD}):
${FINDING_COUNTS}

VULNERABILITY DATABASE:
- Total vulnerabilities tracked: ${TOTAL_VULNS}
- Severity breakdown: ${VULN_BREAKDOWN}

Include a SCAN ACTIVITY section in the email with:
- A metric card showing total scans, unique targets, and completed/pending/failed counts
- A list of targets scanned with their scan type and status
- A bar or list showing which scanner tools were used and how many times
- Vulnerability severity breakdown with colored badges (critical=red, high=orange, medium=yellow, low=blue, info=gray)

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
