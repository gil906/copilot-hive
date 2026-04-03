#!/bin/bash
# ══════════════════════════════════════════════════════════════════════
#  Copilot Hive — Project Context Loader
#  Source this from agent scripts to enable multi-project support.
#  Usage in agent: source "${SCRIPT_DIR}/lib/load-project.sh"
#         then run: load_project_context "$@"
# ══════════════════════════════════════════════════════════════════════

HIVE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECTS_DIR="${HIVE_DIR}/projects"
REGISTRY_FILE="${PROJECTS_DIR}/registry.json"

# Parse --project <id> from arguments, return project ID or empty
_parse_project_arg() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --project) echo "$2"; return 0 ;;
      --project=*) echo "${1#*=}"; return 0 ;;
    esac
    shift
  done
  echo ""
}

# Load project context from projects/<id>/project.json
# Exports: PROJECT_DIR, COMPOSE_FILE, GH_REPO, IDEAS_DIR,
#          COMPETITOR_SITES, LEGAL_SITES, PROJECT_CONTEXT, PROJECT_ID, PROJECT_NAME
load_project_context() {
  local project_id
  project_id=$(_parse_project_arg "$@")

  # Also check COPILOT_HIVE_PROJECT env var
  [ -z "$project_id" ] && project_id="${COPILOT_HIVE_PROJECT:-}"

  # No project specified — agents run in default/legacy mode
  [ -z "$project_id" ] && return 0

  local project_dir="${PROJECTS_DIR}/${project_id}"
  local project_file="${project_dir}/project.json"

  if [ ! -f "$project_file" ]; then
    echo "ERROR: Project not found: ${project_id}" >&2
    echo "  Expected: ${project_file}" >&2
    return 1
  fi

  export PROJECT_ID="$project_id"

  # Use python3 to parse JSON and export vars
  eval "$(python3 -c "
import json, os, shlex

with open('${project_file}') as f:
    p = json.load(f)

# Core project settings
print(f'export PROJECT_DIR={shlex.quote(p.get(\"path\", \"/opt/yourproject\"))}')
print(f'export PROJECT_NAME={shlex.quote(p.get(\"name\", project_id))}')
print(f'export GH_REPO={shlex.quote(p.get(\"github_repo\", \"owner/repo\"))}')

# Docker settings
docker = p.get('docker', {})
if docker.get('compose_file'):
    print(f'export COMPOSE_FILE={shlex.quote(docker[\"compose_file\"])}')
containers = docker.get('containers', {})
if containers.get('api'):
    print(f'export CONTAINER_API={shlex.quote(containers[\"api\"])}')
if containers.get('web'):
    print(f'export CONTAINER_WEB={shlex.quote(containers[\"web\"])}')
if containers.get('db'):
    print(f'export CONTAINER_DB={shlex.quote(containers[\"db\"])}')

# Health URLs
if docker.get('health_url'):
    print(f'export HEALTH_URL={shlex.quote(docker[\"health_url\"])}')
if docker.get('version_url'):
    print(f'export VERSION_URL={shlex.quote(docker[\"version_url\"])}')

# Competitor sites for radical agent
competitors = p.get('competitors', [])
if competitors:
    sites = 'KNOWN COMPETITOR SITES TO ANALYZE:\\n'
    for c in competitors:
        name = c.get('name', '')
        url = c.get('url', '')
        notes = c.get('notes', '')
        sites += f'  - {url} ({name}: {notes})\\n'
    sites += '\\nALSO DISCOVER AND CHECK:\\n'
    sites += f'  - Search for best alternatives to these competitors\\n'
    sites += f'  - Check Product Hunt, G2, Capterra for the product category\\n'
    sites += f'  - Look at GitHub trending projects in the same space\\n'
    print(f'export COMPETITOR_SITES={shlex.quote(sites)}')

# Legal sites for lawyer agent
legal_sites = p.get('legal_sites', [])
if legal_sites:
    lsites = 'COMPETITOR LEGAL PAGES TO ANALYZE:\\n'
    for ls in legal_sites:
        name = ls.get('name', '')
        url = ls.get('url', '')
        pages = ', '.join(ls.get('pages', []))
        lsites += f'  - {url} ({pages})\\n'
    print(f'export LEGAL_SITES={shlex.quote(lsites)}')

# Project description for agent context injection
desc = p.get('description', '')
if desc:
    ctx = f'PROJECT DESCRIPTION (what this project does):\\n{desc}\\n'
    tech = p.get('tech_stack', '')
    if tech:
        ctx += f'\\nTECH STACK: {tech}\\n'
    target = p.get('target_market', '')
    if target:
        ctx += f'TARGET MARKET: {target}\\n'
    print(f'export PROJECT_CONTEXT={shlex.quote(ctx)}')
" 2>/dev/null)" || {
    echo "ERROR: Failed to parse project config: ${project_file}" >&2
    return 1
  }

  # Set project-specific IDEAS_DIR to avoid conflicts
  export IDEAS_DIR="${project_dir}/ideas"
  mkdir -p "$IDEAS_DIR"

  # Per-project logs, changelogs, and state files
  export LOG_DIR="${project_dir}/logs"
  export CHANGELOG_DIR="${project_dir}/changelogs"
  export STATUS_FILE="${project_dir}/ideas/agent_status.json"
  mkdir -p "$LOG_DIR" "$CHANGELOG_DIR"

  # Set project-specific log suffix
  export PROJECT_LOG_SUFFIX="_${project_id}"

  return 0
}
