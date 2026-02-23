#!/bin/bash
# ══════════════════════════════════════════════════════════════════════
#  API ARCHITECT — Research agent (READ-ONLY)
#  Analyzes the API container, scanners, tools, orchestration, performance
#  Writes 10 detailed ideas to ideas/api_architect_latest.md
# ══════════════════════════════════════════════════════════════════════

PROJECT_DIR="/opt/yourproject"
LOG_FILE="/opt/copilot-hive/copilot-architect-api.log"
NOTIFY="/opt/copilot-hive/notify-smartthings.sh"
IDEAS_DIR="/opt/copilot-hive/ideas"
COPILOT="/usr/local/bin/copilot"

mkdir -p "$IDEAS_DIR"

PAUSE_FILE="/opt/copilot-hive/.agents-paused"
AGENT_PAUSE_FILE="/opt/copilot-hive/.agent-paused-architect-api"
if [ -f "$PAUSE_FILE" ] || [ -f "$AGENT_PAUSE_FILE" ]; then
  echo "$(date) — SKIPPED: Agent paused" >> "$LOG_FILE"
  exit 0
fi

echo "======================================" >> "$LOG_FILE"
echo "API Architect Started: $(date)" >> "$LOG_FILE"

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
  OVERRIDE_PROMPT="You are temporarily a DEVELOPER for Your Project. Your normal role is API Architect but the ADMIN has an urgent request.
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
    echo "✅ DONE | $(date '+%Y-%m-%d %H:%M') | admin | $URGENT_TITLE" >> "${_IDEAS_DIR}/implemented.log"
  fi
  if git -C "$PROJECT_DIR" status --porcelain | grep -q .; then
    git -C "$PROJECT_DIR" add -A
    git -C "$PROJECT_DIR" commit -m "urgent: admin request — $URGENT_TITLE

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
    git -C "$PROJECT_DIR" push origin main 2>&1 || true
  fi
fi

IMPLEMENTED=""
[ -f "${IDEAS_DIR}/implemented.log" ] && IMPLEMENTED=$(tail -100 "${IDEAS_DIR}/implemented.log" 2>/dev/null)

PROMPT=$(cat <<'PROMPTEOF'
You are the API ARCHITECT agent for Your Project (yourproject.example.com), a professional cybersecurity/security scanning platform running in Docker.

You are a READ-ONLY research agent. You CANNOT modify any source code. You analyze and write ideas ONLY.

YOUR FOCUS: The API CONTAINER — backend architecture, scanners, tools, performance:
- Scanner modules: how scans are initiated, run, and results collected
- Scan orchestrator: parallel execution, timeouts, resource limits, queue management
- Installed security tools: nmap, nikto, nuclei, ZAP, metasploit, subfinder, testssl, sqlmap, wapiti, etc.
- API endpoints: REST design, error handling, pagination, rate limiting
- Database queries: optimization, indexes, connection pooling
- New scanner ideas: what tools could be added, what scan types are missing
- Result enrichment: CVSS scoring, remediation guidance, CVE correlation
- Report generation: PDF/HTML quality, data completeness, professional formatting
- Performance: scan speed, memory usage, CPU optimization on Raspberry Pi 5
- Docker setup: multi-stage builds, layer caching, image size, health checks
- Security of the API itself: auth, input validation, CORS, rate limiting
- Webhook/notification system for scan completion
- Scheduled scan improvements and scan comparison features

STEPS:
1. READ all API code — routes, scanner modules, orchestrator, models, Dockerfile
2. Analyze the installed tools and how they're invoked
3. Research what top security-scan platforms offer in their APIs
4. Identify the TOP 5 most impactful backend improvements

OUTPUT: Write EXACTLY 10 ideas to ideas/api_architect_latest.md in this format:

# ⚙️ API Architecture Ideas — [date]
## Idea 1: [Title]
**Priority:** HIGH/MEDIUM/LOW
**Category:** Scanner/Orchestrator/API/Database/Docker/Performance/Security
**Current state:** How it works now (include file paths and function names)
**Proposed change:** Detailed technical description
**Why it matters:** Performance, capability, reliability, or security impact
**Implementation guide:** Step-by-step with code patterns, libraries, config changes
**Estimated complexity:** Easy (1-2 hours) / Medium (3-5 hours) / Hard (full day)

[repeat for all 10 ideas]

RULES:
- Do NOT modify any source files — ONLY write to ideas/api_architect_latest.md
- Each idea must be technically precise — include function signatures, SQL queries, config changes
- Skip ideas already in the IMPLEMENTED LOG below
- Think like a senior backend engineer who optimizes for the Raspberry Pi 5 (4GB ARM)
- Consider the full tool inventory when suggesting scanner improvements
PROMPTEOF
)

CONTEXT=$(cat <<CTXEOF

ALREADY IMPLEMENTED (skip these):
${IMPLEMENTED:-  (none yet)}
CTXEOF
)

cd "$IDEAS_DIR" || exit 1

"$COPILOT" --prompt "${PROMPT}${CONTEXT}" --yolo \
  --add-dir "$PROJECT_DIR" \
  --add-dir "$IDEAS_DIR" \
  --allow-all-urls \
  --deny-tool 'shell(git push)' \
  --deny-tool 'shell(git commit)' \
  --deny-tool 'shell(git add)' \
  --deny-tool 'shell(rm:*)' \
  >> "$LOG_FILE" 2>&1

EXIT_CODE=$?
echo "API Architect Finished: $(date) (exit: $EXIT_CODE)" >> "$LOG_FILE"

[ $EXIT_CODE -ne 0 ] && "$NOTIFY" "API Architect agent failed (exit $EXIT_CODE)" >> "$LOG_FILE" 2>&1
exit $EXIT_CODE
