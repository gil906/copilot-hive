#!/usr/bin/env python3
"""
Tiny webhook receiver for Uptime Kuma alerts.
When a monitor goes DOWN, triggers the emergency fixer + phone notification.
Runs as a Docker container on port 9095.
"""

import json
import subprocess
import os
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
from datetime import datetime

LOG_FILE = "/opt/copilot-hive/health-webhook.log"
EMERGENCY_FIXER = "/opt/copilot-hive/copilot-emergencyfixer.sh"
NOTIFY = "/opt/copilot-hive/notify-smartthings.sh"
PAUSE_FILE = "/opt/copilot-hive/.agents-paused"
PIPELINE_STATUS = "/opt/copilot-hive/.pipeline-status"
ALERT_CONTEXT_FILE = "/opt/copilot-hive/.alert-context.json"
COOLDOWN_FILE = "/opt/copilot-hive/.health-cooldown"
COOLDOWN_SECONDS = 600  # 10 min between emergency fixer triggers

def log(msg):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"{ts} — {msg}\n"
    print(line, end="", flush=True)
    try:
        with open(LOG_FILE, "a") as f:
            f.write(line)
    except:
        pass

def in_cooldown():
    """Prevent triggering emergency fixer too often."""
    try:
        if os.path.exists(COOLDOWN_FILE):
            with open(COOLDOWN_FILE) as f:
                last = float(f.read().strip())
            if time.time() - last < COOLDOWN_SECONDS:
                return True
    except:
        pass
    return False

def set_cooldown():
    try:
        with open(COOLDOWN_FILE, "w") as f:
            f.write(str(time.time()))
    except:
        pass

class WebhookHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length)) if length else {}
        except:
            body = {}

        # Uptime Kuma webhook format:
        # {"heartbeat": {"status": 0=DOWN/1=UP, "msg": "..."}, "monitor": {"name": "...", "url": "..."}}
        heartbeat = body.get("heartbeat", {})
        monitor = body.get("monitor", {})
        status = heartbeat.get("status", 1)
        monitor_name = monitor.get("name", "unknown")
        msg = heartbeat.get("msg", "")

        log(f"Received: monitor={monitor_name} status={'UP' if status == 1 else 'DOWN'} msg={msg}")

        if status == 0:  # DOWN
            log(f"🚨 {monitor_name} is DOWN: {msg}")

            # Notify phone always
            try:
                subprocess.Popen(
                    [NOTIFY, f"MONITOR DOWN: {monitor_name} — {msg}"],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
                )
            except Exception as e:
                log(f"Notify failed: {e}")

            # ── Check if another agent is already working on it ──────
            skip_fixer = False
            pipeline_state = ""
            current_agent = ""
            try:
                with open(PIPELINE_STATUS) as f:
                    for line in f:
                        if line.startswith("PIPELINE_STATE="):
                            pipeline_state = line.strip().split("=", 1)[1]
                        if line.startswith("CURRENT_AGENT="):
                            current_agent = line.strip().split("=", 1)[1]
                        if line.startswith("FIX_RESPONSIBILITY="):
                            fix_resp = line.strip().split("=", 1)[1]
            except:
                pass

            if pipeline_state in ("running", "fixing") and current_agent:
                log(f"Agent '{current_agent}' is already working (state={pipeline_state}). Skipping emergency fixer.")
                skip_fixer = True

            if os.path.exists(PAUSE_FILE):
                log("Agents paused — skipping emergency fixer")
                skip_fixer = True
            elif in_cooldown():
                log("In cooldown — skipping emergency fixer (triggered recently)")
                skip_fixer = True

            if not skip_fixer:
                # ── Build context file for the emergency fixer ───────
                alert_context = {
                    "trigger": "uptime-kuma",
                    "monitor": monitor_name,
                    "message": msg,
                    "url": monitor.get("url", ""),
                    "monitor_type": monitor.get("type", ""),
                    "timestamp": datetime.now().isoformat(),
                    "pipeline_state": pipeline_state,
                    "current_agent": current_agent,
                }
                try:
                    with open(ALERT_CONTEXT_FILE, "w") as f:
                        json.dump(alert_context, f, indent=2)
                except:
                    pass

                log(f"Triggering Emergency Fixer for: {monitor_name} ({msg})")
                set_cooldown()
                try:
                    subprocess.Popen(
                        [EMERGENCY_FIXER, "health", "1"],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
                    )
                except Exception as e:
                    log(f"Emergency fixer trigger failed: {e}")

        elif status == 1:  # UP (recovery)
            log(f"✓ {monitor_name} is back UP")

        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"OK")

    def do_GET(self):
        """Health check endpoint."""
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"status": "running", "service": "health-webhook"}).encode())

    def log_message(self, format, *args):
        pass  # suppress default logging

if __name__ == "__main__":
    port = 9095
    log(f"Health webhook receiver starting on port {port}")
    server = HTTPServer(("0.0.0.0", port), WebhookHandler)
    server.serve_forever()
