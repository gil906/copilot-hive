#!/bin/bash

# Load central configuration & shared agent helpers
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/config.sh"
source "${SCRIPT_DIR}/lib/agent-helpers.sh"
init_agent_env "lawyer" "$@"

# ── Config ────────────────────────────────────────────────────────────────────
PROJECT_DIR="${PROJECT_DIR:-/opt/yourproject}"
NOTIFY="${NOTIFY:-${SCRIPT_DIR}/notify-smartthings.sh}"
IDEAS_DIR="${IDEAS_DIR:-${SCRIPT_DIR}/ideas}"
COPILOT="${COPILOT:-$(command -v copilot 2>/dev/null || echo /usr/local/bin/copilot)}"

mkdir -p "$IDEAS_DIR"
check_agent_paused "lawyer"

# Prevent concurrent runs of same agent
acquire_agent_lock "lawyer${PROJECT_ID:+-$PROJECT_ID}" || { echo "$(date) — SKIPPED: Another instance already running" >> "$LOG_FILE"; exit 0; }

update_agent_status "lawyer" "running" "Starting legal & IP analysis"

# ── Urgent Admin Ideas Check ─────────────────────────────────────────────────
handle_urgent_admin_idea "lawyer" "Lawyer" || true

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

cd "$PROJECT_DIR" || { echo "ERROR: project dir not found: $PROJECT_DIR" >> "$LOG_FILE"; update_agent_status "lawyer" "idle" "Project dir missing" "1"; exit 1; }

SMART_CTX=$(get_smart_context "lawyer")
[ -n "$SMART_CTX" ] && PROMPT="${PROMPT}

${SMART_CTX}"

# Run from the ideas dir so Copilot's default write scope is here, not the project
cd "$IDEAS_DIR"
update_agent_status "lawyer" "running" "Running Copilot CLI legal review"
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
  index_agent_output "lawyer" "${IDEAS_DIR}/lawyer_latest.md"
else
  echo "WARNING: No legal recommendations file was generated" >> "$LOG_FILE"
fi

if [ $EXIT_CODE -ne 0 ]; then
  "$NOTIFY" "LAWYER agent failed (exit $EXIT_CODE) at $(date '+%H:%M')" >> "$LOG_FILE" 2>&1
fi

update_agent_status "lawyer" "idle" "" "$EXIT_CODE"
exit $EXIT_CODE
