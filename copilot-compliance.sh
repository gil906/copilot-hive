#!/bin/bash

# Load central configuration & shared agent helpers
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/config.sh"
source "${SCRIPT_DIR}/lib/agent-helpers.sh"
init_agent_env "compliance" "$@"

# ── Config ────────────────────────────────────────────────────────────────────
PROJECT_DIR="${PROJECT_DIR:-/opt/yourproject}"
NOTIFY="${NOTIFY:-${SCRIPT_DIR}/notify-smartthings.sh}"
IDEAS_DIR="${IDEAS_DIR:-${SCRIPT_DIR}/ideas}"
COPILOT="${COPILOT:-$(command -v copilot 2>/dev/null || echo /usr/local/bin/copilot)}"

mkdir -p "$IDEAS_DIR"
check_agent_paused "compliance"

# Prevent concurrent runs of same agent
acquire_agent_lock "compliance${PROJECT_ID:+-$PROJECT_ID}" || { echo "$(date) — SKIPPED: Another instance already running" >> "$LOG_FILE"; exit 0; }

update_agent_status "compliance" "running" "Starting compliance assessment"

# ── Urgent Admin Ideas Check ─────────────────────────────────────────────────
handle_urgent_admin_idea "compliance" "Compliance Officer" || true

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

SMART_CTX=$(get_smart_context "compliance")
[ -n "$SMART_CTX" ] && PROMPT="${PROMPT}

${SMART_CTX}"

cd "$IDEAS_DIR"
update_agent_status "compliance" "running" "Running Copilot CLI compliance audit"
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
  index_agent_output "compliance" "${IDEAS_DIR}/compliance_latest.md"
fi
[ -f "${IDEAS_DIR}/compliance_checklist.json" ] && index_agent_output "compliance" "${IDEAS_DIR}/compliance_checklist.json"

if [ $EXIT_CODE -ne 0 ]; then
  "$NOTIFY" "COMPLIANCE agent failed (exit $EXIT_CODE) at $(date '+%H:%M')" >> "$LOG_FILE" 2>&1
fi

update_agent_status "compliance" "idle" "" "$EXIT_CODE"
exit $EXIT_CODE
