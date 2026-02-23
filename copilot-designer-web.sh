#!/bin/bash
# ══════════════════════════════════════════════════════════════════════
#  WEBSITE DESIGNER — Research agent (READ-ONLY)
#  Analyzes public website UX, animations, landing pages, conversions
#  Writes 10 detailed ideas to ideas/web_design_latest.md
# ══════════════════════════════════════════════════════════════════════

PROJECT_DIR="/opt/yourproject"
LOG_FILE="/opt/copilot-hive/copilot-designer-web.log"
NOTIFY="/opt/copilot-hive/notify-smartthings.sh"
IDEAS_DIR="/opt/copilot-hive/ideas"
COPILOT="/usr/local/bin/copilot"

mkdir -p "$IDEAS_DIR"

PAUSE_FILE="/opt/copilot-hive/.agents-paused"
AGENT_PAUSE_FILE="/opt/copilot-hive/.agent-paused-designer-web"
if [ -f "$PAUSE_FILE" ] || [ -f "$AGENT_PAUSE_FILE" ]; then
  echo "$(date) — SKIPPED: Agent paused" >> "$LOG_FILE"
  exit 0
fi

echo "======================================" >> "$LOG_FILE"
echo "Website Designer Started: $(date)" >> "$LOG_FILE"

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
  OVERRIDE_PROMPT="You are temporarily a DEVELOPER for Your Project. Your normal role is Website Designer but the ADMIN has an urgent request.
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

# Load implemented log to avoid duplicate ideas
IMPLEMENTED=""
[ -f "${IDEAS_DIR}/implemented.log" ] && IMPLEMENTED=$(tail -100 "${IDEAS_DIR}/implemented.log" 2>/dev/null)

PROMPT=$(cat <<'PROMPTEOF'
You are the WEBSITE DESIGNER agent for Your Project (yourproject.example.com), a professional cybersecurity/security scanning platform.

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
1. READ the YourProject source code — focus on templates, CSS, static assets, landing pages
2. Visit https://yourproject.example.com and analyze the live site (use curl/fetch)
3. Compare against top competitors: cybri.com, security-scan-tools.com, astra.security, attaxion.com, intruder.io
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
PROMPTEOF
)

CONTEXT=$(cat <<CTXEOF

ALREADY IMPLEMENTED (skip these):
${IMPLEMENTED:-  (none yet)}
CTXEOF
)

cd "$IDEAS_DIR" || exit 1

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

[ $EXIT_CODE -ne 0 ] && "$NOTIFY" "Website Designer agent failed (exit $EXIT_CODE)" >> "$LOG_FILE" 2>&1
exit $EXIT_CODE
