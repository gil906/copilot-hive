#!/bin/bash
# ══════════════════════════════════════════════════════════════════════
#  Pipeline Dispatcher — Event-driven agent chaining
#  Runs every 1 min via cron. Chains: improve → deploy → audit → deploy → ...
#
#  FAILURE RESPONSIBILITY:
#    Deploy fails → re-run the SAME agent that pushed (they fix their own mess)
#    If that agent also fails → THEN escalate to Emergency Fixer
#    Emergency Fixer only acts when no other agent is already fixing the issue
# ══════════════════════════════════════════════════════════════════════

SCRIPTS_DIR="/opt/copilot-hive"
STATUS_FILE="$SCRIPTS_DIR/.pipeline-status"
PAUSE_FILE="$SCRIPTS_DIR/.agents-paused"
LOG_FILE="$SCRIPTS_DIR/copilot-dispatcher.log"
NOTIFY="$SCRIPTS_DIR/notify-smartthings.sh"
PROJECT_DIR="/opt/yourproject"
GH_REPO="aimusicmatch/yourproject"
DEPLOY_TIMEOUT=1800
STALE_AGENT_TIMEOUT=3600
CONTAINER_API="yourproject-api"
CONTAINER_WEB="yourproject-web"
HEALTH_URL="http://localhost:8080/"
VERSION_URL="http://localhost:8080/api/version"
MAX_FIX_RETRIES=2  # original agent gets 2 tries, then emergency fixer

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') — $*" >> "$LOG_FILE"; }

# ── Initialize ───────────────────────────────────────────────────────
if [ ! -f "$STATUS_FILE" ]; then
  cat > "$STATUS_FILE" <<EOF
PIPELINE_STATE=idle
CURRENT_AGENT=
CURRENT_PID=
LAST_AGENT=audit
LAST_FINISHED=0
LAST_COMMIT=
LAST_BUILD_ID=
PUSH_TIME=0
DEPLOY_VERIFIED=yes
NEXT_AGENT=improve
FIX_RESPONSIBILITY=
FIX_RETRIES=0
EOF
fi

[ -f "$PAUSE_FILE" ] && exit 0
source "$STATUS_FILE"

# Health monitoring is handled by Uptime Kuma (port 3001)
# → checks every 60s, alerts after 5 consecutive failures (5 min)
# → sends webhook to health-webhook container (port 9095)
# → webhook triggers emergency fixer + SmartThings notification

# ── GitHub token ─────────────────────────────────────────────────────
GH_TOKEN=""
[ -f ~/.git-credentials ] && \
  GH_TOKEN=$(grep 'github.com' ~/.git-credentials | head -1 | sed 's|https://[^:]*:\([^@]*\)@.*|\1|')

# ── Save status ──────────────────────────────────────────────────────
save_status() {
  cat > "$STATUS_FILE" <<EOF
PIPELINE_STATE=$PIPELINE_STATE
CURRENT_AGENT=$CURRENT_AGENT
CURRENT_PID=$CURRENT_PID
LAST_AGENT=$LAST_AGENT
LAST_FINISHED=$LAST_FINISHED
LAST_COMMIT=$LAST_COMMIT
LAST_BUILD_ID=$LAST_BUILD_ID
PUSH_TIME=$PUSH_TIME
DEPLOY_VERIFIED=$DEPLOY_VERIFIED
NEXT_AGENT=$NEXT_AGENT
FIX_RESPONSIBILITY=$FIX_RESPONSIBILITY
FIX_RETRIES=$FIX_RETRIES
EOF
}

# ── Check GitHub Actions deploy status ───────────────────────────────
check_deploy() {
  local commit="$1"
  [ -z "$commit" ] || [ -z "$GH_TOKEN" ] && { echo "skip"; return; }
  curl -sf -H "Authorization: token $GH_TOKEN" \
    "https://api.github.com/repos/$GH_REPO/actions/runs?per_page=5&branch=main" 2>/dev/null | \
  python3 -c "
import sys, json
commit = '${commit}'
try:
    data = json.load(sys.stdin)
    for run in data.get('workflow_runs', []):
        if run['head_sha'][:10] == commit[:10]:
            if run['status'] == 'completed':
                print('success' if run.get('conclusion') == 'success' else 'failed')
            else:
                print('running')
            sys.exit(0)
    print('not_found')
except Exception:
    print('error')
" 2>/dev/null || echo "error"
}

# ── Verify containers healthy AND running the correct build ──────────
verify_container() {
  local expected_build="$1"

  for cname in "$CONTAINER_API" "$CONTAINER_WEB"; do
    local s; s=$(docker inspect -f '{{.State.Status}}' "$cname" 2>/dev/null)
    [ "$s" != "running" ] && { echo "container_down:$cname"; return; }
  done

  local h; h=$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER_API" 2>/dev/null)
  [ "$h" != "healthy" ] && { echo "unhealthy:$h"; return; }

  local code; code=$(curl -sf -o /dev/null -w "%{http_code}" --max-time 10 "$HEALTH_URL" 2>/dev/null)
  [ "$code" != "200" ] && { echo "http_fail:$code"; return; }

  if [ -n "$expected_build" ] && [ "$expected_build" != "unknown" ]; then
    local running
    running=$(curl -sf --max-time 5 "$VERSION_URL" 2>/dev/null | \
      python3 -c "import sys,json; print(json.load(sys.stdin).get('build_id',''))" 2>/dev/null)
    if [ -n "$running" ] && [ "$running" != "unknown" ] && [ "$running" != "$expected_build" ]; then
      echo "wrong_version:running=${running:0:12},expected=${expected_build:0:12}"
      return
    fi
  fi

  echo "healthy"
}

# ── Launch a specific agent ──────────────────────────────────────────
launch_agent() {
  local agent="$1"
  local reason="${2:-normal}"  # normal, fix_own, emergency
  local script rotation

  case "$agent" in
    improve) script="$SCRIPTS_DIR/copilot-improve.sh"; rotation="audit" ;;
    audit)   script="$SCRIPTS_DIR/copilot-audit.sh";   rotation="improve" ;;
    emergency) script="$SCRIPTS_DIR/copilot-emergencyfixer.sh"; rotation="$NEXT_AGENT" ;;
    *)       agent="improve"; script="$SCRIPTS_DIR/copilot-improve.sh"; rotation="audit" ;;
  esac

  [ ! -x "$script" ] && { log "ERROR: $script not executable"; exit 1; }

  if [ "$agent" = "emergency" ]; then
    nohup "$script" "deploy" "1" >> /dev/null 2>&1 &
  else
    nohup "$script" >> /dev/null 2>&1 &
  fi
  local pid=$!

  PIPELINE_STATE="running"; CURRENT_AGENT="$agent"; CURRENT_PID="$pid"
  [ "$reason" = "normal" ] && NEXT_AGENT="$rotation"
  save_status
  log "▶ Launched $agent (PID $pid, reason: $reason). Next: $NEXT_AGENT"
}

# ── Handle deploy failure with responsibility tracking ───────────────
handle_deploy_failure() {
  local failure_type="$1"  # "failed", "unhealthy", "timeout"
  local retries="${FIX_RETRIES:-0}"
  local responsible="${FIX_RESPONSIBILITY:-$LAST_AGENT}"

  log "✗ Deploy $failure_type for commit ${LAST_COMMIT:0:10} by $LAST_AGENT (retries: $retries/$MAX_FIX_RETRIES)"

  if [ "$retries" -lt "$MAX_FIX_RETRIES" ]; then
    # ── Original agent fixes their own mess ─────────────────────────
    FIX_RESPONSIBILITY="$responsible"
    FIX_RETRIES=$((retries + 1))
    "$NOTIFY" "Deploy $failure_type — $responsible will fix (attempt $FIX_RETRIES/$MAX_FIX_RETRIES)" >> "$LOG_FILE" 2>&1
    log "Re-launching $responsible to fix their own deploy failure (attempt $FIX_RETRIES)"
    save_status
    launch_agent "$responsible" "fix_own"
  else
    # ── Original agent failed to fix — escalate to Emergency Fixer ──
    FIX_RESPONSIBILITY="emergency"
    FIX_RETRIES=$((retries + 1))
    "$NOTIFY" "Deploy $failure_type — $responsible failed $MAX_FIX_RETRIES times. Emergency Fixer taking over." >> "$LOG_FILE" 2>&1
    log "⚠ $responsible failed $MAX_FIX_RETRIES times. Escalating to Emergency Fixer."
    save_status
    launch_agent "emergency" "emergency"
  fi
  # Set state to fixing so dispatcher tracks the repair
  PIPELINE_STATE="fixing"
  save_status
}

# ── Check if fixer pushed a new commit after running ─────────────────
check_fixer_result() {
  NEW_COMMIT=$(git -C "$PROJECT_DIR" rev-parse HEAD 2>/dev/null)
  if [ "$NEW_COMMIT" != "$LAST_COMMIT" ]; then
    NEW_BUILD_ID=""
    [ -f "$PROJECT_DIR/.build-id" ] && NEW_BUILD_ID=$(cat "$PROJECT_DIR/.build-id")
    log "Fix agent pushed new commit ${NEW_COMMIT:0:10}. Waiting for new deploy."
    LAST_COMMIT="$NEW_COMMIT"
    LAST_BUILD_ID="${NEW_BUILD_ID:-$NEW_COMMIT}"
    PUSH_TIME=$(date +%s)
    PIPELINE_STATE="waiting_deploy"; DEPLOY_VERIFIED="no"
    CURRENT_AGENT=""; CURRENT_PID=""
    save_status
    return 0  # new commit pushed, stay in waiting_deploy
  else
    return 1  # no new commit
  fi
}

# ══════════════════════════════════════════════════════════════════════
#  Main logic
# ══════════════════════════════════════════════════════════════════════

case "$PIPELINE_STATE" in

  running)
    if [ -n "$CURRENT_PID" ] && kill -0 "$CURRENT_PID" 2>/dev/null; then
      NOW=$(date +%s)
      if [ "$((NOW - ${LAST_FINISHED:-0}))" -gt "$STALE_AGENT_TIMEOUT" ]; then
        log "⚠ $CURRENT_AGENT (PID $CURRENT_PID) running >1h — may be hung"
      fi
      exit 0
    fi

    # Agent finished or crashed — check if it reported status
    # (agents write to .pipeline-status when done, so re-source it)
    source "$STATUS_FILE"
    if [ "$PIPELINE_STATE" != "running" ]; then
      # Agent reported status correctly, dispatcher will handle next cycle
      exit 0
    fi

    # Agent crashed without reporting
    log "⚠ $CURRENT_AGENT (PID $CURRENT_PID) exited without reporting. Recovering..."
    if git -C "$PROJECT_DIR" status --porcelain 2>/dev/null | grep -q .; then
      log "Pushing orphaned changes"
      cd "$PROJECT_DIR" || exit 1
      BUILD_ID="$(date +%s)-recovered"
      echo "$BUILD_ID" > .build-id
      git add -A 2>/dev/null
      git commit -m "auto: ${CURRENT_AGENT} (recovered) $(date '+%Y-%m-%d %H:%M')" 2>/dev/null
      git push origin main 2>/dev/null
      LAST_BUILD_ID="$BUILD_ID"
    fi

    [ "$CURRENT_AGENT" = "improve" ] && NEXT_AGENT="audit" || NEXT_AGENT="improve"
    LAST_AGENT="$CURRENT_AGENT"
    LAST_COMMIT=$(git -C "$PROJECT_DIR" rev-parse HEAD 2>/dev/null)
    LAST_FINISHED=$(date +%s)
    PUSH_TIME=$(date +%s)
    PIPELINE_STATE="waiting_deploy"; CURRENT_AGENT=""; CURRENT_PID=""
    DEPLOY_VERIFIED="no"
    save_status
    log "Set to waiting_deploy after crash recovery"
    ;;

  waiting_deploy)
    NOW=$(date +%s)
    ELAPSED=$((NOW - ${PUSH_TIME:-0}))
    DEPLOY_RESULT=$(check_deploy "$LAST_COMMIT")

    case "$DEPLOY_RESULT" in
      success)
        HEALTH=$(verify_container "$LAST_BUILD_ID")
        if [ "$HEALTH" = "healthy" ]; then
          log "✓ Deploy + version verified for ${LAST_BUILD_ID:0:12} (${ELAPSED}s)"
          PIPELINE_STATE="idle"; DEPLOY_VERIFIED="yes"
          FIX_RESPONSIBILITY=""; FIX_RETRIES=0  # clear fix state on success
          save_status
          launch_agent "$NEXT_AGENT" "normal"
        elif [ "$ELAPSED" -gt 600 ]; then
          handle_deploy_failure "unhealthy:$HEALTH"
        else
          log "⏳ Deploy OK but container: $HEALTH (${ELAPSED}s)"
        fi
        ;;

      failed)
        handle_deploy_failure "failed"
        ;;

      running)
        if [ "$ELAPSED" -gt "$DEPLOY_TIMEOUT" ]; then
          HEALTH=$(verify_container "$LAST_BUILD_ID")
          if [ "$HEALTH" = "healthy" ]; then
            log "Deploy timed out but container verified. Proceeding."
            PIPELINE_STATE="idle"; DEPLOY_VERIFIED="yes"
            FIX_RESPONSIBILITY=""; FIX_RETRIES=0
            save_status
            launch_agent "$NEXT_AGENT" "normal"
          else
            handle_deploy_failure "timeout+$HEALTH"
          fi
        else
          log "⏳ Deploy running (${ELAPSED}s)"
        fi
        ;;

      not_found|skip)
        if [ "$ELAPSED" -gt 300 ]; then
          HEALTH=$(verify_container "$LAST_BUILD_ID")
          if [ "$HEALTH" = "healthy" ]; then
            log "No workflow but container verified. Proceeding."
            PIPELINE_STATE="idle"; DEPLOY_VERIFIED="yes"
            FIX_RESPONSIBILITY=""; FIX_RETRIES=0
            save_status
            launch_agent "$NEXT_AGENT" "normal"
          elif [ "$ELAPSED" -gt 900 ]; then
            handle_deploy_failure "no_workflow+$HEALTH"
          else
            log "Waiting: no workflow, container: $HEALTH (${ELAPSED}s)"
          fi
        else
          log "Waiting for deploy workflow (${ELAPSED}s)"
        fi
        ;;

      *)
        if [ "$ELAPSED" -gt 600 ]; then
          log "Deploy check errors for 10 min. Proceeding."
          PIPELINE_STATE="idle"; DEPLOY_VERIFIED="yes"; save_status
          launch_agent "$NEXT_AGENT" "normal"
        else
          log "Deploy check: $DEPLOY_RESULT. Retrying."
        fi
        ;;
    esac
    ;;

  fixing)
    # ── An agent is running a fix — check if it finished ───────────
    if [ -n "$CURRENT_PID" ] && kill -0 "$CURRENT_PID" 2>/dev/null; then
      exit 0  # still fixing
    fi

    log "Fix agent $CURRENT_AGENT finished."
    if check_fixer_result; then
      log "Fix pushed. Waiting for new deploy."
      # stays in waiting_deploy (set by check_fixer_result)
    else
      if [ "$FIX_RESPONSIBILITY" = "emergency" ]; then
        # Emergency fixer also couldn't fix — give up, proceed with old container
        log "⚠ Emergency fixer didn't push a fix. Proceeding with old container."
        "$NOTIFY" "All fix attempts failed. Proceeding with old container." >> "$LOG_FILE" 2>&1
        PIPELINE_STATE="idle"; DEPLOY_VERIFIED="yes"
        FIX_RESPONSIBILITY=""; FIX_RETRIES=0
        CURRENT_AGENT=""; CURRENT_PID=""
        save_status
        launch_agent "$NEXT_AGENT" "normal"
      else
        # Original agent didn't fix — escalate
        log "$CURRENT_AGENT didn't push a fix. Escalating."
        CURRENT_AGENT=""; CURRENT_PID=""
        PIPELINE_STATE="waiting_deploy"
        save_status
        handle_deploy_failure "agent_fix_failed"
      fi
    fi
    ;;

  idle|"")
    log "Pipeline idle. Launching $NEXT_AGENT"
    launch_agent "$NEXT_AGENT" "normal"
    ;;
esac
