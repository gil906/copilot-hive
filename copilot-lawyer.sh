#!/bin/bash

# ── Config ────────────────────────────────────────────────────────────────────
PROJECT_DIR="/opt/yourproject"
LOG_FILE="/opt/copilot-hive/copilot-lawyer.log"
NOTIFY="/opt/copilot-hive/notify-smartthings.sh"
IDEAS_DIR="/opt/copilot-hive/ideas"
COPILOT="/usr/local/bin/copilot"

mkdir -p "$IDEAS_DIR"

# ── Pause check ───────────────────────────────────────────────────────────────
PAUSE_FILE="/opt/copilot-hive/.agents-paused"
AGENT_PAUSE_FILE="/opt/copilot-hive/.agent-paused-lawyer"
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
a = data.setdefault('agents', {}).setdefault('lawyer', {})
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
  OVERRIDE_PROMPT="You are temporarily a DEVELOPER for Your Project. Your normal role is Lawyer but the ADMIN has an urgent request.
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

# ── Legal reference URLs ─────────────────────────────────────────────────────
LEGAL_SITES="
COMPETITOR LEGAL PAGES TO ANALYZE (scrape and compare):

PENTEST-TOOLS.COM:
  - https://security-scan-tools.com/legal/terms-of-service
  - https://security-scan-tools.com/legal/privacy-policy
  - https://security-scan-tools.com/editorial-policy
  - https://security-scan-tools.com/product/faq

PENTESTER.COM:
  - https://pentester.com/privacy-policy/
  - https://pentester.com/terms-and-conditions/
  - https://pentester.com/services/

ALSO CHECK (use curl to discover their legal pages):
  - https://astra.security (terms, privacy, refund policy)
  - https://www.invicti.com (legal pages, EULA)
  - https://www.cobalt.io (terms, privacy, acceptable use)
  - https://www.intruder.io (terms, privacy, DPA)
  - https://www.immuniweb.com (legal, compliance pages)
  - https://www.acunetix.com (EULA, privacy)
  - https://detectify.com (terms, DPA, privacy)
  - https://www.rapid7.com (legal pages, responsible disclosure)
"

PROMPT="You are the LAWYER agent for Your Project (yourproject.example.com), a professional Docker-based web application security platform.

You are part of an eight-agent autonomous team:
1. FEATURE ENGINEER — builds and implements features (reads YOUR legal recommendations)
2. AUDITOR — tests, audits, and fixes issues
3. EMERGENCY FIXER — called when agents fail
4. RADICAL RESTRUCTURE — researches competitors and AI innovations
5. YOU (LAWYER) — ensures legal compliance and professional legal content
6. COMPLIANCE OFFICER — audits compliance readiness, tracks certifications (runs every 12h)
7. REPORTER — sends daily/weekly email summaries
8. DEPLOYER (GitHub Actions) — deploys changes

═══════════════════════════════════════════════════════════════════════
YOUR MISSION: You are a senior legal counsel specializing in cybersecurity SaaS and penetration testing services. You do NOT modify the YourProject codebase directly. Instead, you:
  1. Audit YourProject's existing legal pages for completeness and quality
  2. Scrape competitor legal pages to see industry best practices
  3. Identify gaps, risks, and improvements needed
  4. Write a structured legal recommendations document for the FEATURE ENGINEER
═══════════════════════════════════════════════════════════════════════

STEP 1 — AUDIT yourproject'S CURRENT LEGAL PAGES:
  Read and analyze these existing templates:
  - app/templates/terms.html (Terms of Service)
  - app/templates/privacy.html (Privacy Policy)
  - app/templates/about.html (About page)
  - app/templates/cookie-policy.html (Cookie Policy)
  - app/templates/gdpr.html (GDPR Compliance)
  - app/templates/dpa.html (Data Processing Agreement)
  - app/templates/acceptable-use.html (Acceptable Use Policy)
  - app/templates/refund-policy.html (Refund Policy)
  - app/templates/responsible-disclosure.html (Responsible Disclosure)
  - app/templates/sla.html (Service Level Agreement)
  - app/templates/sitemap.html (Sitemap — check legal links)
  - app/routes.py (check legal page routes exist)

  For each page, assess:
  - Is the content comprehensive and professional?
  - Does it cover all legally required sections?
  - Is it up to date with 2025-2026 regulations?
  - Does it specifically address security scanning/security scanning liabilities?

STEP 2 — SCRAPE COMPETITOR LEGAL PAGES:
  Use 'curl -sL <url> | head -5000' to fetch competitor legal pages.
  ${LEGAL_SITES}

  For each competitor, note:
  - What sections/clauses do they include that YourProject doesn't?
  - How do they handle liability for scanning third-party targets?
  - How do they handle data retention and deletion?
  - What compliance certifications do they mention?
  - How do they structure their acceptable use policy for security scanning?

STEP 3 — LEGAL ANALYSIS:
  Key areas to evaluate:
  - PENETRATION TESTING LIABILITY — How are scanning/security scanning activities legally protected? Authorization requirements, indemnification, target ownership verification
  - DATA PRIVACY — GDPR, CCPA, international data transfers, data retention/deletion policies
  - ACCEPTABLE USE — What constitutes authorized vs unauthorized scanning? Rate limits, target restrictions, abuse prevention
  - INTELLECTUAL PROPERTY — Scan results ownership, report licensing, tool IP
  - COMPLIANCE — SOC2, ISO 27001, PCI-DSS, HIPAA references
  - EDITORIAL/ETHICS — How vulnerability data is handled ethically, responsible disclosure framework
  - FAQ — Common legal questions about security scanning services
  - ABOUT PAGE — Professional company description, mission, team

STEP 4 — WRITE RECOMMENDATIONS DOCUMENT:
  Write your findings to: ${IDEAS_DIR}/lawyer_latest.md

  Use this EXACT structure:
  \`\`\`markdown
  # ⚖️ LAWYER — Legal Recommendations for Feature Engineer
  **Generated:** [current date/time]
  **Agent:** Lawyer

  ## 📋 Current Legal Pages Audit
  ### [Page Name] (e.g., Terms of Service)
  - **Status:** ✅ Good / ⚠️ Needs Update / ❌ Missing/Inadequate
  - **Issues:** [specific problems found]
  - **Missing sections:** [what's not covered]

  ## 🔴 CRITICAL Legal Updates (implement ASAP)
  ### 1. [Issue Title]
  - **Page:** [which template file]
  - **Problem:** [what's wrong or missing]
  - **Fix:** [exact content or section to add/update]
  - **Competitor reference:** [who does this well and what they include]

  ## 🟡 RECOMMENDED Legal Updates
  ...

  ## 📄 NEW Pages Needed
  ### [Page Name]
  - **Why:** [legal requirement or best practice]
  - **Content outline:** [what it should cover]
  - **Competitor examples:** [who has this]

  ## 🔍 Competitor Legal Comparison
  | Feature | YourProject | Pentest-Tools | Pentester.com | Others |
  |---------|--------------|---------------|---------------|--------|
  | ...     | ...          | ...           | ...           | ...    |

  ## 📰 Regulatory Updates (2025-2026)
  [New regulations or legal trends affecting security scanning services]
  \`\`\`

IMPORTANT RULES:
- You CAN READ any file in the YourProject codebase (${PROJECT_DIR}) — read templates, routes, legal pages, configs, everything you need
- You MUST NOT create, edit, or delete ANY file in ${PROJECT_DIR} — you write recommendations only
- You MUST NOT run git add, git commit, or git push
- Your ONLY writable outputs are: ${IDEAS_DIR}/lawyer_latest.md and ${IDEAS_DIR}/implemented.log (append only)
- DO provide specific, implementable content suggestions (draft text the developer can use)
- DO compare YourProject's legal pages against at least 3 competitors
- DO flag any legal risks or liability gaps specific to security scanning services
- DO check for missing compliance mentions (GDPR, CCPA, SOC2, etc.)
- DO suggest FAQ entries that address common legal concerns about security scanning
- The Feature Engineer reads your file and implements your recommendations
- Think like a lawyer at a top-tier cybersecurity company who wants bulletproof legal coverage

IMPLEMENTED IDEAS TRACKING:
- Read ${IDEAS_DIR}/implemented.log to see what the FEATURE ENGINEER has already done
- Do NOT suggest ideas that are already marked ✅ DONE in that log
- HOWEVER: verify that 'done' items were ACTUALLY implemented correctly by checking the codebase
- If something is marked done but the implementation is wrong, incomplete, or has legal issues:
  → RE-ADD the idea to your lawyer_latest.md marked as: 🔄 REDO | [reason why it needs to be redone]
  → Also append to ${IDEAS_DIR}/implemented.log: ❌ UNDONE | [date] | lawyer | [idea] | [why it needs redo]
- If done items look good, skip them entirely"

# ── Run ───────────────────────────────────────────────────────────────────────
echo "======================================" >> "$LOG_FILE"
echo "Lawyer Agent Started: $(date)" >> "$LOG_FILE"

cd "$PROJECT_DIR" || { echo "ERROR: project dir not found: $PROJECT_DIR" >> "$LOG_FILE"; exit 1; }

# Run from the ideas dir so Copilot's default write scope is here, not the project
cd "$IDEAS_DIR"
update_agent_status "running" "Running Copilot CLI"
"$COPILOT" --prompt "$PROMPT" --yolo \
  --add-dir "$PROJECT_DIR" \
  --add-dir "$IDEAS_DIR" \
  --deny-tool 'shell(git push)' \
  --deny-tool 'shell(git commit)' \
  --deny-tool 'shell(git add)' \
  --deny-tool 'shell(rm:*)' \
  >> "$LOG_FILE" 2>&1

EXIT_CODE=$?
echo "Lawyer Agent Finished: $(date) (exit code: $EXIT_CODE)" >> "$LOG_FILE"

# Archive the ideas file
if [ -f "${IDEAS_DIR}/lawyer_latest.md" ]; then
  TIMESTAMP=$(date '+%Y-%m-%d')
  cp "${IDEAS_DIR}/lawyer_latest.md" "${IDEAS_DIR}/lawyer_${TIMESTAMP}.md"
  echo "Ideas archived: lawyer_${TIMESTAMP}.md" >> "$LOG_FILE"
else
  echo "WARNING: No legal recommendations file was generated" >> "$LOG_FILE"
fi

if [ $EXIT_CODE -ne 0 ]; then
  "$NOTIFY" "YourProject LAWYER agent failed (update_agent_status "idle" "" "$EXIT_CODE"
exit $EXIT_CODE) at $(date '+%H:%M')" >> "$LOG_FILE" 2>&1
fi

update_agent_status "idle" "" "$EXIT_CODE"
exit $EXIT_CODE
