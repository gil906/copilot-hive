#!/bin/bash

# ── Config ────────────────────────────────────────────────────────────────────
PROJECT_DIR="/opt/yourproject"
LOG_FILE="/opt/copilot-hive/copilot-gitguardian.log"
NOTIFY="/opt/copilot-hive/notify-smartthings.sh"
CHANGELOG_DIR="/opt/copilot-hive/changelogs"

# ── Run ───────────────────────────────────────────────────────────────────────
echo "======================================" >> "$LOG_FILE"
echo "Git Guardian Started: $(date)" >> "$LOG_FILE"

cd "$PROJECT_DIR" || { echo "ERROR: project dir not found: $PROJECT_DIR" >> "$LOG_FILE"; exit 1; }

ISSUES=0
REPORT=""

# 1. Check for secrets in tracked files
echo "Checking for secrets..." >> "$LOG_FILE"
SECRET_PATTERNS='(password|secret|token|api_key|apikey|private_key|AWS_ACCESS|AWS_SECRET)\s*[:=]\s*["\x27][^"\x27]{8,}'
FOUND_SECRETS=$(git -C "$PROJECT_DIR" grep -inE "$SECRET_PATTERNS" -- '*.py' '*.js' '*.html' '*.yml' '*.yaml' '*.json' '*.env' '*.cfg' '*.conf' 2>/dev/null | \
  grep -v '.gitignore' | \
  grep -v 'os.environ' | \
  grep -v 'os.getenv' | \
  grep -v '{' | \
  grep -v 'example' | \
  grep -v 'placeholder' | \
  grep -v 'your_' | \
  grep -v 'CHANGE_ME' || true)

if [ -n "$FOUND_SECRETS" ]; then
  COUNT=$(echo "$FOUND_SECRETS" | wc -l)
  ISSUES=$((ISSUES + COUNT))
  REPORT="${REPORT}\nPOTENTIAL SECRETS ($COUNT):\n${FOUND_SECRETS}\n"
  echo "  WARNING: $COUNT potential secrets found" >> "$LOG_FILE"
else
  echo "  OK: No secrets detected" >> "$LOG_FILE"
fi

# 2. Check for large files (>5MB)
echo "Checking for large files..." >> "$LOG_FILE"
LARGE_FILES=$(find "$PROJECT_DIR" -not -path '*/.git/*' -not -path '*/pgdata/*' -not -path '*/data/*' -not -path '*/scans_db/*' -not -path '*/reports/*' -not -path '*/__pycache__/*' -type f -size +5M 2>/dev/null || true)

if [ -n "$LARGE_FILES" ]; then
  COUNT=$(echo "$LARGE_FILES" | wc -l)
  ISSUES=$((ISSUES + COUNT))
  REPORT="${REPORT}\nLARGE FILES >5MB ($COUNT):\n${LARGE_FILES}\n"
  echo "  WARNING: $COUNT large files found" >> "$LOG_FILE"
else
  echo "  OK: No oversized files" >> "$LOG_FILE"
fi

# 3. Check .gitignore is intact
echo "Checking .gitignore..." >> "$LOG_FILE"
REQUIRED_IGNORES="data/ pgdata/ reports/ scans_db/ .env"
MISSING_IGNORES=""
for pattern in $REQUIRED_IGNORES; do
  if ! grep -qF "$pattern" "$PROJECT_DIR/.gitignore" 2>/dev/null; then
    MISSING_IGNORES="${MISSING_IGNORES} $pattern"
  fi
done

if [ -n "$MISSING_IGNORES" ]; then
  ISSUES=$((ISSUES + 1))
  REPORT="${REPORT}\nMISSING .gitignore ENTRIES:${MISSING_IGNORES}\n"
  echo "  WARNING: Missing .gitignore entries:${MISSING_IGNORES}" >> "$LOG_FILE"
else
  echo "  OK: .gitignore complete" >> "$LOG_FILE"
fi

# 4. Check for merge conflicts
echo "Checking for merge conflicts..." >> "$LOG_FILE"
CONFLICTS=$(git -C "$PROJECT_DIR" grep -rlE '^(<<<<<<<|=======|>>>>>>>)' -- '*.py' '*.js' '*.html' '*.css' '*.yml' 2>/dev/null || true)

if [ -n "$CONFLICTS" ]; then
  COUNT=$(echo "$CONFLICTS" | wc -l)
  ISSUES=$((ISSUES + COUNT))
  REPORT="${REPORT}\nMERGE CONFLICTS ($COUNT files):\n${CONFLICTS}\n"
  echo "  WARNING: $COUNT files with merge conflicts" >> "$LOG_FILE"
else
  echo "  OK: No merge conflicts" >> "$LOG_FILE"
fi

# 5. Check for broken Python syntax
echo "Checking Python syntax..." >> "$LOG_FILE"
SYNTAX_ERRORS=""
while IFS= read -r pyfile; do
  if ! python3 -m py_compile "$pyfile" 2>/dev/null; then
    SYNTAX_ERRORS="${SYNTAX_ERRORS}\n  $pyfile"
    ISSUES=$((ISSUES + 1))
  fi
done < <(find "$PROJECT_DIR/app" -name '*.py' -type f 2>/dev/null)

if [ -n "$SYNTAX_ERRORS" ]; then
  REPORT="${REPORT}\nPYTHON SYNTAX ERRORS:${SYNTAX_ERRORS}\n"
  echo "  WARNING: Python syntax errors found" >> "$LOG_FILE"
else
  echo "  OK: All Python files valid" >> "$LOG_FILE"
fi

# 6. Check git status is clean (no untracked important files)
echo "Checking for untracked files..." >> "$LOG_FILE"
UNTRACKED=$(git -C "$PROJECT_DIR" ls-files --others --exclude-standard -- '*.py' '*.js' '*.html' '*.css' '*.yml' 2>/dev/null || true)

if [ -n "$UNTRACKED" ]; then
  COUNT=$(echo "$UNTRACKED" | wc -l)
  REPORT="${REPORT}\nUNTRACKED CODE FILES ($COUNT) — should these be committed?:\n${UNTRACKED}\n"
  echo "  INFO: $COUNT untracked code files" >> "$LOG_FILE"
fi

# ── Results ───────────────────────────────────────────────────────────
echo "" >> "$LOG_FILE"
echo "Git Guardian: $ISSUES issues found" >> "$LOG_FILE"

if [ $ISSUES -gt 0 ]; then
  "$NOTIFY" "GIT GUARDIAN: $ISSUES repo issues found at $(date '+%H:%M')" >> "$LOG_FILE" 2>&1
fi

# ── Changelog ─────────────────────────────────────────────────────────
mkdir -p "$CHANGELOG_DIR"
TIMESTAMP=$(date '+%Y-%m-%d_%H%M')
CHANGELOG_FILE="${CHANGELOG_DIR}/gitguardian_${TIMESTAMP}.txt"
{
  echo "============================================"
  echo "  GIT GUARDIAN RUN — $(date)"
  echo "  Issues Found: $ISSUES"
  echo "============================================"
  if [ -n "$REPORT" ]; then
    echo -e "$REPORT"
  else
    echo ""
    echo "All checks passed. Repository is clean."
  fi
} > "$CHANGELOG_FILE"
echo "Changelog saved: $CHANGELOG_FILE" >> "$LOG_FILE"

echo "Git Guardian Finished: $(date)" >> "$LOG_FILE"
exit $ISSUES
