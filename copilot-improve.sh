#!/bin/bash

# Load central configuration & shared agent helpers
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/config.sh"
source "${SCRIPT_DIR}/lib/agent-helpers.sh"
init_agent_env "improve" "$@"
START_TIME=$(date +%s)

# ── Dry-run mode ─────────────────────────────────────────────────────
DRY_RUN=false
if [ "${1:-}" = "--dry-run" ] || [ "${DRY_RUN_MODE:-}" = "true" ]; then
  DRY_RUN=true
  echo "$(date) — DRY RUN MODE: No git push will occur" >> "$LOG_FILE"
fi

# ── Config ────────────────────────────────────────────────────────────────────
PROJECT_DIR="${PROJECT_DIR:-/opt/yourproject}"
COMPOSE_FILE="${COMPOSE_FILE:-/opt/docker-compose/yourproject.yml}"
NOTIFY="${NOTIFY:-${SCRIPT_DIR}/notify-smartthings.sh}"
CHANGELOG_DIR="${CHANGELOG_DIR:-${SCRIPT_DIR}/changelogs}"
IDEAS_DIR="${IDEAS_DIR:-${SCRIPT_DIR}/ideas}"
COPILOT="${COPILOT:-$(command -v copilot 2>/dev/null || echo /usr/local/bin/copilot)}"

check_agent_paused "improve"
update_agent_status "improve" "running" "Starting feature implementation cycle"

# ── Urgent Admin Ideas Check ─────────────────────────────────────────────────
if handle_urgent_admin_idea "improve" "Feature Engineer"; then
  echo "$(date) — Exiting after urgent request. Normal features deferred to next cycle." >> "$LOG_FILE"
  update_agent_status "improve" "idle" "" "0"
  exit 0
fi

# ── Load prompt from file if available ────────────────────────────────
PROMPT_FILE="${SCRIPTS_DIR}/prompts/developer.md"
if [ -f "$PROMPT_FILE" ]; then
  PROMPT=$(cat "$PROMPT_FILE")
  echo "Loaded prompt from $PROMPT_FILE" >> "$LOG_FILE"
else
  # Fallback to inline prompt below
PROMPT="You are the DEVELOPER agent for the project at ${PROJECT_DIR}. You are the ONLY agent that writes code.

You are part of an autonomous multi-agent team:
1. YOU (DEVELOPER) — the ONLY agent that writes code. Implements ALL ideas from research agents.
2. AUDITOR — tests, audits, and fixes issues (runs after you in the pipeline)
3. EMERGENCY FIXER — called automatically on failures
4. WEBSITE DESIGNER — analyzes public website UX, animations, conversions (writes web_design_latest.md)
5. PORTAL DESIGNER — analyzes logged-in portal, dashboard, admin panel (writes portal_design_latest.md)
6. API ARCHITECT — analyzes backend, APIs, orchestration, performance (writes api_architect_latest.md)
7. RADICAL RESTRUCTURE — researches competitors, AI trends (writes radical_latest.md)
8. LAWYER — researches legal compliance (writes lawyer_latest.md)
9. COMPLIANCE OFFICER — audits certifications (writes compliance_latest.md)
10. REPORTER — sends daily/weekly email summaries
11. DEPLOYER — deploys changes on push

Your job is to IMPLEMENT every idea from all 6 research agents as fast as possible.

The source code is in this directory. The docker-compose file is at ${COMPOSE_FILE}. Update both source code and docker-compose as needed.

YOUR ROLE:
You are the creative builder — a senior full-stack developer and product designer. You design, implement, and ship new features and improvements. First, read the codebase to understand what the project does, then implement ideas that push the platform to match or exceed competitors.

YOUR RESPONSIBILITIES:

1. NEW FEATURES — Implement capabilities suggested by the research agents. Read their ideas files to know what to build. Prioritize features that differentiate this project from competitors.

2. UI/UX IMPROVEMENTS — Make the interface more professional, polished, and intuitive. Improve navigation, add smooth animations and transitions, enhance data visualizations, improve empty states, and ensure every page looks production-ready.

3. MOBILE EXPERIENCE — Ensure every page and feature works flawlessly on phones and tablets. Touch-friendly controls, responsive layouts, proper font sizes, no horizontal scrolling, collapsible menus, and swipe-friendly interfaces.

4. API & BACKEND — Add new API endpoints, improve existing ones, optimize database queries, add proper error handling, implement caching where beneficial, and ensure all endpoints return consistent, well-documented responses.

5. CORE CAPABILITIES — Make the project's core functionality smarter, faster, and more comprehensive. Add new modules, improve accuracy, reduce errors, and enrich output with detailed, actionable information.

6. ARCHITECTURE & DESIGN — Improve code organization, add missing abstractions, optimize performance, enhance the Docker setup, and ensure clean separation of concerns.

7. QUALITY CHECK — Before finishing, review your own changes for syntax errors, import errors, broken templates, missing dependencies, and logical bugs. Run a mental code review. Your partner (the Auditor) will catch issues too, but deliver clean work.

IMPORTANT RULES:
- Never break existing working features — always maintain backward compatibility
- Never delete data directories (data/, pgdata/, reports/, or any persistent storage)
- Never commit secrets or tokens
- Implement changes directly — do not just suggest or describe them
- Think big but ship incrementally — each run should deliver tangible improvements
- READ the ideas files from the research agents (provided below) and implement their best suggestions
- IMPORTANT: Before implementing any idea, check if a similar feature already exists in the codebase or was recently implemented (see implemented.log). Skip duplicate or near-duplicate ideas across different research agent files. Prioritize unique, high-impact ideas.
- Prioritize HIGH PRIORITY items from all agents, but use your judgment on what to build each cycle
- Implement AT LEAST 5-8 ideas or improvements per run — you have time, be productive
- Mix big features (1-2 per run) with smaller improvements (4-6 quick wins: UI polish, new endpoints, backend tweaks, content fixes)
- AFTER implementing an idea, mark it as done in ${IDEAS_DIR}/implemented.log using this format:
    ✅ DONE | [date] | [agent: radical/lawyer/compliance/web-designer/portal-designer/api-architect] | [idea summary]
  This tells all research agents that the idea has been implemented so they stop suggesting it."
fi  # end prompt file fallback

# Inject project-specific context if available
if [ -n "${PROJECT_CONTEXT:-}" ]; then
  PROMPT="${PROMPT}

═══════════════════════════════════════════════════════════════════════
PROJECT-SPECIFIC CONTEXT:
${PROJECT_CONTEXT}
═══════════════════════════════════════════════════════════════════════"
fi

# ── Retry helper for network operations ──────────────────────────────
retry() {
  local max_attempts="${1:-3}" delay="${2:-5}" cmd="${@:3}"
  local attempt=1
  while [ $attempt -le $max_attempts ]; do
    if eval "$cmd"; then
      return 0
    fi
    echo "  Retry $attempt/$max_attempts failed, waiting ${delay}s..." >> "$LOG_FILE"
    sleep "$delay"
    delay=$((delay * 2))
    attempt=$((attempt + 1))
  done
  return 1
}

# ── Run ───────────────────────────────────────────────────────────────────────
echo "======================================" >> "$LOG_FILE"
echo "Started: $(date)" >> "$LOG_FILE"

cd "$PROJECT_DIR" || { echo "ERROR: project dir not found: $PROJECT_DIR" >> "$LOG_FILE"; exit 1; }

# ── Build context from recent changes ─────────────────────────────────
RECENT_CHANGES=$(git -C "$PROJECT_DIR" log --oneline -10 2>/dev/null || echo "  (no git history)")
LAST_DIFF=$(git -C "$PROJECT_DIR" diff HEAD~1 --stat 2>/dev/null | tail -20)
LAST_MSG=$(git -C "$PROJECT_DIR" log -1 --pretty=format:"%s" 2>/dev/null || echo "  (no commits)")

# Load recent failures for context
RECENT_FAILURES=$(grep -E 'FAIL|ERROR|failed|reverted' "${SCRIPTS_DIR}/copilot-improve.log" 2>/dev/null | tail -10)
AUDIT_FEEDBACK=$(grep -E 'fix|bug|issue|revert|broken' "${SCRIPTS_DIR}/copilot-audit.log" 2>/dev/null | tail -10)

# ── Read ideas from research agents ──────────────────────────────────
RADICAL_IDEAS=""
if [ -f "${IDEAS_DIR}/radical_latest.md" ]; then
  # Load full idea files (use cat instead of head -200 for complete context)
  # NOTE: Consider using --add-file flag with Copilot CLI for better handling of large files
  RADICAL_IDEAS=$(cat "${IDEAS_DIR}/radical_latest.md" 2>/dev/null)
  echo "Loaded Radical Restructure ideas ($(wc -l < "${IDEAS_DIR}/radical_latest.md") lines)" >> "$LOG_FILE"
fi

LAWYER_IDEAS=""
if [ -f "${IDEAS_DIR}/lawyer_latest.md" ]; then
  LAWYER_IDEAS=$(cat "${IDEAS_DIR}/lawyer_latest.md" 2>/dev/null)
  echo "Loaded Lawyer recommendations ($(wc -l < "${IDEAS_DIR}/lawyer_latest.md") lines)" >> "$LOG_FILE"
fi

COMPLIANCE_IDEAS=""
if [ -f "${IDEAS_DIR}/compliance_latest.md" ]; then
  COMPLIANCE_IDEAS=$(cat "${IDEAS_DIR}/compliance_latest.md" 2>/dev/null)
  echo "Loaded Compliance requirements ($(wc -l < "${IDEAS_DIR}/compliance_latest.md") lines)" >> "$LOG_FILE"
fi

WEB_DESIGN_IDEAS=""
if [ -f "${IDEAS_DIR}/web_design_latest.md" ]; then
  WEB_DESIGN_IDEAS=$(cat "${IDEAS_DIR}/web_design_latest.md" 2>/dev/null)
  echo "Loaded Website Designer ideas ($(wc -l < "${IDEAS_DIR}/web_design_latest.md") lines)" >> "$LOG_FILE"
fi

PORTAL_DESIGN_IDEAS=""
if [ -f "${IDEAS_DIR}/portal_design_latest.md" ]; then
  PORTAL_DESIGN_IDEAS=$(cat "${IDEAS_DIR}/portal_design_latest.md" 2>/dev/null)
  echo "Loaded Portal Designer ideas ($(wc -l < "${IDEAS_DIR}/portal_design_latest.md") lines)" >> "$LOG_FILE"
fi

API_ARCHITECT_IDEAS=""
if [ -f "${IDEAS_DIR}/api_architect_latest.md" ]; then
  API_ARCHITECT_IDEAS=$(cat "${IDEAS_DIR}/api_architect_latest.md" 2>/dev/null)
  echo "Loaded API Architect ideas ($(wc -l < "${IDEAS_DIR}/api_architect_latest.md") lines)" >> "$LOG_FILE"
fi

DASHBOARD_IDEAS=""
if [ -f "${IDEAS_DIR}/agent_dashboard.md" ]; then
  DASHBOARD_IDEAS=$(cat "${IDEAS_DIR}/agent_dashboard.md" 2>/dev/null)
  echo "Loaded Agent Dashboard requirements ($(wc -l < "${IDEAS_DIR}/agent_dashboard.md") lines)" >> "$LOG_FILE"
fi

ADMIN_IDEAS=""
if [ -f "${IDEAS_DIR}/admin_ideas.json" ]; then
  ADMIN_IDEAS=$(python3 -c "
import json
with open('${IDEAS_DIR}/admin_ideas.json') as f:
    data = json.load(f)
pending = [i for i in data.get('ideas',[]) if i.get('status')=='pending' and not i.get('urgent')]
for i in pending:
    print('ADMIN REQUEST (' + i.get('priority','critical').upper() + '): ' + i['title'])
    if i.get('description'): print('   ' + i['description'][:200])
    print()
" 2>/dev/null)
  echo "Loaded admin ideas" >> "$LOG_FILE"
fi

IMPLEMENTED_LOG=""
if [ -f "${IDEAS_DIR}/implemented.log" ]; then
  IMPLEMENTED_LOG=$(tail -500 "${IDEAS_DIR}/implemented.log" 2>/dev/null)
  echo "Loaded implemented log ($(wc -l < "${IDEAS_DIR}/implemented.log") lines)" >> "$LOG_FILE"
fi

CONTEXT=$(cat <<CTXEOF

════════════════════════════════════════════════════════════════════
ADMIN REQUESTS (IMPLEMENT THESE FIRST — highest priority):
${ADMIN_IDEAS:-  (No admin requests)}
════════════════════════════════════════════════════════════════════

RECENT HISTORY (last 10 commits — the team: Feature Engineer, Auditor, Emergency Fixer, Radical, Lawyer):
${RECENT_CHANGES}

LAST COMMIT BY YOUR PARTNER (the Auditor):
${LAST_MSG}

FILES CHANGED IN LAST COMMIT:
${LAST_DIFF}

RECENT FAILURES (avoid repeating these mistakes):
${RECENT_FAILURES:-  (none)}

AUDITOR FEEDBACK (issues found by your partner):
${AUDIT_FEEDBACK:-  (none)}

════════════════════════════════════════════════════════════════════
IDEAS FROM RADICAL RESTRUCTURE AGENT (competitor research & AI trends):
${RADICAL_IDEAS:-  (No ideas file yet — the Radical agent hasn't run or produced output yet)}
════════════════════════════════════════════════════════════════════

════════════════════════════════════════════════════════════════════
RECOMMENDATIONS FROM LAWYER AGENT (legal compliance & content):
${LAWYER_IDEAS:-  (No legal recommendations yet — the Lawyer agent hasn't run or produced output yet)}
════════════════════════════════════════════════════════════════════

════════════════════════════════════════════════════════════════════
REQUIREMENTS FROM COMPLIANCE OFFICER (certification readiness & gaps):
${COMPLIANCE_IDEAS:-  (No compliance requirements yet — the Compliance agent hasn't run or produced output yet)}
════════════════════════════════════════════════════════════════════

════════════════════════════════════════════════════════════════════
🎨 IDEAS FROM WEBSITE DESIGNER (public website UX, animations, conversions):
${WEB_DESIGN_IDEAS:-  (No website design ideas yet)}
════════════════════════════════════════════════════════════════════

════════════════════════════════════════════════════════════════════
🖥️ IDEAS FROM PORTAL DESIGNER (dashboard, scan UI, admin panel, data viz):
${PORTAL_DESIGN_IDEAS:-  (No portal design ideas yet)}
════════════════════════════════════════════════════════════════════

════════════════════════════════════════════════════════════════════
⚙️ IDEAS FROM API ARCHITECT (scanners, orchestration, performance, Docker):
${API_ARCHITECT_IDEAS:-  (No API architecture ideas yet)}
════════════════════════════════════════════════════════════════════

════════════════════════════════════════════════════════════════════
🔴 CRITICAL: AGENT DASHBOARD (admin requested this directly — implement ASAP):
${DASHBOARD_IDEAS:-  (No agent dashboard requirements)}
════════════════════════════════════════════════════════════════════

CRITICAL: Do NOT revert or undo changes made by the Auditor. Build ON TOP of their fixes. If they fixed a bug, keep that fix. If they restructured something, work with that structure. You are a team.

RESEARCH AGENTS: Review the ideas from Radical, Lawyer, and Compliance above. Pick the best 1-3 actionable items to implement this cycle. Prioritize HIGH PRIORITY and CRITICAL items. Skip anything already in the IMPLEMENTED LOG below.

AFTER implementing each idea, append a line to ${IDEAS_DIR}/implemented.log:
  ✅ DONE | $(date '+%Y-%m-%d %H:%M') | web-designer | [brief description]
  ✅ DONE | $(date '+%Y-%m-%d %H:%M') | portal-designer | [brief description]
  ✅ DONE | $(date '+%Y-%m-%d %H:%M') | api-architect | [brief description]
  ✅ DONE | $(date '+%Y-%m-%d %H:%M') | radical | [brief description]
  ✅ DONE | $(date '+%Y-%m-%d %H:%M') | lawyer | [brief description]
  ✅ DONE | $(date '+%Y-%m-%d %H:%M') | compliance | [brief description]
Use the correct agent name depending on whose idea it was.
Also mention which ideas you implemented in your git commit message.

════════════════════════════════════════════════════════════════════
ALREADY IMPLEMENTED (do NOT redo these — research agents: verify these are still correct):
${IMPLEMENTED_LOG:-  (Nothing implemented yet from research agents)}
════════════════════════════════════════════════════════════════════
CTXEOF
)

SMART_CTX=$(get_smart_context "improve")
FULL_PROMPT="${PROMPT}${CONTEXT}

${SMART_CTX}"
update_agent_status "improve" "running" "Running Copilot CLI feature implementation"
if [ "$DRY_RUN" = true ]; then
  "$COPILOT" --prompt "$FULL_PROMPT" --yolo --allow-all-paths --deny-tool 'shell(git push)' --deny-tool 'shell(git commit)' >> "$LOG_FILE" 2>&1
else
  "$COPILOT" --prompt "$FULL_PROMPT" --yolo --allow-all-paths >> "$LOG_FILE" 2>&1
fi

EXIT_CODE=$?
echo "Finished: $(date) (exit code: $EXIT_CODE)" >> "$LOG_FILE"

if [ $EXIT_CODE -ne 0 ]; then
  update_agent_status "improve" "running" "Failed — calling Emergency Fixer" "$EXIT_CODE"
  "$NOTIFY" "IMPROVE failed (exit $EXIT_CODE) at $(date '+%H:%M')" >> "$LOG_FILE" 2>&1
  echo "Calling Emergency Fixer agent..." >> "$LOG_FILE"
  "${SCRIPTS_DIR}/copilot-emergencyfixer.sh" improve "$EXIT_CODE" >> "$LOG_FILE" 2>&1
fi

# ── Changelog ─────────────────────────────────────────────────────────
update_agent_status "improve" "running" "Saving changelog"
mkdir -p "$CHANGELOG_DIR"
TIMESTAMP=$(date '+%Y-%m-%d_%H%M')
CHANGELOG_FILE="${CHANGELOG_DIR}/improve_${TIMESTAMP}.txt"
{
  echo "============================================"
  echo "  IMPROVE RUN — $(date)"
  echo "  Exit Code: $EXIT_CODE"
  echo "============================================"
  echo ""
  echo "FILES CHANGED:"
  git -C "$PROJECT_DIR" diff --name-status HEAD 2>/dev/null || echo "  (no git diff available)"
  echo ""
  echo "DIFF SUMMARY:"
  git -C "$PROJECT_DIR" diff --stat HEAD 2>/dev/null || echo "  (no stats available)"
  echo ""
  echo "DETAILED CHANGES:"
  git -C "$PROJECT_DIR" diff HEAD 2>/dev/null | head -500
  echo ""
  echo "(truncated to 500 lines — see full log at $LOG_FILE)"
} > "$CHANGELOG_FILE"
echo "Changelog saved: $CHANGELOG_FILE" >> "$LOG_FILE"

# ── Git push changes ─────────────────────────────────────────────────
update_agent_status "improve" "running" "Pushing to GitHub"
PUSHED="no"
BUILD_ID=""
if git -C "$PROJECT_DIR" status --porcelain | grep -q .; then
  # Stamp build version so dispatcher can verify the new container
  BUILD_ID="$(generate_build_id)"
  echo "$BUILD_ID" > "$PROJECT_DIR/.build-id"
  echo "Pushing changes to GitHub (build: $BUILD_ID)..." >> "$LOG_FILE"
  # Validate changes before pushing
  CHANGED_FILES=$(git -C "$PROJECT_DIR" diff --name-only 2>/dev/null)
  if [ -z "$CHANGED_FILES" ]; then
    echo "No actual file changes detected — skipping push" >> "$LOG_FILE"
  else
    # Run basic syntax checks on changed files
    SYNTAX_OK=true
    for f in $CHANGED_FILES; do
      filepath="$PROJECT_DIR/$f"
      [ ! -f "$filepath" ] && continue
      case "$f" in
        *.py)
          python3 -m py_compile "$filepath" 2>/dev/null || {
            echo "⚠ Syntax error in $f — skipping push" >> "$LOG_FILE"
            SYNTAX_OK=false
          }
          ;;
        *.js)
          node --check "$filepath" 2>/dev/null || {
            echo "⚠ Syntax error in $f — skipping push" >> "$LOG_FILE"
            SYNTAX_OK=false
          }
          ;;
        *.sh)
          bash -n "$filepath" 2>/dev/null || {
            echo "⚠ Shell syntax error in $f — skipping push" >> "$LOG_FILE"
            SYNTAX_OK=false
          }
          ;;
      esac
    done
    if [ "$SYNTAX_OK" = false ]; then
      echo "⚠ Syntax errors detected — reverting changes" >> "$LOG_FILE"
      git -C "$PROJECT_DIR" checkout -- . 2>/dev/null
    else
      git -C "$PROJECT_DIR" add -A >> "$LOG_FILE" 2>&1
      git -C "$PROJECT_DIR" commit -m "auto: improve features $(date '+%Y-%m-%d %H:%M')" >> "$LOG_FILE" 2>&1
      if [ "$DRY_RUN" = true ]; then
        echo "DRY RUN: Would push $(git -C "$PROJECT_DIR" diff --stat HEAD 2>/dev/null | tail -1)" >> "$LOG_FILE"
      else
      retry 3 5 "git -C '$PROJECT_DIR' push origin main" >> "$LOG_FILE" 2>&1
      PUSH_CODE=$?
      if [ $PUSH_CODE -eq 0 ]; then
        PUSHED="yes"
      else
        "$NOTIFY" "YourProject IMPROVE git push failed at $(date '+%H:%M')" >> "$LOG_FILE" 2>&1
      fi
      fi  # DRY_RUN
    fi  # SYNTAX_OK
  fi  # CHANGED_FILES
else
  echo "No changes to push." >> "$LOG_FILE"
fi

# ── Report to pipeline dispatcher ────────────────────────────────────
PIPELINE_FILE="${PIPELINE_STATUS_FILE:-${SCRIPTS_DIR}/.pipeline-status}"
if [ -f "$PIPELINE_FILE" ]; then
  source "$PIPELINE_FILE"
  if [ "$PUSHED" = "yes" ]; then
    COMMIT_SHA=$(git -C "$PROJECT_DIR" rev-parse HEAD 2>/dev/null)
    cat > "$PIPELINE_FILE" <<PEOF
PIPELINE_STATE=waiting_deploy
CURRENT_AGENT=
CURRENT_PID=
LAST_AGENT=improve
LAST_FINISHED=$(date +%s)
LAST_COMMIT=$COMMIT_SHA
LAST_BUILD_ID=$BUILD_ID
PUSH_TIME=$(date +%s)
DEPLOY_VERIFIED=no
NEXT_AGENT=${NEXT_AGENT:-audit}
PEOF
    echo "Pipeline: waiting for deploy (build: $BUILD_ID)" >> "$LOG_FILE"
  else
    cat > "$PIPELINE_FILE" <<PEOF
PIPELINE_STATE=idle
CURRENT_AGENT=
CURRENT_PID=
LAST_AGENT=improve
LAST_FINISHED=$(date +%s)
LAST_COMMIT=${LAST_COMMIT:-}
LAST_BUILD_ID=${LAST_BUILD_ID:-}
PUSH_TIME=${PUSH_TIME:-0}
DEPLOY_VERIFIED=yes
NEXT_AGENT=${NEXT_AGENT:-audit}
PEOF
    echo "Pipeline: idle (no changes pushed)" >> "$LOG_FILE"
  fi
fi

index_agent_output "improve" "$CHANGELOG_FILE"
[ -f "${IDEAS_DIR}/implemented.log" ] && index_agent_output "improve" "${IDEAS_DIR}/implemented.log"

# ── Track rejected ideas for future reference ─────────────────────────
REJECTED_LOG="${IDEAS_DIR}/rejected_ideas.log"
if [ "$EXIT_CODE" -ne 0 ]; then
  echo "❌ FAILED | $(date '+%Y-%m-%d %H:%M') | improve | Agent failed (exit $EXIT_CODE) — ideas from this cycle may be problematic" >> "$REJECTED_LOG"
fi

# Track metrics
DURATION=$(($(date +%s) - ${START_TIME:-$(date +%s)}))
"${SCRIPTS_DIR}/track-metrics.sh" "improve" "$EXIT_CODE" "$DURATION" 2>/dev/null

update_agent_status "improve" "idle" "" "$EXIT_CODE"
exit $EXIT_CODE
