#!/bin/bash
# Copilot Hive — Research Agent Template
# Customize: AGENT_NAME, FOCUS_AREAS, IDEAS_COUNT, OUTPUT_FILE

AGENT_NAME="{{AGENT_NAME}}"
PROJECT_DIR="{{PROJECT_DIR}}"
IDEAS_DIR="{{SCRIPTS_DIR}}/ideas"
LOG_FILE="{{SCRIPTS_DIR}}/copilot-${AGENT_NAME}.log"
COPILOT="/usr/local/bin/copilot"
OUTPUT_FILE="${IDEAS_DIR}/{{OUTPUT_FILE}}"
IDEAS_COUNT={{IDEAS_COUNT}}

mkdir -p "$IDEAS_DIR"

# Pause check
[ -f "{{SCRIPTS_DIR}}/.agents-paused" ] && exit 0
[ -f "{{SCRIPTS_DIR}}/.agent-paused-${AGENT_NAME}" ] && exit 0

PROMPT="You are the {{AGENT_ROLE}} agent for [YourProject].
Focus: {{FOCUS_AREAS}}

Read the source code at ${PROJECT_DIR} to understand what exists.
OUTPUT: Write EXACTLY ${IDEAS_COUNT} ideas to ${OUTPUT_FILE}"

cd "$PROJECT_DIR"
"$COPILOT" --prompt "$PROMPT" \
  --deny-tool "bash(git push*)" \
  --deny-tool "bash(git commit*)" \
  --deny-tool "bash(git add*)" \
  --deny-tool "bash(git rm*)" \
  --add-dir "${PROJECT_DIR}:ro" \
  --yolo >> "$LOG_FILE" 2>&1
