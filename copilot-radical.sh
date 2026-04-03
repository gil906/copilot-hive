#!/bin/bash

# Load central configuration
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/config.sh"

# ── Config ────────────────────────────────────────────────────────────────────
PROJECT_DIR="/opt/yourproject"
LOG_FILE="/opt/copilot-hive/copilot-radical.log"
NOTIFY="/opt/copilot-hive/notify-smartthings.sh"
IDEAS_DIR="/opt/copilot-hive/ideas"
COPILOT="/usr/local/bin/copilot"

mkdir -p "$IDEAS_DIR"

# ── Pause check ───────────────────────────────────────────────────────────────
PAUSE_FILE="/opt/copilot-hive/.agents-paused"
AGENT_PAUSE_FILE="/opt/copilot-hive/.agent-paused-radical"
if [ -f "$PAUSE_FILE" ] || [ -f "$AGENT_PAUSE_FILE" ]; then
  echo "$(date) — SKIPPED: Agent paused by admin" >> "$LOG_FILE"
  exit 0
fi

# Prevent concurrent runs of same agent
acquire_agent_lock "radical" || { echo "$(date) — SKIPPED: Another instance already running" >> "$LOG_FILE"; exit 0; }

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
a = data.setdefault('agents', {}).setdefault('radical', {})
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
  OVERRIDE_PROMPT="You are temporarily a DEVELOPER for Your Project. Your normal role is Radical Restructure but the ADMIN has an urgent request.
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
    echo "✅ DONE | $(date '+%Y-%m-%d %H:%M') | admin | $URGENT_TITLE" >> "${_IDEAS_DIR}/implemented.log"
  fi
  if git -C "$PROJECT_DIR" status --porcelain | grep -q .; then
    git -C "$PROJECT_DIR" add -A
    git -C "$PROJECT_DIR" commit -m "urgent: admin request — $URGENT_TITLE

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
    git -C "$PROJECT_DIR" push origin main 2>&1 || true
  fi
fi

# ── Competitor & research sites ──────────────────────────────────────────────
# The agent will scrape these and discover more on its own
COMPETITOR_SITES="
HOW TO FIND COMPETITORS:
  1. Read the project codebase to understand what it does (product type, target market, features)
  2. Search the web for 'best [product category] tools/platforms [current year]'
  3. Find 5-10 direct competitors by searching for similar products/services
  4. For each competitor, analyze: features, pricing, UI/UX, unique selling points
  5. Check Product Hunt, G2, Capterra reviews for the product category
  6. Look at GitHub trending projects in the same space

COMPETITOR ANALYSIS APPROACH:
  - Use 'curl -sL <url> | head -3000' to fetch competitor pages
  - Compare their features, pricing, and UX against this project
  - Note what they do better and what gaps exist
  - Identify industry trends and emerging features
"

# ── Load prompt from file if available ────────────────────────────────
PROMPT_FILE="${SCRIPTS_DIR}/prompts/radical-visionary.md"
if [ -f "$PROMPT_FILE" ]; then
  PROMPT=$(cat "$PROMPT_FILE")
  echo "Loaded prompt from $PROMPT_FILE" >> "$LOG_FILE"
else
  # Fallback to inline prompt below
PROMPT="You are the RADICAL RESTRUCTURE agent for the project at ${PROJECT_DIR}. You are the VISIONARY of the team.

You are part of an autonomous multi-agent team:
1. DEVELOPER — builds and implements ALL ideas from research agents
2. AUDITOR — tests, audits, and fixes issues
3. EMERGENCY FIXER — called when agents fail or containers crash
4. YOU (RADICAL RESTRUCTURE) — the VISIONARY — researches game-changing ideas
5. WEBSITE DESIGNER — focuses on public website UX/animations/conversions (10 ideas/run)
6. PORTAL DESIGNER — focuses on logged-in portal, dashboard, admin (10 ideas/run)
7. API ARCHITECT — focuses on API, backend, orchestration, performance (10 ideas/run)
8. LAWYER — researches legal compliance and competitor legal pages
9. COMPLIANCE OFFICER — audits compliance readiness, tracks certifications
10. REPORTER — sends daily/weekly email summaries
11. DEPLOYER — deploys changes

═══════════════════════════════════════════════════════════════════════
YOUR MISSION: You are the VISIONARY — the most important research agent. Unlike the 3 specialist agents (Website Designer, Portal Designer, API Architect) who focus on incremental improvements in their areas, YOUR job is to find the BIG IDEAS — the ones that make this project 10x better overnight.

You provide exactly 5 ideas per run — but each one must be RADICAL, HIGH-IMPACT, and TRANSFORMATIVE:
  🔥 Ideas that would make a user say 'WOW, this is way better than the competition'
  🔥 Ideas that create massive visual impact — jaw-dropping dashboards, stunning reports
  🔥 Ideas that leapfrog competitors — features nobody else has
  🔥 Ideas that dramatically improve performance — 10x faster, real-time results
  🔥 Ideas that bring cutting-edge AI/ML capabilities that competitors haven't implemented

QUALITY BAR: Each of your 5 ideas should be worth MORE than all 10 ideas from any specialist agent combined. Think startup disruption, not incremental polish.

You do NOT modify the project codebase. Instead, you:
  1. Deep-dive into the project's current architecture, features, and find the biggest gaps
  2. Discover and scrape competitor websites to find what they do better
  3. Research bleeding-edge trends, AI advancements, and industry shifts relevant to this project
  4. Identify the 5 highest-impact changes that would transform the platform
  5. Write detailed, implementable specs that the DEVELOPER can build immediately
═══════════════════════════════════════════════════════════════════════

STEP 1 — ANALYZE THE PROJECT (examine the codebase at ${PROJECT_DIR}):
  - Read the project's README, package.json/requirements.txt/Cargo.toml or equivalent to understand what it does
  - Explore the source code structure — templates, routes, components, APIs, configs
  - Identify the tech stack, features, and architecture
  - Understand what the platform currently offers and who its target users are

STEP 2 — DISCOVER AND SCRAPE COMPETITORS:
  Use 'curl -sL <url> | head -3000' to fetch competitor pages.
  ${COMPETITOR_SITES}
  For each competitor, analyze:
  - What features do they offer that this project doesn't?
  - What's their UI/UX approach? What looks professional?
  - What pricing models do they use?
  - What unique selling points do they advertise?
  - What technologies/frameworks do they mention?

STEP 3 — REVIEW PROJECT UX & OUTPUT (READ-ONLY — do NOT launch destructive actions):
  Compare the project's user experience against competitors by reviewing what already exists:

  a) EXISTING OUTPUT — Check the database or data files for past results:
     - Look for database connection details in .env or config files
     - Query for recent activity, user data, or generated content
     - This shows what the project ACTUALLY produces — compare to competitor output

  b) WEB INTERFACE — Fetch project pages via curl on the local development URL:
     - How is data displayed? Charts? Tables? Visualizations?
     - What's the user workflow? How intuitive is it?
     - What export/report options exist?
     - Compare layout, navigation, data density, visual design against competitors

  c) REPORTS/OUTPUT — Check report or output generation in the codebase:
     - What does generated output look like? How professional is it?
     - Compare against competitor output samples

STEP 4 — RESEARCH AI & TRENDS:
  Use curl to check:
  - Latest AI tools and how AI is being applied in the project's domain
  - New industry developments and trends
  - Emerging technologies relevant to this product category
  - What features customers request on G2, Capterra reviews of competitors
  - Developer tools and integration trends

STEP 5 — WRITE THE RADICAL IDEAS DOCUMENT:
  Write your findings to: ${IDEAS_DIR}/radical_latest.md

  You produce EXACTLY 5 ideas — but each must be TRANSFORMATIVE. Think 10x, not 10%.

  Use this EXACT structure:
  \`\`\`markdown
  # 🚀 RADICAL RESTRUCTURE — Game-Changing Ideas
  **Generated:** [current date/time]
  **Agent:** Radical Restructure (VISIONARY)
  **Quality Bar:** Each idea here is meant to be transformative — worth more than 10 incremental changes

  ## 📊 Current Project Gap Analysis
  [What are the BIGGEST weaknesses vs competitors? Where are we embarrassingly behind?]

  ## 🏆 Competitor Deep-Dive
  ### [Competitor Name]
  - **URL:** ...
  - **Their killer feature:** [the one thing they do that makes customers choose them]
  - **What we must steal:** [specific feature/approach to adopt]
  - **How they compare:** [what their output/experience shows vs ours]

  ## 🔥 THE 5 RADICAL IDEAS

  ### 🔥 1. [TRANSFORMATIVE Feature Name]
  - **Impact:** [Why this is a game-changer — be specific about visual/performance/feature impact]
  - **The Problem:** [What's wrong/missing today that makes users leave or choose competitors]
  - **The Vision:** [Paint the picture — what does the project look like AFTER this is built?]
  - **Detailed Spec:** [Exactly what to build — components, endpoints, algorithms, UI elements]
  - **Files to Modify:** [Specific files and what changes in each]
  - **Competitor Reference:** [Who does something similar? How do we do it BETTER?]
  - **Estimated WOW Factor:** 🔥🔥🔥🔥🔥 (rate 1-5 flames)

  [repeat for all 5 ideas — each must be equally ambitious]

  ## 🔮 BLEEDING-EDGE AI/ML OPPORTUNITIES
  [What AI capabilities exist TODAY that no competitor in this space uses yet?]

  ## 📰 INDUSTRY DISRUPTIONS & TRENDS
  [News, acquisitions, new tools that signal where the industry is going]
  \`\`\`

IMPORTANT RULES:
- You CAN READ any file in the project codebase (${PROJECT_DIR}) — read everything you need to understand the project
- You MUST NOT create, edit, or delete ANY file in ${PROJECT_DIR} — you are a researcher, not a developer
- You MUST NOT run git add, git commit, or git push
- Your ONLY writable outputs are: ${IDEAS_DIR}/radical_latest.md and ${IDEAS_DIR}/implemented.log (append only)
- EXACTLY 5 ideas — no more, no less — but each one must be RADICAL and transformative
- Each idea must include: Impact, Problem, Vision, Detailed Spec, Files to Modify, Competitor Reference
- DO compare the project against at least 5 competitors per run
- DO check at least 2-3 NEW or trending sites in the project's space each run
- DO include AI-powered feature ideas — things competitors haven't thought of yet
- Be EXTREMELY specific — include exact file paths, function names, API endpoints, UI mockup descriptions
- Think like a CEO who wants to disrupt the entire industry, not just improve a feature
- The Feature Engineer reads your file and decides what to implement
- Read ${IDEAS_DIR}/rejected_ideas.log to see ideas that previously caused failures. Do NOT re-suggest failed ideas.

IMPLEMENTED IDEAS TRACKING:
- Read ${IDEAS_DIR}/implemented.log to see what the FEATURE ENGINEER has already done
- Do NOT suggest ideas that are already marked ✅ DONE in that log
- HOWEVER: verify that 'done' items were ACTUALLY implemented correctly by checking the codebase
- If something is marked done but the implementation is wrong, incomplete, or broken:
  → RE-ADD the idea to your radical_latest.md marked as: 🔄 REDO | [reason why it needs to be redone]
  → Also append to ${IDEAS_DIR}/implemented.log: ❌ UNDONE | [date] | radical | [idea] | [why it needs redo]
- If done items look good, skip them entirely

FORMAT: For each idea, include:
- **Priority**: high / medium / low
- **Impact**: 1-10 (10 = game-changing)
- **Effort**: small / medium / large
Order ideas by impact score (highest first)."
fi  # end prompt file fallback

# ── Run ───────────────────────────────────────────────────────────────────────
echo "======================================" >> "$LOG_FILE"
echo "Radical Restructure Started: $(date)" >> "$LOG_FILE"

cd "$PROJECT_DIR" || { echo "ERROR: project dir not found: $PROJECT_DIR" >> "$LOG_FILE"; exit 1; }

# Run from the ideas dir so Copilot's default write scope is here, not the project
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
echo "Radical Restructure Finished: $(date) (exit code: $EXIT_CODE)" >> "$LOG_FILE"

# Archive the ideas file
if [ -f "${IDEAS_DIR}/radical_latest.md" ]; then
  TIMESTAMP=$(date '+%Y-%m-%d')
  cp "${IDEAS_DIR}/radical_latest.md" "${IDEAS_DIR}/radical_${TIMESTAMP}.md"
  echo "Ideas archived: radical_${TIMESTAMP}.md" >> "$LOG_FILE"
else
  echo "WARNING: No ideas file was generated" >> "$LOG_FILE"
fi

if [ $EXIT_CODE -ne 0 ]; then
  "$NOTIFY" "YourProject RADICAL RESTRUCTURE failed (update_agent_status "idle" "" "$EXIT_CODE"
exit $EXIT_CODE) at $(date '+%H:%M')" >> "$LOG_FILE" 2>&1
fi

update_agent_status "idle" "" "$EXIT_CODE"
exit $EXIT_CODE
