#!/bin/bash

# Load central configuration & shared agent helpers
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/config.sh"
source "${SCRIPT_DIR}/lib/agent-helpers.sh"
init_agent_env "designer-web" "$@"

# ══════════════════════════════════════════════════════════════════════
#  WEBSITE DESIGNER — Research agent (READ-ONLY)
#  Analyzes public website UX, animations, landing pages, conversions
#  Writes 10 detailed ideas to ideas/web_design_latest.md
# ══════════════════════════════════════════════════════════════════════

PROJECT_DIR="${PROJECT_DIR:-/opt/yourproject}"
NOTIFY="${NOTIFY:-${SCRIPT_DIR}/notify-smartthings.sh}"
IDEAS_DIR="${IDEAS_DIR:-${SCRIPT_DIR}/ideas}"
COPILOT="${COPILOT:-$(command -v copilot 2>/dev/null || echo /usr/local/bin/copilot)}"

mkdir -p "$IDEAS_DIR"
check_agent_paused "designer-web"

# Prevent concurrent runs of same agent
acquire_agent_lock "designer-web${PROJECT_ID:+-$PROJECT_ID}" || { echo "$(date) — SKIPPED: Another instance already running" >> "$LOG_FILE"; exit 0; }

echo "======================================" >> "$LOG_FILE"
echo "Website Designer Started: $(date)" >> "$LOG_FILE"
update_agent_status "designer-web" "running" "Starting website UX & conversion analysis"

# ── Urgent Admin Ideas Check ─────────────────────────────────────────────────
handle_urgent_admin_idea "designer-web" "Website Designer" || true

# Load implemented log to avoid duplicate ideas
IMPLEMENTED=""
[ -f "${IDEAS_DIR}/implemented.log" ] && IMPLEMENTED=$(tail -100 "${IDEAS_DIR}/implemented.log" 2>/dev/null)

# ── Load prompt from file if available ────────────────────────────────
PROMPT_FILE="${SCRIPTS_DIR}/prompts/website-designer.md"
if [ -f "$PROMPT_FILE" ]; then
  PROMPT=$(cat "$PROMPT_FILE")
  echo "Loaded prompt from $PROMPT_FILE" >> "$LOG_FILE"
else
  # Fallback to inline prompt below
PROMPT=$(cat <<'PROMPTEOF'
You are the WEBSITE DESIGNER agent for the project at /opt/yourproject. You analyze the public-facing website and propose improvements.

You are a READ-ONLY research agent. You CANNOT modify any source code. You analyze and write ideas ONLY.

YOUR FOCUS: The PUBLIC-FACING WEBSITE — everything a visitor sees BEFORE logging in:
- Homepage hero section, value proposition, CTAs
- Navigation, header, footer
- Landing pages (services, pricing, about, contact, how-it-works, blog)
- Animations, transitions, micro-interactions, scroll effects
- Color scheme, typography, spacing, visual hierarchy
- Mobile responsiveness on public pages
- SEO elements, meta tags, structured data
- Social proof, testimonials, trust badges
- Page load speed, image optimization
- Conversion optimization (visitor → signup flow)

STEPS:
1. READ the project source code — focus on templates, CSS, static assets, landing pages
2. If the project has a live URL, fetch it with curl to analyze the live site
3. Search for 3-5 competitors in the same product category and compare their websites
4. Identify the TOP 5 most impactful improvements

OUTPUT: Write EXACTLY 10 ideas to ideas/web_design_latest.md in this format:

# 🎨 Website Design Ideas — [date]
## Idea 1: [Title]
**Priority:** HIGH/MEDIUM/LOW
**Category:** Hero/Nav/Animation/Mobile/SEO/Conversion/Visual
**Current state:** What it looks like now
**Proposed change:** Detailed description with specific CSS/HTML/JS changes
**Why it matters:** Business impact (conversions, trust, professionalism)
**Implementation guide:** Step-by-step for the developer — specific files to edit, code patterns, libraries to use
**Competitor reference:** Which competitor does this well and how

[repeat for all 10 ideas]

RULES:
- Do NOT modify any source files — ONLY write to ideas/web_design_latest.md
- Each idea must be DETAILED enough that a developer can implement it without asking questions
- Skip ideas already in the IMPLEMENTED LOG below
- Focus on HIGH-IMPACT visual and UX improvements
- Be specific: mention exact CSS properties, animation keyframes, component names

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

SMART_CTX=$(get_smart_context "designer-web")
CONTEXT=$(cat <<CTXEOF

${SMART_CTX}

ALREADY IMPLEMENTED (skip these):
${IMPLEMENTED:-  (none yet)}
CTXEOF
)

cd "$IDEAS_DIR" || exit 1
update_agent_status "designer-web" "running" "Analyzing public web UX & generating 10 ideas"

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
echo "Website Designer Finished: $(date) (exit: $EXIT_CODE)" >> "$LOG_FILE"

# Validate output file was created with content
OUTPUT_FILE="${IDEAS_DIR}/web_design_latest.md"
if [ ! -f "$OUTPUT_FILE" ] || [ $(wc -l < "$OUTPUT_FILE" 2>/dev/null || echo 0) -lt 5 ]; then
  echo "⚠ Output file missing or too short — agent may have failed silently" >> "$LOG_FILE"
  "$NOTIFY" "Website Designer: output file empty or missing" >> "$LOG_FILE" 2>&1
else
  index_agent_output "designer-web" "$OUTPUT_FILE"
fi

[ $EXIT_CODE -ne 0 ] && "$NOTIFY" "Website Designer agent failed (exit $EXIT_CODE)" >> "$LOG_FILE" 2>&1
update_agent_status "designer-web" "idle" "" "$EXIT_CODE"
exit $EXIT_CODE
