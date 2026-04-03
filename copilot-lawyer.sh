#!/bin/bash

# Load central configuration
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/config.sh"

# ── Config ────────────────────────────────────────────────────────────────────
PROJECT_DIR="${PROJECT_DIR:-/opt/yourproject}"
LOG_FILE="${LOG_FILE:-/opt/copilot-hive/copilot-lawyer.log}"
NOTIFY="/opt/copilot-hive/notify-smartthings.sh"
IDEAS_DIR="${IDEAS_DIR:-/opt/copilot-hive/ideas}"
COPILOT="/usr/local/bin/copilot"

mkdir -p "$IDEAS_DIR"

# ── Pause check ───────────────────────────────────────────────────────────────
PAUSE_FILE="${PAUSE_FILE:-/opt/copilot-hive/.agents-paused}"
AGENT_PAUSE_FILE="${AGENT_PAUSE_FILE:-/opt/copilot-hive/.agent-paused-lawyer}"
if [ -f "$PAUSE_FILE" ] || [ -f "$AGENT_PAUSE_FILE" ]; then
  echo "$(date) — SKIPPED: Agent paused by admin" >> "$LOG_FILE"
  exit 0
fi

# Prevent concurrent runs of same agent
acquire_agent_lock "lawyer${PROJECT_ID:+-$PROJECT_ID}" || { echo "$(date) — SKIPPED: Another instance already running" >> "$LOG_FILE"; exit 0; }

# ── Agent Status Helper ──────────────────────────────────────────────────────
STATUS_FILE="${STATUS_FILE:-/opt/copilot-hive/ideas/agent_status.json}"
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
_IDEAS_DIR="${IDEAS_DIR:-/opt/copilot-hive/ideas}"
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
LEGAL_SITES="${LEGAL_SITES:-}"
if [ -z "$LEGAL_SITES" ]; then
LEGAL_SITES="
HOW TO FIND COMPETITOR LEGAL PAGES:
  1. First, read the project codebase to understand what kind of product/service this is
  2. Search for 'best [product category] platforms' to identify 3-5 direct competitors
  3. For each competitor, discover their legal pages:
     - Use 'curl -sL <competitor-url> | grep -iE \"(terms|privacy|legal|policy|gdpr|dpa|cookie|refund|acceptable-use)\"'
     - Check common paths: /terms, /privacy, /legal, /tos, /privacy-policy
  4. Scrape and compare their legal content against this project's legal pages

ANALYSIS APPROACH:
  - How do competitors handle liability for their specific service type?
  - What data privacy frameworks do they address?
  - How do they structure acceptable use policies for their product category?
  - What compliance certifications do they mention?
  - What refund/cancellation policies do they have?
"
fi

# ── Load prompt from file if available ────────────────────────────────
PROMPT_FILE="${SCRIPTS_DIR}/prompts/lawyer.md"
if [ -f "$PROMPT_FILE" ]; then
  PROMPT=$(cat "$PROMPT_FILE")
  echo "Loaded prompt from $PROMPT_FILE" >> "$LOG_FILE"
else
  # Fallback to inline prompt below
PROMPT="You are the LAWYER agent for the project at ${PROJECT_DIR}. You ensure legal compliance and professional legal content.

You are part of an autonomous multi-agent team:
1. FEATURE ENGINEER — builds and implements features (reads YOUR legal recommendations)
2. AUDITOR — tests, audits, and fixes issues
3. EMERGENCY FIXER — called when agents fail
4. RADICAL RESTRUCTURE — researches competitors and AI innovations
5. YOU (LAWYER) — ensures legal compliance and professional legal content
6. COMPLIANCE OFFICER — audits compliance readiness, tracks certifications
7. REPORTER — sends daily/weekly email summaries
8. DEPLOYER — deploys changes

═══════════════════════════════════════════════════════════════════════
YOUR MISSION: You are a senior legal counsel specializing in SaaS and digital services. You do NOT modify the project codebase directly. Instead, you:
  1. Read the codebase to understand what the project does and what legal pages exist
  2. Scrape competitor legal pages to see industry best practices
  3. Identify gaps, risks, and improvements needed
  4. Write a structured legal recommendations document for the FEATURE ENGINEER
═══════════════════════════════════════════════════════════════════════

STEP 1 — AUDIT THE PROJECT'S CURRENT LEGAL PAGES:
  First, understand what the project does by reading its codebase, README, and configs.
  Then find and analyze all existing legal pages:
  - Search for templates/pages related to: terms, privacy, cookies, GDPR, DPA, acceptable use, refund, SLA, about
  - Check route definitions for legal page endpoints
  - Search the codebase: grep -r 'terms\|privacy\|legal\|policy\|cookie\|gdpr\|dpa' in templates/routes

  For each page found, assess:
  - Is the content comprehensive and professional?
  - Does it cover all legally required sections for this type of service?
  - Is it up to date with current regulations?
  - Does it specifically address liabilities relevant to this product type?

STEP 2 — DISCOVER AND SCRAPE COMPETITOR LEGAL PAGES:
  Use 'curl -sL <url> | head -5000' to fetch competitor legal pages.
  ${LEGAL_SITES}

  For each competitor, note:
  - What sections/clauses do they include that this project doesn't?
  - How do they handle liability for their specific service type?
  - How do they handle data retention and deletion?
  - What compliance certifications do they mention?
  - How do they structure their acceptable use policy?

STEP 3 — LEGAL ANALYSIS:
  Key areas to evaluate (adapt based on what the project actually does):
  - SERVICE LIABILITY — How are the project's core activities legally protected? What disclaimers are needed?
  - DATA PRIVACY — GDPR, CCPA, international data transfers, data retention/deletion policies
  - ACCEPTABLE USE — What constitutes proper vs improper use of this service? Abuse prevention
  - INTELLECTUAL PROPERTY — Output/results ownership, content licensing, tool IP
  - COMPLIANCE — Relevant industry certifications and standards
  - FAQ — Common legal questions specific to this type of service
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
  | Feature | This Project | Competitor A | Competitor B | Others |
  |---------|-------------|--------------|--------------|--------|
  | ...     | ...         | ...          | ...          | ...    |

  ## 📰 Regulatory Updates
  [New regulations or legal trends affecting this type of service]
  \`\`\`

IMPORTANT RULES:
- You CAN READ any file in the project codebase (${PROJECT_DIR}) — read templates, routes, legal pages, configs, everything you need
- You MUST NOT create, edit, or delete ANY file in ${PROJECT_DIR} — you write recommendations only
- You MUST NOT run git add, git commit, or git push
- Your ONLY writable outputs are: ${IDEAS_DIR}/lawyer_latest.md and ${IDEAS_DIR}/implemented.log (append only)
- DO provide specific, implementable content suggestions (draft text the developer can use)
- DO compare the project's legal pages against at least 3 competitors
- DO flag any legal risks or liability gaps specific to this type of service
- DO check for missing compliance mentions (GDPR, CCPA, etc.)
- DO suggest FAQ entries that address common legal concerns for this service type
- The Feature Engineer reads your file and implements your recommendations
- Think like a lawyer at a top-tier tech company who wants bulletproof legal coverage

IMPLEMENTED IDEAS TRACKING:
- Read ${IDEAS_DIR}/implemented.log to see what the FEATURE ENGINEER has already done
- Do NOT suggest ideas that are already marked ✅ DONE in that log
- HOWEVER: verify that 'done' items were ACTUALLY implemented correctly by checking the codebase
- If something is marked done but the implementation is wrong, incomplete, or has legal issues:
  → RE-ADD the idea to your lawyer_latest.md marked as: 🔄 REDO | [reason why it needs to be redone]
  → Also append to ${IDEAS_DIR}/implemented.log: ❌ UNDONE | [date] | lawyer | [idea] | [why it needs redo]
- If done items look good, skip them entirely

FORMAT: For each idea, include:
- **Priority**: high / medium / low
- **Impact**: 1-10 (10 = game-changing)
- **Effort**: small / medium / large
Order ideas by impact score (highest first)."
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
