#!/bin/bash
# ══════════════════════════════════════════════════════════════════════
#  Copilot Hive — Cross-Platform Compatibility Library
#  Provides portable replacements for OS-specific commands.
#  Sourced by config.sh (which is sourced by all agent scripts).
#
#  Supports: Linux, macOS, WSL, Docker Desktop
# ══════════════════════════════════════════════════════════════════════

# ── OS Detection ─────────────────────────────────────────────────────
detect_os() {
  HIVE_OS="unknown"
  HIVE_ARCH="$(uname -m)"

  case "$(uname -s)" in
    Linux)
      if grep -qi microsoft /proc/version 2>/dev/null; then
        HIVE_OS="wsl"
      else
        HIVE_OS="linux"
      fi
      ;;
    Darwin)
      HIVE_OS="macos"
      ;;
  esac

  export HIVE_OS HIVE_ARCH
}

detect_os

# ── Portable File Locking ────────────────────────────────────────────
# Usage: portable_lock <lockfile>
#        portable_unlock <lockfile>
portable_lock() {
  local lockfile="$1"
  if command -v flock &>/dev/null; then
    # Linux / WSL — use flock (fastest, most reliable)
    exec 9>"$lockfile"
    flock -x 9
  else
    # macOS fallback — mkdir is atomic on all POSIX systems
    local attempts=0
    while ! mkdir "${lockfile}.d" 2>/dev/null; do
      attempts=$((attempts + 1))
      if [ $attempts -gt 50 ]; then
        # Stale lock — break it
        rm -rf "${lockfile}.d" 2>/dev/null
        mkdir "${lockfile}.d" 2>/dev/null || true
        break
      fi
      sleep 0.1
    done
  fi
}

portable_unlock() {
  local lockfile="$1"
  if command -v flock &>/dev/null; then
    flock -u 9 2>/dev/null
  else
    rm -rf "${lockfile}.d" 2>/dev/null
  fi
}

# Convenience: lock for per-agent script exclusion
# Usage: acquire_agent_lock "agent-name" || exit 0
acquire_agent_lock() {
  local agent="$1"
  local lockfile="/tmp/copilot-${agent}.lock"
  if command -v flock &>/dev/null; then
    exec 8>"$lockfile"
    if ! flock -n 8; then
      echo "$(date) — SKIPPED: Another instance already running" >&2
      return 1
    fi
  else
    if ! mkdir "${lockfile}.d" 2>/dev/null; then
      echo "$(date) — SKIPPED: Another instance already running" >&2
      return 1
    fi
    # Clean up on exit
    trap "rm -rf '${lockfile}.d'" EXIT
  fi
  return 0
}

# ── Portable File Size ───────────────────────────────────────────────
# Usage: get_file_size "/path/to/file"
# Returns file size in bytes
get_file_size() {
  local file="$1"
  if [ "$HIVE_OS" = "macos" ]; then
    stat -f%z "$file" 2>/dev/null || echo 0
  else
    stat -c%s "$file" 2>/dev/null || echo 0
  fi
}

# ── Portable Random Hex ─────────────────────────────────────────────
# Usage: random_hex [bytes]  (default: 4 bytes = 8 hex chars)
random_hex() {
  local bytes="${1:-4}"
  if command -v xxd &>/dev/null; then
    head -c "$bytes" /dev/urandom | xxd -p
  elif command -v od &>/dev/null; then
    head -c "$bytes" /dev/urandom | od -An -tx1 | tr -d ' \n'
  elif command -v hexdump &>/dev/null; then
    head -c "$bytes" /dev/urandom | hexdump -v -e '/1 "%02x"'
  else
    printf '%08x' $((RANDOM * RANDOM))
  fi
}

# ── Portable Build ID ────────────────────────────────────────────────
# Usage: generate_build_id [suffix]
generate_build_id() {
  local suffix="${1:-}"
  if [ -n "$suffix" ]; then
    echo "$(date +%s)-${suffix}"
  else
    echo "$(date +%s)-$(random_hex 4)"
  fi
}

# ── Portable File Modification Time ──────────────────────────────────
# Usage: get_file_mtime "/path/to/file"
# Returns modification time as HH:MM
get_file_mtime() {
  local file="$1"
  if [ "$HIVE_OS" = "macos" ]; then
    stat -f%m "$file" 2>/dev/null | xargs -I {} date -r {} '+%H:%M' 2>/dev/null || echo '?'
  else
    date -r "$file" '+%H:%M' 2>/dev/null || echo '?'
  fi
}

# ── Portable Default Paths ───────────────────────────────────────────
# Returns sensible defaults per OS
default_install_dir() {
  case "$HIVE_OS" in
    macos) echo "$HOME/.copilot-hive" ;;
    *)     echo "/opt/copilot-hive" ;;
  esac
}

default_project_dir() {
  case "$HIVE_OS" in
    macos) echo "$HOME/projects/yourproject" ;;
    *)     echo "/opt/yourproject" ;;
  esac
}

# ── Docker Socket Detection ─────────────────────────────────────────
# Usage: detect_docker_socket
# Sets DOCKER_SOCK to the correct path
detect_docker_socket() {
  if [ -n "${DOCKER_HOST:-}" ]; then
    # User explicitly set DOCKER_HOST — respect it
    export DOCKER_SOCK="${DOCKER_HOST#unix://}"
  elif [ -S "/var/run/docker.sock" ]; then
    export DOCKER_SOCK="/var/run/docker.sock"
  elif [ -S "$HOME/.docker/run/docker.sock" ]; then
    # Docker Desktop on macOS (newer versions)
    export DOCKER_SOCK="$HOME/.docker/run/docker.sock"
  elif [ -S "$HOME/.colima/default/docker.sock" ]; then
    # Colima on macOS
    export DOCKER_SOCK="$HOME/.colima/default/docker.sock"
  elif [ -S "$HOME/.local/share/podman/podman.sock" ]; then
    # Podman on macOS/Linux
    export DOCKER_SOCK="$HOME/.local/share/podman/podman.sock"
  else
    export DOCKER_SOCK="/var/run/docker.sock"
  fi
}

# ── Portable Temp File ───────────────────────────────────────────────
# Usage: portable_mktemp [prefix]
portable_mktemp() {
  local prefix="${1:-copilot-hive}"
  mktemp -t "${prefix}.XXXXXXXX" 2>/dev/null || mktemp "/tmp/${prefix}.XXXXXXXX"
}
