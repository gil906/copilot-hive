#!/bin/bash
# ══════════════════════════════════════════════════════════════════════
#  🐝 Copilot Hive — Interactive Installer
#  One-command setup for the autonomous AI agent swarm
#
#  Usage:
#    curl -fsSL https://raw.githubusercontent.com/gil906/copilot-hive/main/install.sh | bash
#    — or —
#    git clone https://github.com/gil906/copilot-hive.git && cd copilot-hive && bash install.sh
# ══════════════════════════════════════════════════════════════════════

set -e

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; PURPLE='\033[0;35m'; CYAN='\033[0;36m'
NC='\033[0m'; BOLD='\033[1m'

banner() {
  echo -e "${CYAN}"
  echo "  ╔═══════════════════════════════════════════════╗"
  echo "  ║         🐝  Copilot Hive Installer  🐝        ║"
  echo "  ║    Autonomous AI Agent Swarm Framework v1.5   ║"
  echo "  ╚═══════════════════════════════════════════════╝"
  echo -e "${NC}"
}

log()  { echo -e "  ${GREEN}✓${NC} $*"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $*"; }
err()  { echo -e "  ${RED}✗${NC} $*"; }
ask()  { echo -en "  ${BLUE}?${NC} $* "; }

portable_mktemp() {
  local prefix="${1:-copilot}"
  if mktemp -t "${prefix}.XXXXXX" 2>/dev/null; then
    return
  fi
  mktemp
}

banner

# Detect OS
DETECTED_OS="$(uname -s)"
case "$DETECTED_OS" in
  Darwin) log "Platform: macOS $(sw_vers -productVersion 2>/dev/null || echo '')" ;;
  Linux)
    if grep -qi microsoft /proc/version 2>/dev/null; then
      log "Platform: WSL (Windows Subsystem for Linux)"
    else
      log "Platform: Linux $(uname -r)"
    fi
    ;;
esac

# ── Step 1: Check prerequisites ──────────────────────────────────────
echo -e "\n${BOLD}Step 1: Checking prerequisites${NC}\n"

MISSING=""
for cmd in git curl python3 docker; do
  if command -v $cmd &>/dev/null; then
    log "$cmd found: $(command -v $cmd)"
  else
    err "$cmd not found"
    MISSING="$MISSING $cmd"
  fi
done

# Check for GitHub Copilot CLI
if command -v copilot &>/dev/null; then
  log "GitHub Copilot CLI found"
elif command -v github-copilot-cli &>/dev/null; then
  log "GitHub Copilot CLI found (github-copilot-cli)"
else
  warn "GitHub Copilot CLI not found — install from https://docs.github.com/en/copilot/github-copilot-in-the-cli"
fi

if [ -n "$MISSING" ]; then
  err "Missing required tools:$MISSING"
  echo "  Install them and re-run this script."
  exit 1
fi

# Check git credentials
if [ -f ~/.git-credentials ] && grep -q 'github.com' ~/.git-credentials; then
  log "GitHub credentials found in ~/.git-credentials"
else
  warn "No GitHub credentials found in ~/.git-credentials"
  echo "    Run: git credential store && git push (to save credentials)"
fi

# ── Step 2: Choose install location ──────────────────────────────────
echo -e "\n${BOLD}Step 2: Installation${NC}\n"

# OS-aware default paths
if [ "$(uname -s)" = "Darwin" ]; then
  DEFAULT_DIR="$HOME/.copilot-hive"
  DEFAULT_PROJECT="$HOME/projects/yourproject"
  DEFAULT_COMPOSE="$HOME/docker-compose/yourproject.yml"
else
  DEFAULT_DIR="/opt/copilot-hive"
  DEFAULT_PROJECT="/opt/yourproject"
  DEFAULT_COMPOSE="/opt/docker-compose/yourproject.yml"
fi
ask "Install directory [${DEFAULT_DIR}]:"
read -r INSTALL_DIR
INSTALL_DIR="${INSTALL_DIR:-$DEFAULT_DIR}"

# Clone or copy
if [ -f "$(dirname "$0")/config.sh" ] 2>/dev/null; then
  # Running from cloned repo
  if [ "$(pwd)" != "$INSTALL_DIR" ]; then
    log "Copying files to $INSTALL_DIR..."
    sudo mkdir -p "$INSTALL_DIR"
    sudo cp -r . "$INSTALL_DIR/"
  else
    log "Already in $INSTALL_DIR"
  fi
else
  # Running via curl pipe — need to clone
  log "Cloning copilot-hive to $INSTALL_DIR..."
  sudo mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone https://github.com/gil906/copilot-hive.git "$INSTALL_DIR" 2>/dev/null || {
    err "Clone failed. Check your internet connection."
    exit 1
  }
fi

cd "$INSTALL_DIR"
chmod +x *.sh 2>/dev/null

# ── Step 3: Configure your project ──────────────────────────────────
echo -e "\n${BOLD}Step 3: Project Configuration${NC}\n"

ask "Your project source code path [${DEFAULT_PROJECT}]:"
read -r PROJECT_DIR
PROJECT_DIR="${PROJECT_DIR:-$DEFAULT_PROJECT}"

ask "GitHub repo (owner/repo) [owner/yourproject]:"
read -r GH_REPO
GH_REPO="${GH_REPO:-owner/yourproject}"

ask "Docker compose file path [${DEFAULT_COMPOSE}]:"
read -r COMPOSE_FILE
COMPOSE_FILE="${COMPOSE_FILE:-$DEFAULT_COMPOSE}"

ask "API container name [yourproject-api]:"
read -r CONTAINER_API
CONTAINER_API="${CONTAINER_API:-yourproject-api}"

ask "Web container name [yourproject-web]:"
read -r CONTAINER_WEB
CONTAINER_WEB="${CONTAINER_WEB:-yourproject-web}"

ask "Health check URL [http://localhost:8080/]:"
read -r HEALTH_URL
HEALTH_URL="${HEALTH_URL:-http://localhost:8080/}"

ask "Version API URL [http://localhost:8080/api/version]:"
read -r VERSION_URL
VERSION_URL="${VERSION_URL:-http://localhost:8080/api/version}"

# ── Step 4: Write config ─────────────────────────────────────────────
echo -e "\n${BOLD}Step 4: Writing configuration${NC}\n"

cat > "$INSTALL_DIR/config.sh" << CONFIGEOF
#!/bin/bash
# Copilot Hive — Configuration (generated by installer)

export SCRIPTS_DIR="${INSTALL_DIR}"
export PROJECT_DIR="${PROJECT_DIR}"
export GH_REPO="${GH_REPO}"
export COMPOSE_FILE="${COMPOSE_FILE}"
export CONTAINER_API="${CONTAINER_API}"
export CONTAINER_WEB="${CONTAINER_WEB}"
export CONTAINER_DB="\${CONTAINER_DB:-${CONTAINER_API/api/db}}"
export HEALTH_URL="${HEALTH_URL}"
export VERSION_URL="${VERSION_URL}"
export DB_USER="\${DB_USER:-postgres}"
export DB_NAME="\${DB_NAME:-\$(basename "$PROJECT_DIR")}"
export DEPLOY_TIMEOUT="\${DEPLOY_TIMEOUT:-1800}"
export STALE_AGENT_TIMEOUT="\${STALE_AGENT_TIMEOUT:-3600}"
export MAX_FIX_RETRIES="\${MAX_FIX_RETRIES:-2}"
export STATUS_FILE="\${SCRIPTS_DIR}/.pipeline-status"
export PAUSE_FILE="\${SCRIPTS_DIR}/.agents-paused"
export NOTIFY="\${SCRIPTS_DIR}/notify-smartthings.sh"
export IDEAS_DIR="\${SCRIPTS_DIR}/ideas"
export CHANGELOG_DIR="\${SCRIPTS_DIR}/changelogs"
export COPILOT="\${COPILOT:-/usr/local/bin/copilot}"
export LOG_DIR="\${SCRIPTS_DIR}"
export AGENT_STATUS_FILE="\${IDEAS_DIR}/agent_status.json"

mkdir -p "\${IDEAS_DIR}" "\${CHANGELOG_DIR}"
CONFIGEOF

log "Config written to $INSTALL_DIR/config.sh"

# Create .env if not exists
if [ ! -f "$INSTALL_DIR/.env" ]; then
  cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env" 2>/dev/null
  log "Created .env (edit with your tokens)"
fi

# Create runtime directories
mkdir -p "$INSTALL_DIR/ideas" "$INSTALL_DIR/changelogs"
log "Created ideas/ and changelogs/ directories"

# ── Step 5: Install crontab ──────────────────────────────────────────
echo -e "\n${BOLD}Step 5: Crontab Setup${NC}\n"

# ── macOS launchd vs Linux cron ──────────────────────────────────────
if [ "$(uname -s)" = "Darwin" ]; then
  ask "Install launchd agents for automated scheduling? [Y/n]:"
  read -r INSTALL_SCHED
  INSTALL_SCHED="${INSTALL_SCHED:-Y}"

  if [[ "$INSTALL_SCHED" =~ ^[Yy] ]]; then
    AGENTS_DIR="$HOME/Library/LaunchAgents"
    mkdir -p "$AGENTS_DIR"

    # Dispatcher — runs every 60 seconds
    cat > "$AGENTS_DIR/com.copilot-hive.dispatcher.plist" << PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.copilot-hive.dispatcher</string>
    <key>ProgramArguments</key>
    <array>
        <string>${INSTALL_DIR}/copilot-dispatcher.sh</string>
    </array>
    <key>StartInterval</key>
    <integer>60</integer>
    <key>StandardOutPath</key>
    <string>${INSTALL_DIR}/copilot-dispatcher.log</string>
    <key>StandardErrorPath</key>
    <string>${INSTALL_DIR}/copilot-dispatcher.log</string>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
PLISTEOF

    # Research agents — hourly
    for agent in designer-web designer-portal architect-api; do
      cat > "$AGENTS_DIR/com.copilot-hive.${agent}.plist" << PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.copilot-hive.${agent}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${INSTALL_DIR}/copilot-${agent}.sh</string>
    </array>
    <key>StartInterval</key>
    <integer>3600</integer>
    <key>StandardOutPath</key>
    <string>${INSTALL_DIR}/copilot-${agent}.log</string>
    <key>StandardErrorPath</key>
    <string>${INSTALL_DIR}/copilot-${agent}.log</string>
</dict>
</plist>
PLISTEOF
    done

    # Strategic agents — every 2 hours
    for agent in radical lawyer compliance; do
      cat > "$AGENTS_DIR/com.copilot-hive.${agent}.plist" << PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.copilot-hive.${agent}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${INSTALL_DIR}/copilot-${agent}.sh</string>
    </array>
    <key>StartInterval</key>
    <integer>7200</integer>
    <key>StandardOutPath</key>
    <string>${INSTALL_DIR}/copilot-${agent}.log</string>
    <key>StandardErrorPath</key>
    <string>${INSTALL_DIR}/copilot-${agent}.log</string>
</dict>
</plist>
PLISTEOF
    done

    # Load all agents
    for plist in "$AGENTS_DIR"/com.copilot-hive.*.plist; do
      launchctl load "$plist" 2>/dev/null
    done
    log "Installed $(ls "$AGENTS_DIR"/com.copilot-hive.*.plist | wc -l | tr -d ' ') launchd agents"
    log "Manage with: launchctl list | grep copilot"
  else
    warn "Skipped scheduling — see README for manual launchd setup"
  fi
else
  # ── Linux/WSL — use crontab ──────────────────────────────────────
  ask "Install crontab for automated scheduling? [Y/n]:"
  read -r INSTALL_CRON
  INSTALL_CRON="${INSTALL_CRON:-Y}"

  if [[ "$INSTALL_CRON" =~ ^[Yy] ]]; then
    CRON_TMP=$(portable_mktemp "copilot-cron")
    crontab -l 2>/dev/null > "$CRON_TMP" || true
    
    # Remove any existing copilot-hive entries
    grep -v 'copilot-hive\|copilot-dispatcher\|copilot-improve\|copilot-audit\|copilot-designer\|copilot-architect\|copilot-radical\|copilot-lawyer\|copilot-compliance\|copilot-reporter' "$CRON_TMP" > "${CRON_TMP}.clean" 2>/dev/null || true
    mv "${CRON_TMP}.clean" "$CRON_TMP"

    cat >> "$CRON_TMP" << CRONEOF

# ── Copilot Hive — Autonomous Agent Swarm ────────────────────────────
* * * * * ${INSTALL_DIR}/copilot-dispatcher.sh >> ${INSTALL_DIR}/copilot-dispatcher.log 2>&1
0  * * * * ${INSTALL_DIR}/copilot-designer-web.sh >> ${INSTALL_DIR}/copilot-designer-web.log 2>&1
5  * * * * ${INSTALL_DIR}/copilot-designer-portal.sh >> ${INSTALL_DIR}/copilot-designer-portal.log 2>&1
10 * * * * ${INSTALL_DIR}/copilot-architect-api.sh >> ${INSTALL_DIR}/copilot-architect-api.log 2>&1
15 */2 * * * ${INSTALL_DIR}/copilot-radical.sh >> ${INSTALL_DIR}/copilot-radical.log 2>&1
20 */2 * * * ${INSTALL_DIR}/copilot-lawyer.sh >> ${INSTALL_DIR}/copilot-lawyer.log 2>&1
25 */2 * * * ${INSTALL_DIR}/copilot-compliance.sh >> ${INSTALL_DIR}/copilot-compliance.log 2>&1
0 18 * * * ${INSTALL_DIR}/copilot-reporter.sh daily >> ${INSTALL_DIR}/copilot-reporter.log 2>&1
0 18 * * 0 ${INSTALL_DIR}/copilot-reporter.sh weekly >> ${INSTALL_DIR}/copilot-reporter.log 2>&1
0  0 * * * ${INSTALL_DIR}/copilot-gitguardian.sh >> ${INSTALL_DIR}/copilot-gitguardian.log 2>&1
30 0 * * * ${INSTALL_DIR}/copilot-regressiontest.sh >> ${INSTALL_DIR}/copilot-regressiontest.log 2>&1
CRONEOF

    crontab "$CRON_TMP"
    rm -f "$CRON_TMP"
    log "Crontab installed with all agent schedules"
  else
    warn "Skipped crontab — see crontab.example for manual setup"
  fi
fi

# ── Step 6: Version endpoint reminder ────────────────────────────────
echo -e "\n${BOLD}Step 6: Final Setup${NC}\n"

echo -e "  ${PURPLE}┌──────────────────────────────────────────────────────┐${NC}"
echo -e "  ${PURPLE}│${NC}  Add this endpoint to your app for deploy tracking:  ${PURPLE}│${NC}"
echo -e "  ${PURPLE}│${NC}                                                      ${PURPLE}│${NC}"
echo -e "  ${PURPLE}│${NC}  GET /api/version                                    ${PURPLE}│${NC}"
echo -e "  ${PURPLE}│${NC}  → {\"build_id\": \"...\", \"status\": \"running\"}           ${PURPLE}│${NC}"
echo -e "  ${PURPLE}│${NC}                                                      ${PURPLE}│${NC}"
echo -e "  ${PURPLE}│${NC}  The dispatcher reads .build-id and verifies it      ${PURPLE}│${NC}"
echo -e "  ${PURPLE}│${NC}  matches the running container after each deploy.    ${PURPLE}│${NC}"
echo -e "  ${PURPLE}└──────────────────────────────────────────────────────┘${NC}"

# ── Done! ─────────────────────────────────────────────────────────────
echo -e "\n${GREEN}${BOLD}  ✅ Copilot Hive installed successfully!${NC}\n"
echo -e "  ${BOLD}Installed to:${NC}    $INSTALL_DIR"
echo -e "  ${BOLD}Config:${NC}          $INSTALL_DIR/config.sh"
echo -e "  ${BOLD}Project:${NC}         $PROJECT_DIR"
echo -e "  ${BOLD}GitHub repo:${NC}     $GH_REPO"
echo ""
echo -e "  ${BOLD}Quick commands:${NC}"
echo -e "    ${CYAN}copilot-hive list${NC}          — List all agents"
echo -e "    ${CYAN}copilot-hive show developer${NC} — View Developer prompt"
echo -e "    ${CYAN}$INSTALL_DIR/copilot-dispatcher.sh${NC} — Run pipeline manually"
echo ""
echo -e "  ${BOLD}To pause all agents:${NC}  touch $INSTALL_DIR/.agents-paused"
echo -e "  ${BOLD}To resume:${NC}            rm $INSTALL_DIR/.agents-paused"
echo -e "  ${BOLD}Dry-run mode:${NC}         $INSTALL_DIR/copilot-improve.sh --dry-run"
echo ""
echo -e "  ${YELLOW}Edit $INSTALL_DIR/.env to add your SmartThings token${NC}"
echo -e "  ${YELLOW}Edit $INSTALL_DIR/config.sh to fine-tune settings${NC}"
echo ""
echo -e "  🐝 The hive is ready. Start the swarm!"
