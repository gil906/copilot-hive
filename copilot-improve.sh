#!/bin/bash

# ── Config ────────────────────────────────────────────────────────────────────
PROJECT_DIR="/opt/yourproject"
LOG_FILE="/opt/copilot-hive/copilot-improve.log"
COMPOSE_FILE="/opt/docker-compose/yourproject.yml"
NOTIFY="/opt/copilot-hive/notify-smartthings.sh"
CHANGELOG_DIR="/opt/copilot-hive/changelogs"
IDEAS_DIR="/opt/copilot-hive/ideas"
COPILOT="/usr/local/bin/copilot"

# ── Pause check ───────────────────────────────────────────────────────────────
PAUSE_FILE="/opt/copilot-hive/.agents-paused"
AGENT_PAUSE_FILE="/opt/copilot-hive/.agent-paused-improve"
if [ -f "$PAUSE_FILE" ] || [ -f "$AGENT_PAUSE_FILE" ]; then
  echo "$(date) — SKIPPED: Agent paused by admin" >> "$LOG_FILE"
  exit 0
fi

# ── Agent Status Helper ──────────────────────────────────────────────────────
STATUS_FILE="/opt/copilot-hive/ideas/agent_status.json"
update_agent_status() {
  local agent_id="$1"
  local status="$2"
  local step="$3"
  local exit_code="${4:-}"
  python3 -c "
import json, datetime, os
f='${STATUS_FILE}'
try:
    with open(f) as fh: data = json.load(fh)
except: data = {'agents': {}}
a = data.setdefault('agents', {}).setdefault('${1}', {})
a['status'] = '${2}'
if '${2}' == 'running':
    a['started_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    a['finished_at'] = None
elif '${2}' == 'idle':
    a['finished_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
step = '''${3}'''
if step:
    a['current_step'] = step
elif '${2}' == 'idle':
    a['current_step'] = None
ec = '${4}'
if ec:
    try: a['last_exit_code'] = int(ec)
    except: pass
with open(f, 'w') as fh: json.dump(data, fh, indent=2)
" 2>/dev/null
}

update_agent_status "improve" "running" "Starting up"

# ── Urgent Admin Ideas Check ─────────────────────────────────────────────────
URGENT_IDEA=$(python3 -c "
import json
try:
    with open('${IDEAS_DIR}/admin_ideas.json') as f:
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

  echo "$(date) — URGENT ADMIN IDEA detected: $URGENT_TITLE" >> "$LOG_FILE"
  update_agent_status "improve" "running" "Implementing urgent admin request: $URGENT_TITLE"

  OVERRIDE_PROMPT="You are the FEATURE ENGINEER for Your Project (yourproject.example.com). The ADMIN has submitted an URGENT request. Implement it NOW.

The source code is at ${PROJECT_DIR}. The docker-compose is at ${COMPOSE_FILE}.

URGENT ADMIN REQUEST:
Title: ${URGENT_TITLE}
Description: ${URGENT_DESC}

RULES:
- Implement this request completely and correctly
- This is your ONLY task — do nothing else
- Do not break existing functionality
- When done, your changes will be committed and pushed by the script"

  cd "$PROJECT_DIR"
  "$COPILOT" --prompt "$OVERRIDE_PROMPT" --yolo --allow-all-paths >> "$LOG_FILE" 2>&1
  URGENT_EXIT=$?

  if [ $URGENT_EXIT -eq 0 ]; then
    python3 -c "
import json, datetime
with open('${IDEAS_DIR}/admin_ideas.json') as f: data = json.load(f)
for i in data['ideas']:
    if i['id'] == '$URGENT_ID':
        i['status'] = 'implemented'
        i['urgent'] = False
        i['implemented_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        break
with open('${IDEAS_DIR}/admin_ideas.json', 'w') as f: json.dump(data, f, indent=2)
" 2>/dev/null
    echo "✅ DONE | $(date '+%Y-%m-%d %H:%M') | admin | $URGENT_TITLE" >> "${IDEAS_DIR}/implemented.log"
  fi

  if git -C "$PROJECT_DIR" status --porcelain | grep -q .; then
    git -C "$PROJECT_DIR" add -A
    git -C "$PROJECT_DIR" commit -m "urgent: admin request — $URGENT_TITLE

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
    git -C "$PROJECT_DIR" push origin main 2>&1 || true
  fi
fi

PROMPT="You are the DEVELOPER agent for Your Project (yourproject.example.com), a professional Docker-based web application security platform. You are part of an eleven-agent autonomous team:

1. YOU (DEVELOPER) — the ONLY agent that writes code. Implements ALL ideas from research agents.
2. AUDITOR — tests, audits, and fixes issues (runs after you in the pipeline)
3. EMERGENCY FIXER — called automatically on failures
4. WEBSITE DESIGNER — analyzes public website UX, animations, conversions (writes web_design_latest.md)
5. PORTAL DESIGNER — analyzes logged-in portal, dashboard, admin panel (writes portal_design_latest.md)
6. API ARCHITECT — analyzes backend, scanners, orchestration, performance (writes api_architect_latest.md)
7. RADICAL RESTRUCTURE — researches competitors, AI trends (writes radical_latest.md)
8. LAWYER — researches legal compliance (writes lawyer_latest.md)
9. COMPLIANCE OFFICER — audits certifications (writes compliance_latest.md)
10. REPORTER — sends daily/weekly email summaries
11. DEPLOYER (GitHub Actions) — deploys changes on push

Your job is to IMPLEMENT every idea from all 6 research agents as fast as possible.

The source code is in this directory. The docker-compose file is at ${COMPOSE_FILE}. Update both source code and docker-compose as needed.

YOUR ROLE:
You are the creative builder — a senior full-stack developer and product designer specializing in cybersecurity tools. You design, implement, and ship new features and improvements. You think like a product manager at companies like Cybri, Pentest-Tools, Astra, and Attaxion and push this platform to match or exceed them.

YOUR RESPONSIBILITIES:

1. NEW FEATURES — Implement missing capabilities: vulnerability scanner dashboard, asset discovery, subdomain enumeration, port scanning UI, SSL/TLS checks, CVE lookup, OWASP Top 10 checks, API security testing, report generation (PDF/HTML), scheduled scans, risk scoring, remediation guidance, attack surface mapping, real-time alerts, scan comparison, and trend analysis.

2. UI/UX IMPROVEMENTS — Make the interface more professional, polished, and intuitive. Improve navigation, add smooth animations and transitions, enhance data visualizations (charts, graphs, severity breakdowns), improve empty states, and ensure every page looks production-ready.

3. MOBILE EXPERIENCE — Ensure every page and feature works flawlessly on phones and tablets. Touch-friendly controls, responsive layouts, proper font sizes, no horizontal scrolling, collapsible menus, and swipe-friendly interfaces.

4. API & BACKEND — Add new API endpoints, improve existing ones, optimize database queries, add proper error handling, implement caching where beneficial, and ensure all endpoints return consistent, well-documented responses.

5. SCANNER UPGRADES — Make the vulnerability scanner smarter, faster, and more comprehensive. Add new scan modules, improve detection accuracy, add CVSS severity scoring, reduce false positives, and enrich scan results with detailed remediation steps.

6. ARCHITECTURE & DESIGN — Improve code organization, add missing abstractions, optimize performance, enhance the Docker setup, and ensure clean separation of concerns.

7. QUALITY CHECK — Before finishing, review your own changes for syntax errors, import errors, broken templates, missing dependencies, and logical bugs. Run a mental code review. Your partner (the Auditor) will catch issues too, but deliver clean work.

IMPORTANT RULES:
- Never break existing working features — always maintain backward compatibility
- Never delete data directories (data/, pgdata/, reports/, scans_db/)
- Never commit secrets or tokens
- Implement changes directly — do not just suggest or describe them
- Think big but ship incrementally — each run should deliver tangible improvements
- READ the ideas files from the Radical, Lawyer, and Compliance agents (provided below) and implement their best suggestions
- Prioritize HIGH PRIORITY items from all agents, but use your judgment on what to build each cycle
- Implement AT LEAST 5-8 ideas or improvements per run — you have time, be productive
- Mix big features (1-2 per run) with smaller improvements (4-6 quick wins: UI polish, new endpoints, scanner tweaks, content fixes)
- AFTER implementing an idea, mark it as done in ${IDEAS_DIR}/implemented.log using this format:
    ✅ DONE | [date] | [agent: radical/lawyer/compliance] | [idea summary]
  This tells all research agents that the idea has been implemented so they stop suggesting it."

# ── Run ───────────────────────────────────────────────────────────────────────
echo "======================================" >> "$LOG_FILE"
echo "Started: $(date)" >> "$LOG_FILE"

cd "$PROJECT_DIR" || { echo "ERROR: project dir not found: $PROJECT_DIR" >> "$LOG_FILE"; exit 1; }

# ── Build context from recent changes ─────────────────────────────────
RECENT_CHANGES=$(git -C "$PROJECT_DIR" log --oneline -10 2>/dev/null || echo "  (no git history)")
LAST_DIFF=$(git -C "$PROJECT_DIR" diff HEAD~1 --stat 2>/dev/null | tail -20)
LAST_MSG=$(git -C "$PROJECT_DIR" log -1 --pretty=format:"%s" 2>/dev/null || echo "  (no commits)")

# ── Read ideas from research agents ──────────────────────────────────
RADICAL_IDEAS=""
if [ -f "${IDEAS_DIR}/radical_latest.md" ]; then
  RADICAL_IDEAS=$(head -200 "${IDEAS_DIR}/radical_latest.md" 2>/dev/null)
  echo "Loaded Radical Restructure ideas ($(wc -l < "${IDEAS_DIR}/radical_latest.md") lines)" >> "$LOG_FILE"
fi

LAWYER_IDEAS=""
if [ -f "${IDEAS_DIR}/lawyer_latest.md" ]; then
  LAWYER_IDEAS=$(head -200 "${IDEAS_DIR}/lawyer_latest.md" 2>/dev/null)
  echo "Loaded Lawyer recommendations ($(wc -l < "${IDEAS_DIR}/lawyer_latest.md") lines)" >> "$LOG_FILE"
fi

COMPLIANCE_IDEAS=""
if [ -f "${IDEAS_DIR}/compliance_latest.md" ]; then
  COMPLIANCE_IDEAS=$(head -200 "${IDEAS_DIR}/compliance_latest.md" 2>/dev/null)
  echo "Loaded Compliance requirements ($(wc -l < "${IDEAS_DIR}/compliance_latest.md") lines)" >> "$LOG_FILE"
fi

WEB_DESIGN_IDEAS=""
if [ -f "${IDEAS_DIR}/web_design_latest.md" ]; then
  WEB_DESIGN_IDEAS=$(head -200 "${IDEAS_DIR}/web_design_latest.md" 2>/dev/null)
  echo "Loaded Website Designer ideas ($(wc -l < "${IDEAS_DIR}/web_design_latest.md") lines)" >> "$LOG_FILE"
fi

PORTAL_DESIGN_IDEAS=""
if [ -f "${IDEAS_DIR}/portal_design_latest.md" ]; then
  PORTAL_DESIGN_IDEAS=$(head -200 "${IDEAS_DIR}/portal_design_latest.md" 2>/dev/null)
  echo "Loaded Portal Designer ideas ($(wc -l < "${IDEAS_DIR}/portal_design_latest.md") lines)" >> "$LOG_FILE"
fi

API_ARCHITECT_IDEAS=""
if [ -f "${IDEAS_DIR}/api_architect_latest.md" ]; then
  API_ARCHITECT_IDEAS=$(head -200 "${IDEAS_DIR}/api_architect_latest.md" 2>/dev/null)
  echo "Loaded API Architect ideas ($(wc -l < "${IDEAS_DIR}/api_architect_latest.md") lines)" >> "$LOG_FILE"
fi

DASHBOARD_IDEAS=""
if [ -f "${IDEAS_DIR}/agent_dashboard.md" ]; then
  DASHBOARD_IDEAS=$(cat "${IDEAS_DIR}/agent_dashboard.md" 2>/dev/null)
  echo "Loaded Agent Dashboard requirements ($(wc -l < "${IDEAS_DIR}/agent_dashboard.md") lines)" >> "$LOG_FILE"
fi

ADMIN_IDEAS=""
if [ -f "${IDEAS_DIR}/admin_ideas.json" ]; then
  ADMIN_IDEAS=$(python3 -c "
import json
with open('${IDEAS_DIR}/admin_ideas.json') as f:
    data = json.load(f)
pending = [i for i in data.get('ideas',[]) if i.get('status')=='pending' and not i.get('urgent')]
for i in pending:
    print('ADMIN REQUEST (' + i.get('priority','critical').upper() + '): ' + i['title'])
    if i.get('description'): print('   ' + i['description'][:200])
    print()
" 2>/dev/null)
  echo "Loaded admin ideas" >> "$LOG_FILE"
fi

IMPLEMENTED_LOG=""
if [ -f "${IDEAS_DIR}/implemented.log" ]; then
  IMPLEMENTED_LOG=$(tail -50 "${IDEAS_DIR}/implemented.log" 2>/dev/null)
  echo "Loaded implemented log ($(wc -l < "${IDEAS_DIR}/implemented.log") lines)" >> "$LOG_FILE"
fi

CONTEXT=$(cat <<CTXEOF

════════════════════════════════════════════════════════════════════
ADMIN REQUESTS (IMPLEMENT THESE FIRST — highest priority):
${ADMIN_IDEAS:-  (No admin requests)}
════════════════════════════════════════════════════════════════════

RECENT HISTORY (last 10 commits — the team: Feature Engineer, Auditor, Emergency Fixer, Radical, Lawyer):
${RECENT_CHANGES}

LAST COMMIT BY YOUR PARTNER (the Auditor):
${LAST_MSG}

FILES CHANGED IN LAST COMMIT:
${LAST_DIFF}

════════════════════════════════════════════════════════════════════
IDEAS FROM RADICAL RESTRUCTURE AGENT (competitor research & AI trends):
${RADICAL_IDEAS:-  (No ideas file yet — the Radical agent hasn't run or produced output yet)}
════════════════════════════════════════════════════════════════════

════════════════════════════════════════════════════════════════════
RECOMMENDATIONS FROM LAWYER AGENT (legal compliance & content):
${LAWYER_IDEAS:-  (No legal recommendations yet — the Lawyer agent hasn't run or produced output yet)}
════════════════════════════════════════════════════════════════════

════════════════════════════════════════════════════════════════════
REQUIREMENTS FROM COMPLIANCE OFFICER (certification readiness & gaps):
${COMPLIANCE_IDEAS:-  (No compliance requirements yet — the Compliance agent hasn't run or produced output yet)}
════════════════════════════════════════════════════════════════════

════════════════════════════════════════════════════════════════════
🎨 IDEAS FROM WEBSITE DESIGNER (public website UX, animations, conversions):
${WEB_DESIGN_IDEAS:-  (No website design ideas yet)}
════════════════════════════════════════════════════════════════════

════════════════════════════════════════════════════════════════════
🖥️ IDEAS FROM PORTAL DESIGNER (dashboard, scan UI, admin panel, data viz):
${PORTAL_DESIGN_IDEAS:-  (No portal design ideas yet)}
════════════════════════════════════════════════════════════════════

════════════════════════════════════════════════════════════════════
⚙️ IDEAS FROM API ARCHITECT (scanners, orchestration, performance, Docker):
${API_ARCHITECT_IDEAS:-  (No API architecture ideas yet)}
════════════════════════════════════════════════════════════════════

════════════════════════════════════════════════════════════════════
🔴 CRITICAL: AGENT DASHBOARD (admin requested this directly — implement ASAP):
${DASHBOARD_IDEAS:-  (No agent dashboard requirements)}
════════════════════════════════════════════════════════════════════

CRITICAL: Do NOT revert or undo changes made by the Auditor. Build ON TOP of their fixes. If they fixed a bug, keep that fix. If they restructured something, work with that structure. You are a team.

RESEARCH AGENTS: Review the ideas from Radical, Lawyer, and Compliance above. Pick the best 1-3 actionable items to implement this cycle. Prioritize HIGH PRIORITY and CRITICAL items. Skip anything already in the IMPLEMENTED LOG below.

AFTER implementing each idea, append a line to ${IDEAS_DIR}/implemented.log:
  ✅ DONE | $(date '+%Y-%m-%d %H:%M') | web-designer | [brief description]
  ✅ DONE | $(date '+%Y-%m-%d %H:%M') | portal-designer | [brief description]
  ✅ DONE | $(date '+%Y-%m-%d %H:%M') | api-architect | [brief description]
  ✅ DONE | $(date '+%Y-%m-%d %H:%M') | radical | [brief description]
  ✅ DONE | $(date '+%Y-%m-%d %H:%M') | lawyer | [brief description]
  ✅ DONE | $(date '+%Y-%m-%d %H:%M') | compliance | [brief description]
Use the correct agent name depending on whose idea it was.
Also mention which ideas you implemented in your git commit message.

════════════════════════════════════════════════════════════════════
ALREADY IMPLEMENTED (do NOT redo these — research agents: verify these are still correct):
${IMPLEMENTED_LOG:-  (Nothing implemented yet from research agents)}
════════════════════════════════════════════════════════════════════
CTXEOF
)

FULL_PROMPT="${PROMPT}${CONTEXT}"
update_agent_status "improve" "running" "Running Copilot CLI"
"$COPILOT" --prompt "$FULL_PROMPT" --yolo --allow-all-paths >> "$LOG_FILE" 2>&1

EXIT_CODE=$?
echo "Finished: $(date) (exit code: $EXIT_CODE)" >> "$LOG_FILE"

if [ $EXIT_CODE -ne 0 ]; then
  update_agent_status "improve" "running" "Failed — calling Emergency Fixer" "$EXIT_CODE"
  "$NOTIFY" "YourProject IMPROVE failed (exit $EXIT_CODE) at $(date '+%H:%M')" >> "$LOG_FILE" 2>&1
  echo "Calling Emergency Fixer agent..." >> "$LOG_FILE"
  /opt/copilot-hive/copilot-emergencyfixer.sh improve "$EXIT_CODE" >> "$LOG_FILE" 2>&1
fi

# ── Changelog ─────────────────────────────────────────────────────────
update_agent_status "improve" "running" "Saving changelog"
mkdir -p "$CHANGELOG_DIR"
TIMESTAMP=$(date '+%Y-%m-%d_%H%M')
CHANGELOG_FILE="${CHANGELOG_DIR}/improve_${TIMESTAMP}.txt"
{
  echo "============================================"
  echo "  IMPROVE RUN — $(date)"
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
update_agent_status "improve" "running" "Pushing to GitHub"
PUSHED="no"
BUILD_ID=""
if git -C "$PROJECT_DIR" status --porcelain | grep -q .; then
  # Stamp build version so dispatcher can verify the new container
  BUILD_ID="$(date +%s)-$(head -c 4 /dev/urandom | xxd -p)"
  echo "$BUILD_ID" > "$PROJECT_DIR/.build-id"
  echo "Pushing changes to GitHub (build: $BUILD_ID)..." >> "$LOG_FILE"
  git -C "$PROJECT_DIR" add -A >> "$LOG_FILE" 2>&1
  git -C "$PROJECT_DIR" commit -m "auto: improve features $(date '+%Y-%m-%d %H:%M')" >> "$LOG_FILE" 2>&1
  git -C "$PROJECT_DIR" push origin main >> "$LOG_FILE" 2>&1
  PUSH_CODE=$?
  if [ $PUSH_CODE -eq 0 ]; then
    PUSHED="yes"
  else
    "$NOTIFY" "YourProject IMPROVE git push failed at $(date '+%H:%M')" >> "$LOG_FILE" 2>&1
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
LAST_AGENT=improve
LAST_FINISHED=$(date +%s)
LAST_COMMIT=$COMMIT_SHA
LAST_BUILD_ID=$BUILD_ID
PUSH_TIME=$(date +%s)
DEPLOY_VERIFIED=no
NEXT_AGENT=${NEXT_AGENT:-audit}
PEOF
    echo "Pipeline: waiting for deploy (build: $BUILD_ID)" >> "$LOG_FILE"
  else
    cat > "$PIPELINE_FILE" <<PEOF
PIPELINE_STATE=idle
CURRENT_AGENT=
CURRENT_PID=
LAST_AGENT=improve
LAST_FINISHED=$(date +%s)
LAST_COMMIT=${LAST_COMMIT:-}
LAST_BUILD_ID=${LAST_BUILD_ID:-}
PUSH_TIME=${PUSH_TIME:-0}
DEPLOY_VERIFIED=yes
NEXT_AGENT=${NEXT_AGENT:-audit}
PEOF
    echo "Pipeline: idle (no changes pushed)" >> "$LOG_FILE"
  fi
fi

update_agent_status "improve" "idle" "" "$EXIT_CODE"
exit $EXIT_CODE
