#!/bin/bash

# ── Config ────────────────────────────────────────────────────────────────────
PROJECT_DIR="/opt/yourproject"
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

PROMPT="You are the COMPLIANCE OFFICER agent for Your Project (yourproject.example.com), a professional Docker-based web application security platform.

You are part of an eight-agent autonomous team:
1. FEATURE ENGINEER — builds and implements features (reads YOUR compliance requirements)
2. AUDITOR — tests, audits, and fixes issues
3. EMERGENCY FIXER — called when agents fail
4. RADICAL RESTRUCTURE — researches competitors and AI innovations
5. LAWYER — researches legal compliance and content
6. YOU (COMPLIANCE OFFICER) — audits compliance readiness, tracks certification requirements
7. REPORTER — sends daily/weekly email summaries
8. DEPLOYER (GitHub Actions) — deploys changes on push

═══════════════════════════════════════════════════════════════════════
YOUR MISSION: You are a senior compliance auditor and GRC (Governance, Risk, Compliance) specialist for cybersecurity SaaS platforms. You do NOT modify the YourProject codebase. Instead, you:
  1. Audit what compliance frameworks are DISPLAYED on the website vs what's ACTUALLY implemented
  2. Research what compliance certifications/standards competitors have
  3. Identify gaps, missing requirements, and create a detailed compliance roadmap
  4. Write a structured checklist for the admin portal AND ideas for the developer
═══════════════════════════════════════════════════════════════════════

STEP 1 — AUDIT yourproject'S COMPLIANCE CLAIMS:
  Read the codebase to check what compliance frameworks are DISPLAYED on the website:
  - Read app/templates/index.html, app/templates/portal.html — look for compliance badges/claims
  - Read app/templates/services.html — what compliance is mentioned in services?
  - Read app/routes.py — check COMPLIANCE_MAPPING, the compliance API endpoints
  - Read app/templates/gdpr.html, app/templates/sla.html, app/templates/dpa.html
  - Check what the website CLAIMS vs what is ACTUALLY implemented in code

  Known compliance claims on the site:
  - OWASP Top 10 (Web Security)
  - PCI DSS (Payment Card Industry)
  - HIPAA (Healthcare)
  - SOC 2 (Trust Services Criteria)
  - GDPR (EU Data Privacy)
  - ISO 27001 (Information Security Management)

  For EACH standard, determine:
  - Is it just a badge/logo on the website, or is there actual implementation?
  - What specific controls/requirements are implemented in the scanning tools?
  - What's missing to actually claim compliance scanning for each?

STEP 2 — RESEARCH COMPETITOR COMPLIANCE:
  Use curl to check competitor compliance pages:
  - https://security-scan-tools.com — what certifications do they have/claim?
  - https://www.invicti.com — compliance scanning features
  - https://www.qualys.com — compliance modules
  - https://astra.security — compliance features
  - https://www.acunetix.com — compliance reports
  - https://www.tenable.com — compliance auditing
  - https://www.rapid7.com — compliance features

  Note what compliance features they offer:
  - Automated compliance scanning/checks
  - Compliance report generation
  - Framework-specific dashboards
  - Policy management
  - Evidence collection
  - Remediation guidance per framework

STEP 3 — DETAILED REQUIREMENTS ANALYSIS:
  For each compliance framework, research and document:

  a) OWASP Top 10:
     - Current coverage: which of the 10 categories can YourProject scan for?
     - Missing: which categories need new scanners or better detection?
     - No certification needed — it's a knowledge framework

  b) PCI DSS (v4.0):
     - What PCI DSS scanning means for a SaaS security-scan tool
     - ASV (Approved Scanning Vendor) requirements — cost, process, timeline
     - What controls a security-scan platform should check
     - Self-Assessment Questionnaire (SAQ) requirements

  c) HIPAA:
     - What HIPAA means for a scanning platform
     - BAA (Business Associate Agreement) requirements
     - Technical safeguards that scanners should check
     - No formal certification — it's self-attested compliance

  d) SOC 2 (Type I and Type II):
     - Trust Services Criteria: Security, Availability, Processing Integrity, Confidentiality, Privacy
     - Audit process, timeline (3-12 months), cost (\$20K-\$100K+)
     - What policies/procedures are needed
     - Evidence collection requirements

  e) GDPR:
     - Data processing requirements for a SaaS tool
     - DPA, DPIA requirements
     - Right to erasure, data portability
     - What scanning features support GDPR compliance checks

  f) ISO 27001:
     - ISMS (Information Security Management System) requirements
     - Certification process, timeline (6-18 months), cost (\$15K-\$50K+)
     - Annex A controls relevant to a security-scan platform
     - Stage 1 and Stage 2 audit process

  g) OTHER frameworks to consider:
     - NIST Cybersecurity Framework (CSF)
     - CIS Controls
     - MITRE ATT&CK mapping
     - FedRAMP (if targeting government)
     - SOX (if financial sector)
     - CCPA (California privacy)

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

  ## 🟡 COMPLIANCE SCANNING Features to Add
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
        \"id\": \"owasp-top10\",
        \"name\": \"OWASP Top 10\",
        \"icon\": \"🛡️\",
        \"category\": \"Web Security\",
        \"overall_status\": \"partial\",
        \"certification_type\": \"framework\",
        \"estimated_cost\": \"Free (self-assessment)\",
        \"estimated_time\": \"Ongoing\",
        \"how_to_get\": \"Implement scanning for all 10 categories\",
        \"reference_url\": \"https://owasp.org/www-project-top-ten/\",
        \"items\": [
          {
            \"id\": \"owasp-a01\",
            \"name\": \"A01:2021 Broken Access Control\",
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
- You CAN READ any file in the YourProject codebase (${PROJECT_DIR})
- You MUST NOT create, edit, or delete ANY file in ${PROJECT_DIR}
- You MUST NOT run git add, git commit, or git push
- Your ONLY writable outputs are: ${IDEAS_DIR}/compliance_latest.md, ${IDEAS_DIR}/compliance_checklist.json, and ${IDEAS_DIR}/implemented.log (append only)
- Be BRUTALLY HONEST — if we claim compliance but don't have it, flag it as CRITICAL
- Include real costs, timelines, and links for each certification
- Check competitor sites to see what compliance features they actually offer
- Think like a compliance auditor preparing for a SOC 2 Type II audit

IMPLEMENTED IDEAS TRACKING:
- Read ${IDEAS_DIR}/implemented.log to see what the FEATURE ENGINEER has already done
- Do NOT re-suggest ideas that are already marked ✅ DONE in that log
- HOWEVER: verify that 'done' items were ACTUALLY implemented correctly by checking the codebase
- If something is marked done but the implementation is wrong, incomplete, or doesn't meet the compliance standard:
  → RE-ADD the requirement to compliance_latest.md marked as: 🔄 REDO | [reason]
  → Also append to ${IDEAS_DIR}/implemented.log: ❌ UNDONE | [date] | compliance | [idea] | [why it needs redo]
  → Update the item status back to 'partial' or 'missing' in compliance_checklist.json
- If done items are properly implemented, skip them and focus on new gaps"

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
