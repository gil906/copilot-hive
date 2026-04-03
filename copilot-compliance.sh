#!/bin/bash

# Load central configuration
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/config.sh"

# ── Config ────────────────────────────────────────────────────────────────────
PROJECT_DIR="${PROJECT_DIR:-/opt/yourproject}"
LOG_FILE="/opt/copilot-hive/copilot-compliance.log"
NOTIFY="/opt/copilot-hive/notify-smartthings.sh"
IDEAS_DIR="/opt/copilot-hive/ideas"
COPILOT="/usr/local/bin/copilot"

mkdir -p "$IDEAS_DIR"

# ── Pause check ───────────────────────────────────────────────────────────────
PAUSE_FILE="/opt/copilot-hive/.agents-paused"
AGENT_PAUSE_FILE="/opt/copilot-hive/.agent-paused-compliance"
if [ -f "$PAUSE_FILE" ] || [ -f "$AGENT_PAUSE_FILE" ]; then
  echo "$(date) — SKIPPED: Agent paused by admin" >> "$LOG_FILE"
  exit 0
fi

# Prevent concurrent runs of same agent
acquire_agent_lock "compliance" || { echo "$(date) — SKIPPED: Another instance already running" >> "$LOG_FILE"; exit 0; }

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
a = data.setdefault('agents', {}).setdefault('compliance', {})
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
  OVERRIDE_PROMPT="You are temporarily a DEVELOPER for Your Project. Your normal role is Compliance Officer but the ADMIN has an urgent request.
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

# ── Load existing checklist status ────────────────────────────────────────────
CHECKLIST_FILE="${IDEAS_DIR}/compliance_checklist.json"
EXISTING_STATUS=""
if [ -f "$CHECKLIST_FILE" ]; then
  EXISTING_STATUS=$(cat "$CHECKLIST_FILE" 2>/dev/null | head -500)
fi

# ── Load what developer has already implemented ──────────────────────────────
DONE_IDEAS=""
if [ -f "${IDEAS_DIR}/implemented.log" ]; then
  DONE_IDEAS=$(grep -i "compliance" "${IDEAS_DIR}/implemented.log" 2>/dev/null | tail -50)
fi

# ── Load prompt from file if available ────────────────────────────────
PROMPT_FILE="${SCRIPTS_DIR}/prompts/compliance.md"
if [ -f "$PROMPT_FILE" ]; then
  PROMPT=$(cat "$PROMPT_FILE")
  echo "Loaded prompt from $PROMPT_FILE" >> "$LOG_FILE"
else
  # Fallback to inline prompt below
PROMPT="You are the COMPLIANCE OFFICER agent for the project at ${PROJECT_DIR}. You audit compliance readiness and track certification requirements.

You are part of an autonomous multi-agent team:
1. FEATURE ENGINEER — builds and implements features (reads YOUR compliance requirements)
2. AUDITOR — tests, audits, and fixes issues
3. EMERGENCY FIXER — called when agents fail
4. RADICAL RESTRUCTURE — researches competitors and AI innovations
5. LAWYER — researches legal compliance and content
6. YOU (COMPLIANCE OFFICER) — audits compliance readiness, tracks certification requirements
7. REPORTER — sends daily/weekly email summaries
8. DEPLOYER — deploys changes

═══════════════════════════════════════════════════════════════════════
YOUR MISSION: You are a senior compliance auditor and GRC (Governance, Risk, Compliance) specialist. You do NOT modify the project codebase. Instead, you:
  1. Read the codebase to understand what the project does and what compliance it claims
  2. Audit what compliance frameworks are DISPLAYED on the website vs what's ACTUALLY implemented
  3. Research what compliance certifications/standards competitors have
  4. Identify gaps, missing requirements, and create a detailed compliance roadmap
  5. Write a structured checklist for the admin portal AND ideas for the developer
═══════════════════════════════════════════════════════════════════════

STEP 1 — UNDERSTAND THE PROJECT AND AUDIT COMPLIANCE CLAIMS:
  First, read the project codebase to understand:
  - What does this project/service do? What industry is it in?
  - What compliance frameworks or certifications are displayed on the website?
  - Search templates and pages for compliance badges, trust seals, or certification claims
  - Check route definitions for compliance-related endpoints
  - What the website CLAIMS vs what is ACTUALLY implemented in code

  For EACH compliance claim found, determine:
  - Is it just a badge/logo on the website, or is there actual implementation?
  - What specific controls/requirements are implemented?
  - What's missing to actually claim compliance?

STEP 2 — RESEARCH COMPETITOR COMPLIANCE:
  Based on what the project does, find competitors and check their compliance:
  - Search for 'best [product category] platforms' to identify competitors
  - Use curl to check competitor websites for compliance/certification pages
  - Note what compliance features they offer:
    - Automated compliance checks
    - Compliance report generation
    - Framework-specific features
    - Policy management
    - Evidence collection

STEP 3 — DETAILED REQUIREMENTS ANALYSIS:
  Based on the project's industry and features, research relevant compliance frameworks.
  Common frameworks to consider (select those relevant to this project):

  a) DATA PRIVACY:
     - GDPR (EU Data Privacy) — data processing, DPA, right to erasure
     - CCPA (California Privacy) — consumer rights, data collection disclosure
     - International data transfer requirements

  b) SECURITY STANDARDS:
     - SOC 2 (Type I and Type II) — Trust Services Criteria
     - ISO 27001 — Information Security Management System
     - OWASP guidelines (if applicable to the project's domain)

  c) INDUSTRY-SPECIFIC (identify which apply to this project):
     - PCI DSS — if handling payment data
     - HIPAA — if handling health data
     - FedRAMP — if targeting government
     - SOX — if financial sector
     - NIST Cybersecurity Framework
     - CIS Controls

  For each relevant framework, document:
  - Current status (implemented, partial, missing)
  - What would be needed for compliance
  - Certification process, timeline, and estimated cost
  - Reference URLs for official documentation

STEP 4 — WRITE TWO OUTPUT FILES:

  FILE 1: ${IDEAS_DIR}/compliance_latest.md
  Ideas/tasks for the FEATURE ENGINEER to implement. Use this structure:
  \`\`\`markdown
  # 📋 COMPLIANCE OFFICER — Requirements for Feature Engineer
  **Generated:** [date/time]

  ## Items Already Implemented (DO NOT redo these):
  [List any items from previous runs that are marked done]

  ## 🔴 CRITICAL — Misleading Claims (fix immediately)
  ### [Standard Name] — [Specific Issue]
  - **Problem:** We display [X] but don't actually [Y]
  - **Fix:** [What the developer needs to implement]
  - **Priority:** CRITICAL

  ## 🟡 COMPLIANCE Features to Add
  ### [Feature Name]
  - **Framework:** [Which standard]
  - **What:** [Detailed implementation description]
  - **Files:** [Which files to modify]

  ## 🟢 NICE TO HAVE — Advanced Compliance Features
  ...
  \`\`\`

  FILE 2: ${IDEAS_DIR}/compliance_checklist.json
  Structured data for the admin portal. Use this EXACT JSON format:
  \`\`\`json
  {
    \"last_updated\": \"[ISO date]\",
    \"standards\": [
      {
        \"id\": \"[framework-id]\",
        \"name\": \"[Framework Name]\",
        \"icon\": \"[emoji]\",
        \"category\": \"[Category]\",
        \"overall_status\": \"partial\",
        \"certification_type\": \"[certification/framework/self-assessment]\",
        \"estimated_cost\": \"[cost range or Free]\",
        \"estimated_time\": \"[timeline]\",
        \"how_to_get\": \"[brief process description]\",
        \"reference_url\": \"[official URL]\",
        \"items\": [
          {
            \"id\": \"[item-id]\",
            \"name\": \"[Requirement Name]\",
            \"status\": \"implemented\",
            \"displayed_on_site\": true,
            \"actually_implemented\": true,
            \"description\": \"...\",
            \"what_we_have\": \"...\",
            \"what_we_need\": \"...\",
            \"priority\": \"high\"
          }
        ]
      }
    ]
  }
  \`\`\`
  Status values: \"implemented\", \"partial\", \"missing\", \"not_applicable\"
  IMPORTANT: If a compliance_checklist.json already exists, PRESERVE any items with status
  \"acknowledged\" or \"in_progress\" — the admin may have manually updated those.

EXISTING CHECKLIST DATA (preserve admin-set statuses):
${EXISTING_STATUS:-  (No existing checklist — create from scratch)}

PREVIOUSLY IMPLEMENTED ITEMS (do not re-add as tasks):
${DONE_IDEAS:-  (No previous implementation data)}

IMPORTANT RULES:
- You CAN READ any file in the project codebase (${PROJECT_DIR})
- You MUST NOT create, edit, or delete ANY file in ${PROJECT_DIR}
- You MUST NOT run git add, git commit, or git push
- Your ONLY writable outputs are: ${IDEAS_DIR}/compliance_latest.md, ${IDEAS_DIR}/compliance_checklist.json, and ${IDEAS_DIR}/implemented.log (append only)
- Be BRUTALLY HONEST — if we claim compliance but don't have it, flag it as CRITICAL
- Include real costs, timelines, and links for each certification
- Check competitor sites to see what compliance features they actually offer
- Think like a compliance auditor preparing for an external audit

IMPLEMENTED IDEAS TRACKING:
- Read ${IDEAS_DIR}/implemented.log to see what the FEATURE ENGINEER has already done
- Do NOT re-suggest ideas that are already marked ✅ DONE in that log
- HOWEVER: verify that 'done' items were ACTUALLY implemented correctly by checking the codebase
- If something is marked done but the implementation is wrong, incomplete, or doesn't meet the compliance standard:
  → RE-ADD the requirement to compliance_latest.md marked as: 🔄 REDO | [reason]
  → Also append to ${IDEAS_DIR}/implemented.log: ❌ UNDONE | [date] | compliance | [idea] | [why it needs redo]
  → Update the item status back to 'partial' or 'missing' in compliance_checklist.json
- If done items are properly implemented, skip them and focus on new gaps"
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
echo "Compliance Agent Started: $(date)" >> "$LOG_FILE"

cd "$IDEAS_DIR"
update_agent_status "running" "Running Copilot CLI"
"$COPILOT" --prompt "$PROMPT" --yolo \
  --add-dir "$PROJECT_DIR" \
  --add-dir "$IDEAS_DIR" \
  --allow-all-urls \
  --deny-tool 'shell(git push)' \
  --deny-tool 'shell(git commit)' \
  --deny-tool 'shell(git add)' \
  --deny-tool 'shell(rm:*)' \
  >> "$LOG_FILE" 2>&1

EXIT_CODE=$?
echo "Compliance Agent Finished: $(date) (exit code: $EXIT_CODE)" >> "$LOG_FILE"

# Archive
if [ -f "${IDEAS_DIR}/compliance_latest.md" ]; then
  TIMESTAMP=$(date '+%Y-%m-%d')
  cp "${IDEAS_DIR}/compliance_latest.md" "${IDEAS_DIR}/compliance_${TIMESTAMP}.md"
  echo "Ideas archived: compliance_${TIMESTAMP}.md" >> "$LOG_FILE"
fi

if [ $EXIT_CODE -ne 0 ]; then
  "$NOTIFY" "YourProject COMPLIANCE agent failed (update_agent_status "idle" "" "$EXIT_CODE"
exit $EXIT_CODE) at $(date '+%H:%M')" >> "$LOG_FILE" 2>&1
fi

update_agent_status "idle" "" "$EXIT_CODE"
exit $EXIT_CODE
