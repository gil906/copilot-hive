#!/bin/bash
# ══════════════════════════════════════════════════════════════════════
#  Copilot Hive — Project Setup Agent
#  Uses GitHub Copilot CLI to discover competitors and generate
#  project-specific context for all agents.
#
#  Usage: setup-project.sh <project-id>
#  Called by the dashboard after creating a project config.
# ══════════════════════════════════════════════════════════════════════

HIVE_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECTS_DIR="${HIVE_DIR}/projects"
COPILOT="${COPILOT:-/usr/local/bin/copilot}"

PROJECT_ID="${1:?Usage: setup-project.sh <project-id>}"
PROJECT_DIR_PATH="${PROJECTS_DIR}/${PROJECT_ID}"
PROJECT_FILE="${PROJECT_DIR_PATH}/project.json"
SETUP_LOG="${PROJECT_DIR_PATH}/setup.log"

if [ ! -f "$PROJECT_FILE" ]; then
  echo "ERROR: Project config not found: $PROJECT_FILE" >&2
  exit 1
fi

# Update setup status
update_setup_status() {
  local status="$1" step="$2"
  python3 -c "
import json
with open('${PROJECT_FILE}') as f: data = json.load(f)
data['setup_status'] = '$status'
data['setup_step'] = '$step'
with open('${PROJECT_FILE}', 'w') as f: json.dump(data, f, indent=2)
" 2>/dev/null
}

update_setup_status "running" "Starting setup"
echo "$(date) — Setup started for project: $PROJECT_ID" > "$SETUP_LOG"

# Read project description
PROJECT_DESC=$(python3 -c "
import json
with open('${PROJECT_FILE}') as f: data = json.load(f)
print(data.get('description', ''))
" 2>/dev/null)

SOURCE_PATH=$(python3 -c "
import json
with open('${PROJECT_FILE}') as f: data = json.load(f)
print(data.get('path', ''))
" 2>/dev/null)

GITHUB_REPO=$(python3 -c "
import json
with open('${PROJECT_FILE}') as f: data = json.load(f)
print(data.get('github_repo', ''))
" 2>/dev/null)

# ── Step 1: Clone/verify project source ──────────────────────────────
update_setup_status "running" "Preparing project source"
if [ -n "$GITHUB_REPO" ] && [ ! -d "$SOURCE_PATH" ]; then
  echo "$(date) — Cloning $GITHUB_REPO to $SOURCE_PATH" >> "$SETUP_LOG"
  git clone "https://github.com/${GITHUB_REPO}.git" "$SOURCE_PATH" >> "$SETUP_LOG" 2>&1
  if [ $? -ne 0 ]; then
    update_setup_status "failed" "Git clone failed"
    echo "$(date) — ERROR: Clone failed" >> "$SETUP_LOG"
    exit 1
  fi
elif [ ! -d "$SOURCE_PATH" ]; then
  echo "$(date) — WARNING: Source path does not exist: $SOURCE_PATH" >> "$SETUP_LOG"
  mkdir -p "$SOURCE_PATH"
fi

# ── Step 2: Use Copilot CLI to analyze project and discover competitors ──
update_setup_status "running" "Analyzing project with Copilot CLI"

CONTEXT_FILE="${PROJECT_DIR_PATH}/context.json"
SETUP_IDEAS_DIR="${PROJECT_DIR_PATH}/ideas"
mkdir -p "$SETUP_IDEAS_DIR"

SETUP_PROMPT="You are a project analyst for the Copilot Hive autonomous agent swarm. Your job is to analyze a software project and discover its competitive landscape so that our AI agents can provide project-specific insights.

PROJECT DESCRIPTION (from the owner):
${PROJECT_DESC}

PROJECT SOURCE CODE: ${SOURCE_PATH}

YOUR TASKS:
1. READ the project source code to understand:
   - What does it do? (product type, core features)
   - What tech stack does it use? (languages, frameworks, databases)
   - Who is the target market? (developers, enterprises, consumers, etc.)
   - What industry/category is it in?

2. DISCOVER COMPETITORS:
   - Based on what the project does, search the web for similar products/services
   - Find 5-10 direct competitors with their URLs
   - For each competitor, note: name, URL, key features, pricing model, unique selling points
   - Look at their legal pages (terms, privacy, etc.) and note the URLs

3. IDENTIFY RELEVANT COMPLIANCE FRAMEWORKS:
   - Based on the project's industry and what data it handles
   - Which compliance standards are relevant? (GDPR, SOC2, HIPAA, PCI-DSS, etc.)

4. WRITE the analysis to: ${CONTEXT_FILE}
   Use this EXACT JSON format:
   \`\`\`json
   {
     \"project_analysis\": {
       \"product_type\": \"what kind of product this is\",
       \"tech_stack\": \"languages, frameworks, databases found\",
       \"target_market\": \"who uses this\",
       \"industry\": \"the industry category\",
       \"core_features\": [\"feature1\", \"feature2\", ...]
     },
     \"competitors\": [
       {
         \"name\": \"Competitor Name\",
         \"url\": \"https://competitor.com\",
         \"features\": \"key features they offer\",
         \"notes\": \"pricing, unique selling points\"
       }
     ],
     \"legal_sites\": [
       {
         \"name\": \"Competitor Name\",
         \"url\": \"https://competitor.com\",
         \"pages\": [\"terms\", \"privacy\", \"acceptable-use\"]
       }
     ],
     \"compliance_frameworks\": [
       {
         \"name\": \"GDPR\",
         \"relevant\": true,
         \"reason\": \"why this framework applies\"
       }
     ]
   }
   \`\`\`

RULES:
- Only write to ${CONTEXT_FILE} — do NOT modify any project source code
- Be thorough in competitor discovery — the agents depend on this data
- Include real, working URLs that you've verified with curl
- If you can't find competitors, explain why and suggest search terms"

echo "$(date) — Running Copilot CLI for competitor discovery..." >> "$SETUP_LOG"

cd "$SETUP_IDEAS_DIR"
"$COPILOT" --prompt "$SETUP_PROMPT" --yolo \
  --add-dir "$SOURCE_PATH" \
  --allow-all-urls \
  --deny-tool 'shell(git push)' \
  --deny-tool 'shell(git commit)' \
  --deny-tool 'shell(git add)' \
  --deny-tool 'shell(rm:*)' \
  >> "$SETUP_LOG" 2>&1

COPILOT_EXIT=$?
echo "$(date) — Copilot CLI finished (exit: $COPILOT_EXIT)" >> "$SETUP_LOG"

# ── Step 3: Merge discovered data back into project.json ─────────────
update_setup_status "running" "Merging discovered data"

if [ -f "$CONTEXT_FILE" ]; then
  python3 -c "
import json

# Load project config
with open('${PROJECT_FILE}') as f:
    project = json.load(f)

# Load context (discovered by Copilot)
try:
    with open('${CONTEXT_FILE}') as f:
        context = json.load(f)
except Exception as e:
    print(f'Warning: Could not parse context.json: {e}')
    context = {}

# Merge competitors
if 'competitors' in context:
    project['competitors'] = context['competitors']

# Merge legal sites
if 'legal_sites' in context:
    project['legal_sites'] = context['legal_sites']

# Merge analysis
if 'project_analysis' in context:
    analysis = context['project_analysis']
    if analysis.get('tech_stack'):
        project['tech_stack'] = analysis['tech_stack']
    if analysis.get('target_market'):
        project['target_market'] = analysis['target_market']
    if analysis.get('industry'):
        project['industry'] = analysis['industry']
    if analysis.get('product_type'):
        project['product_type'] = analysis['product_type']

# Merge compliance
if 'compliance_frameworks' in context:
    project['compliance_frameworks'] = context['compliance_frameworks']

project['setup_status'] = 'complete'
project['setup_step'] = 'Done'

with open('${PROJECT_FILE}', 'w') as f:
    json.dump(project, f, indent=2)

print('Project config updated with discovered data')
" >> "$SETUP_LOG" 2>&1
else
  echo "$(date) — WARNING: No context.json generated by Copilot" >> "$SETUP_LOG"
  update_setup_status "complete" "Done (no competitor data discovered)"
fi

echo "$(date) — Setup complete for project: $PROJECT_ID" >> "$SETUP_LOG"
