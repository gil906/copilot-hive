#!/bin/bash

# Load central configuration & shared agent helpers
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/config.sh"
source "${SCRIPT_DIR}/lib/agent-helpers.sh"
init_agent_env "designer-portal" "$@"

# ══════════════════════════════════════════════════════════════════════
#  PORTAL DESIGNER — Research agent (READ-ONLY)
#  Analyzes the logged-in portal/dashboard UX, admin panel, user flows
#  Writes 10 detailed ideas to ideas/portal_design_latest.md
# ══════════════════════════════════════════════════════════════════════

PROJECT_DIR="${PROJECT_DIR:-/opt/yourproject}"
NOTIFY="${NOTIFY:-${SCRIPT_DIR}/notify-smartthings.sh}"
IDEAS_DIR="${IDEAS_DIR:-${SCRIPT_DIR}/ideas}"
COPILOT="${COPILOT:-$(command -v copilot 2>/dev/null || echo /usr/local/bin/copilot)}"

mkdir -p "$IDEAS_DIR"
check_agent_paused "designer-portal"

# Prevent concurrent runs of same agent
acquire_agent_lock "designer-portal${PROJECT_ID:+-$PROJECT_ID}" || { echo "$(date) — SKIPPED: Another instance already running" >> "$LOG_FILE"; exit 0; }

echo "======================================" >> "$LOG_FILE"
echo "Portal Designer Started: $(date)" >> "$LOG_FILE"
update_agent_status "designer-portal" "running" "Starting portal UX analysis"

# ── Urgent Admin Ideas Check ─────────────────────────────────────────────────
handle_urgent_admin_idea "designer-portal" "Portal Designer" || true

IMPLEMENTED=""
[ -f "${IDEAS_DIR}/implemented.log" ] && IMPLEMENTED=$(tail -100 "${IDEAS_DIR}/implemented.log" 2>/dev/null)

# ── Load prompt from file if available ────────────────────────────────
PROMPT_FILE="${SCRIPTS_DIR}/prompts/portal-designer.md"
if [ -f "$PROMPT_FILE" ]; then
  PROMPT=$(cat "$PROMPT_FILE")
  echo "Loaded prompt from $PROMPT_FILE" >> "$LOG_FILE"
else
  # Fallback to inline prompt below
PROMPT=$(cat <<'PROMPTEOF'
You are the PORTAL DESIGNER agent for the project at /opt/yourproject. You analyze the logged-in user experience and propose improvements.

You are a READ-ONLY research agent. You CANNOT modify any source code. You analyze and write ideas ONLY.

YOUR FOCUS: The LOGGED-IN EXPERIENCE — everything after a user signs in:
- User dashboard (activity overview, key metrics, status indicators)
- Core workflow UI (the main actions users perform in the app)
- Results/output display (data cards, detail panels, status indicators)
- Report viewing and generation
- Admin panel (user management, system settings, configuration)
- Settings page (profile, notifications, API keys, integrations)
- Data visualizations (charts, graphs, trend lines, heat maps)
- Tables, filters, search, pagination
- Loading states, empty states, error states
- Notifications and toast messages
- Dark mode / theme consistency
- Responsive portal experience on tablets/phones

STEPS:
1. READ the project codebase to understand what it does and what the portal currently looks like
2. Review the database schema and API endpoints to understand data available
3. Search for 3-5 competitors in the same product category and compare their portal UX
4. Identify the TOP 5 most impactful portal improvements

OUTPUT: Write EXACTLY 10 ideas to ideas/portal_design_latest.md in this format:

# 🖥️ Portal Design Ideas — [date]
## Idea 1: [Title]
**Priority:** HIGH/MEDIUM/LOW
**Category:** Dashboard/Workflow/Reports/Admin/Visualizations/Tables/States
**Current state:** What the portal looks like now for this feature
**Proposed change:** Detailed description with specific UI/UX changes
**Why it matters:** User experience impact, retention, professionalism
**Implementation guide:** Step-by-step — files, components, CSS classes, JS logic
**Data requirements:** What API endpoints or DB queries are needed

[repeat for all 10 ideas]

RULES:
- Do NOT modify any source files — ONLY write to ideas/portal_design_latest.md
- Each idea must include enough detail for a developer to implement it fully
- Skip ideas already in the IMPLEMENTED LOG below
- Think like a product designer at a top SaaS company
- Include mockup descriptions or ASCII layouts where helpful

FORMAT: For each idea, include:
- **Priority**: high / medium / low
- **Impact**: 1-10 (10 = game-changing)
- **Effort**: small / medium / large
Order ideas by impact score (highest first).
PROMPTEOF
)
fi  # end prompt file fallback

# Inject project-specific context if available
if [ -n "${PROJECT_CONTEXT:-}" ]; then
  PROMPT="${PROMPT}

═══════════════════════════════════════════════════════════════════════
PROJECT-SPECIFIC CONTEXT:
${PROJECT_CONTEXT}
═══════════════════════════════════════════════════════════════════════"
fi

SMART_CTX=$(get_smart_context "designer-portal")
CONTEXT=$(cat <<CTXEOF

${SMART_CTX}

ALREADY IMPLEMENTED (skip these):
${IMPLEMENTED:-  (none yet)}
CTXEOF
)

cd "$IDEAS_DIR" || exit 1
update_agent_status "designer-portal" "running" "Analyzing portal ergonomics & generating 10 ideas"

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
echo "Portal Designer Finished: $(date) (exit: $EXIT_CODE)" >> "$LOG_FILE"

# Validate output file was created with content
OUTPUT_FILE="${IDEAS_DIR}/portal_design_latest.md"
if [ ! -f "$OUTPUT_FILE" ] || [ $(wc -l < "$OUTPUT_FILE" 2>/dev/null || echo 0) -lt 5 ]; then
  echo "⚠ Output file missing or too short — agent may have failed silently" >> "$LOG_FILE"
  "$NOTIFY" "Portal Designer: output file empty or missing" >> "$LOG_FILE" 2>&1
else
  index_agent_output "designer-portal" "$OUTPUT_FILE"
fi

[ $EXIT_CODE -ne 0 ] && "$NOTIFY" "Portal Designer agent failed (exit $EXIT_CODE)" >> "$LOG_FILE" 2>&1
update_agent_status "designer-portal" "idle" "" "$EXIT_CODE"
exit $EXIT_CODE
