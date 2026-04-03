#!/bin/bash
# ══════════════════════════════════════════════════════════════════════
#  Copilot Hive — Metrics Tracker
#  Appends structured run records to metrics.jsonl
#  Usage: track-metrics.sh <agent_name> <exit_code> <duration_sec> [description]
# ══════════════════════════════════════════════════════════════════════

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/config.sh" 2>/dev/null

METRICS_FILE="${SCRIPTS_DIR:-/opt/copilot-hive}/metrics.jsonl"
AGENT="${1:-unknown}"
EXIT_CODE="${2:-0}"
DURATION="${3:-0}"
DESCRIPTION="${4:-}"

python3 -c "
import json, datetime
record = {
    'timestamp': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'agent': '${AGENT}',
    'exit_code': int('${EXIT_CODE}'),
    'success': int('${EXIT_CODE}') == 0,
    'duration_sec': int('${DURATION}'),
    'description': '${DESCRIPTION}'
}
with open('${METRICS_FILE}', 'a') as f:
    f.write(json.dumps(record) + '\n')
" 2>/dev/null

echo "Metric recorded: ${AGENT} exit=${EXIT_CODE} duration=${DURATION}s"
