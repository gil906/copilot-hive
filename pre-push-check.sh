#!/bin/bash
# ══════════════════════════════════════════════════════════════════════
#  Copilot Hive — Pre-push Quality Gate
#  Run before git push to catch common issues.
#  Usage: pre-push-check.sh [project_dir]
# ══════════════════════════════════════════════════════════════════════

PROJECT_DIR="${1:-.}"
ERRORS=0

echo "🔍 Running pre-push checks..."

# Check Python syntax
for f in $(git -C "$PROJECT_DIR" diff --cached --name-only --diff-filter=ACM 2>/dev/null | grep '\.py$'); do
  python3 -m py_compile "$PROJECT_DIR/$f" 2>/dev/null || {
    echo "  ❌ Python syntax error: $f"
    ERRORS=$((ERRORS + 1))
  }
done

# Check JavaScript syntax
for f in $(git -C "$PROJECT_DIR" diff --cached --name-only --diff-filter=ACM 2>/dev/null | grep '\.js$'); do
  node --check "$PROJECT_DIR/$f" 2>/dev/null || {
    echo "  ❌ JavaScript syntax error: $f"
    ERRORS=$((ERRORS + 1))
  }
done

# Check shell script syntax
for f in $(git -C "$PROJECT_DIR" diff --cached --name-only --diff-filter=ACM 2>/dev/null | grep '\.sh$'); do
  bash -n "$PROJECT_DIR/$f" 2>/dev/null || {
    echo "  ❌ Shell syntax error: $f"
    ERRORS=$((ERRORS + 1))
  }
done

# Check for secrets
SECRETS=$(git -C "$PROJECT_DIR" diff --cached 2>/dev/null | \
  grep -iE '^\+.*(password|secret|api_key|token|private_key)\s*[:=]\s*["\x27][^"\x27]{8,}' | \
  grep -viE '(example|placeholder|your_|CHANGE_ME|os\.environ|os\.getenv|\$\{)')
if [ -n "$SECRETS" ]; then
  echo "  ❌ Potential secrets detected in staged changes!"
  echo "$SECRETS" | head -5
  ERRORS=$((ERRORS + 1))
fi

if [ $ERRORS -gt 0 ]; then
  echo "❌ Pre-push check failed with $ERRORS error(s)"
  exit 1
else
  echo "✅ All pre-push checks passed"
  exit 0
fi
