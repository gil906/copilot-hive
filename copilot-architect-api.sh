#!/bin/bash

# Load central configuration & shared agent helpers
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/config.sh"
source "${SCRIPT_DIR}/lib/agent-helpers.sh"
init_agent_env "architect-api" "$@"

# ══════════════════════════════════════════════════════════════════════
#  API ARCHITECT — Research agent (READ-ONLY)
#  Analyzes the API container, scanners, tools, orchestration, performance
#  Writes 10 detailed ideas to ideas/api_architect_latest.md
# ══════════════════════════════════════════════════════════════════════

PROJECT_DIR="${PROJECT_DIR:-/opt/yourproject}"
NOTIFY="${NOTIFY:-${SCRIPT_DIR}/notify-smartthings.sh}"
IDEAS_DIR="${IDEAS_DIR:-${SCRIPT_DIR}/ideas}"
COPILOT="${COPILOT:-$(command -v copilot 2>/dev/null || echo /usr/local/bin/copilot)}"

mkdir -p "$IDEAS_DIR"
check_agent_paused "architect-api"

# Prevent concurrent runs of same agent
acquire_agent_lock "architect-api${PROJECT_ID:+-$PROJECT_ID}" || { echo "$(date) — SKIPPED: Another instance already running" >> "$LOG_FILE"; exit 0; }

echo "======================================" >> "$LOG_FILE"
echo "API Architect Started: $(date)" >> "$LOG_FILE"
update_agent_status "architect-api" "running" "Starting API architecture analysis"

# ── Urgent Admin Ideas Check ─────────────────────────────────────────────────
handle_urgent_admin_idea "architect-api" "API Architect" || true

IMPLEMENTED=""
[ -f "${IDEAS_DIR}/implemented.log" ] && IMPLEMENTED=$(tail -100 "${IDEAS_DIR}/implemented.log" 2>/dev/null)

# ── Load prompt from file if available ────────────────────────────────
PROMPT_FILE="${SCRIPTS_DIR}/prompts/api-architect.md"
if [ -f "$PROMPT_FILE" ]; then
  PROMPT=$(cat "$PROMPT_FILE")
  echo "Loaded prompt from $PROMPT_FILE" >> "$LOG_FILE"
else
  # Fallback to inline prompt below
PROMPT=$(cat <<'PROMPTEOF'
You are the API ARCHITECT agent for the project at /opt/yourproject. You analyze the backend architecture, APIs, and performance.

You are a READ-ONLY research agent. You CANNOT modify any source code. You analyze and write ideas ONLY.

YOUR FOCUS: The BACKEND & API — architecture, tools, orchestration, performance:
- Core application modules: how tasks are initiated, processed, and results collected
- Task orchestration: parallel execution, timeouts, resource limits, queue management
- Installed tools and dependencies: what external tools or services are used
- API endpoints: REST/GraphQL design, error handling, pagination, rate limiting
- Database queries: optimization, indexes, connection pooling
- New capability ideas: what tools or integrations could be added
- Result enrichment: data quality, scoring, cross-referencing, formatting
- Report/output generation: quality, data completeness, professional formatting
- Performance: speed, memory usage, CPU optimization
- Docker/container setup: multi-stage builds, layer caching, image size, health checks
- Security of the API itself: auth, input validation, CORS, rate limiting
- Webhook/notification system for task completion
- Scheduled task improvements and comparison features
- Caching strategy and data pipeline optimization

STEPS:
1. READ all backend code — routes, modules, orchestrator/workers, models, Dockerfile
2. Analyze the installed tools/dependencies and how they're invoked
3. Research what top platforms in this product category offer in their APIs
4. Identify the TOP 5 most impactful backend improvements

OUTPUT: Write EXACTLY 10 ideas to ideas/api_architect_latest.md in this format:

# ⚙️ API Architecture Ideas — [date]
## Idea 1: [Title]
**Priority:** HIGH/MEDIUM/LOW
**Category:** Modules/Orchestrator/API/Database/Docker/Performance/Security
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
- Think like a senior backend engineer optimizing for production workloads
- Consider the full tool/dependency inventory when suggesting improvements

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

SMART_CTX=$(get_smart_context "architect-api")
CONTEXT=$(cat <<CTXEOF

${SMART_CTX}

ALREADY IMPLEMENTED (skip these):
${IMPLEMENTED:-  (none yet)}
CTXEOF
)

cd "$IDEAS_DIR" || exit 1
update_agent_status "architect-api" "running" "Analyzing backend architecture & generating 10 ideas"

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

# Validate output file was created with content
OUTPUT_FILE="${IDEAS_DIR}/api_architect_latest.md"
if [ ! -f "$OUTPUT_FILE" ] || [ $(wc -l < "$OUTPUT_FILE" 2>/dev/null || echo 0) -lt 5 ]; then
  echo "⚠ Output file missing or too short — agent may have failed silently" >> "$LOG_FILE"
  "$NOTIFY" "API Architect: output file empty or missing" >> "$LOG_FILE" 2>&1
else
  index_agent_output "architect-api" "$OUTPUT_FILE"
fi

[ $EXIT_CODE -ne 0 ] && "$NOTIFY" "API Architect agent failed (exit $EXIT_CODE)" >> "$LOG_FILE" 2>&1
update_agent_status "architect-api" "idle" "" "$EXIT_CODE"
exit $EXIT_CODE
