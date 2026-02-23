<div align="center">

# 🐝 Copilot Hive

### An Autonomous AI Agent Swarm for Continuous Software Development

**11 specialized GitHub Copilot agents** that continuously research, develop, audit, and deploy improvements to a production application — fully autonomous, self-healing, running 24/7.

[![Agents](https://img.shields.io/badge/AI_Agents-11-blueviolet?style=for-the-badge&logo=github-copilot&logoColor=white)](#-the-hive---11-agents)
[![Pipeline](https://img.shields.io/badge/Pipeline-Event_Driven-green?style=for-the-badge&logo=rocket&logoColor=white)](#-event-driven-pipeline)
[![Ideas/Day](https://img.shields.io/badge/Ideas%2FDay-780+-orange?style=for-the-badge&logo=lightbulb&logoColor=white)](#-research-layer)
[![Monitoring](https://img.shields.io/badge/Monitoring-Uptime_Kuma-blue?style=for-the-badge&logo=uptimekuma&logoColor=white)](#-health-monitoring--self-healing)
[![Self-Healing](https://img.shields.io/badge/Self--Healing-Autonomous-red?style=for-the-badge&logo=dependabot&logoColor=white)](#-smart-failure-coordination)

---

*"What if your entire engineering team was AI — and never slept?"*

</div>

---

## 📖 What is Copilot Hive?

Copilot Hive is a **framework for running multiple GitHub Copilot CLI agents as an autonomous development team**. Each agent has a specialized role — some research ideas, one implements them, one audits the code, and emergency agents fix things when they break.

The agents coordinate through:
- 📋 **Shared idea files** — research agents write structured ideas, the developer agent reads and implements them
- 🔄 **Event-driven pipeline** — a dispatcher chains agents together: develop → deploy → verify → audit → repeat
- 🔖 **Version verification** — each commit gets a unique build ID; the pipeline confirms the *new* container is actually running before proceeding
- 🚑 **Self-healing** — if a deploy fails, the agent that broke it gets 2 retries before escalating to the Emergency Fixer
- 📱 **Push notifications** — failures trigger Samsung SmartThings alerts to your phone
- 📊 **Uptime Kuma monitoring** — all services monitored with dashboards, history, and webhook-triggered emergency response

### What does it look like in practice?

```
07:00  🎨 Website Designer    → writes 10 UI/UX ideas
07:05  🖥️ Portal Designer     → writes 10 dashboard ideas
07:10  ⚙️ API Architect       → writes 10 backend ideas
07:15  🔥 Radical Visionary   → writes 5 game-changing ideas
07:20  ⚖️ Lawyer              → writes legal/compliance ideas
07:25  📋 Compliance          → writes certification ideas
       ...meanwhile...
07:01  🔧 Developer           → reads all ideas, implements the best ones
07:45  🔧 Developer           → pushes to GitHub
07:46  🚀 GitHub Actions      → builds + deploys new container
07:48  📡 Dispatcher          → confirms new version is live ✓
07:48  🔍 Auditor             → security audit + tests on new code
08:15  🔍 Auditor             → pushes fixes
08:16  🚀 GitHub Actions      → builds + deploys
08:18  📡 Dispatcher          → confirms new version ✓
08:18  🔧 Developer           → next cycle starts...
```

**Result:** Your application gets continuous, autonomous improvements 24/7 — new features, security fixes, UI polish, legal compliance, performance optimizations — all without human intervention.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     COPILOT HIVE ARCHITECTURE                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   RESEARCH LAYER (read-only, idea generation)                   │
│   ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐         │
│   │ Website  │ │ Portal   │ │   API    │ │ Radical  │         │
│   │ Designer │ │ Designer │ │Architect │ │Visionary │         │
│   │ 10/hour  │ │ 10/hour  │ │ 10/hour  │ │ 5/2hour  │         │
│   └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘         │
│        └──────┬──────┴────────────┴──────┬──────┘               │
│               ▼          ideas/*.md      ▼                      │
│   ┌───────────────────────────────────────────────────┐         │
│   │              🔧 DEVELOPER AGENT                    │         │
│   │    Reads ALL idea files → Implements best ones     │         │
│   └──────────────────────┬────────────────────────────┘         │
│                          │ git push                             │
│   ┌──────────────────────▼────────────────────────────┐         │
│   │           📡 DISPATCHER (every 1 min)              │         │
│   │    GitHub Actions → Version Verify → Health        │         │
│   └──────────────────────┬────────────────────────────┘         │
│                          │ deploy verified ✓                    │
│   ┌──────────────────────▼────────────────────────────┐         │
│   │              🔍 AUDITOR AGENT                      │         │
│   │    Security audit + tests → fixes → git push       │         │
│   └──────────────────────┬────────────────────────────┘         │
│                          │ deploy verified → loop ♻️            │
│                                                                 │
│   SUPPORT LAYER          │    EMERGENCY LAYER                   │
│   ┌──────┐ ┌──────┐ ┌───┴──┐ ┌──────┐ ┌──────┐ ┌──────┐     │
│   │Legal │ │Comply│ │Report│ │Emerge│ │Uptime│ │Smart │     │
│   │Agent │ │Agent │ │Agent │ │Fixer │ │ Kuma │ │Thing │     │
│   └──────┘ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘     │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🐝 The Hive — 11 Agents

### 🔧 Code-Modifying Agents (Pipeline)

| Agent | Script | What It Does |
|-------|--------|-------------|
| **🔧 Developer** | `copilot-improve.sh` | Reads ALL idea files from 6 research agents, picks the best ones, implements them, pushes to GitHub |
| **🔍 Auditor** | `copilot-audit.sh` | Security audits, test coverage, bug fixes, code quality — runs after every developer push |
| **🚑 Emergency Fixer** | `copilot-emergencyfixer.sh` | Last resort — reads alert context, gathers live Docker logs + HTTP checks, fixes critical issues |

### 🔬 Research Agents (Read-Only — never modify code)

| Agent | Script | Focus Area | Ideas/Run | Schedule |
|-------|--------|-----------|-----------|----------|
| **🎨 Website Designer** | `copilot-designer-web.sh` | Public website UX, animations, landing pages, conversions, mobile | **10** | Every hour |
| **🖥️ Portal Designer** | `copilot-designer-portal.sh` | Logged-in dashboard, admin panel, data visualizations, settings | **10** | Every hour |
| **⚙️ API Architect** | `copilot-architect-api.sh` | API design, backend modules, orchestration, performance, new tools | **10** | Every hour |
| **🔥 Radical Visionary** | `copilot-radical.sh` | Game-changing ideas — competitor analysis, bleeding-edge AI, disruption | **5** (transformative) | Every 2h |
| **⚖️ Lawyer** | `copilot-lawyer.sh` | Legal compliance, privacy policies, terms of service, competitor legal | 5 | Every 2h |
| **📋 Compliance** | `copilot-compliance.sh` | SOC2, PCI-DSS, HIPAA, ISO 27001 compliance readiness | 5 | Every 2h |

### 📊 Support Agents

| Agent | Script | What It Does |
|-------|--------|-------------|
| **📧 Reporter** | `copilot-reporter.sh` | Sends HTML email summaries (daily + weekly) of all agent activity |
| **🚀 Deployer** | GitHub Actions | Builds Docker images on push, deploys via SSH |

### 📈 Idea Throughput

```
Per Hour:   10 (web) + 10 (portal) + 10 (api)     = 30 specialist ideas
Per 2h:     + 5 (radical) + 5 (lawyer) + 5 (comply) = 15 strategic ideas
Per Day:    720 specialist + 180 strategic           = ~780 ideas → Developer
```

---

## ⚡ Event-Driven Pipeline

The **Dispatcher** (`copilot-dispatcher.sh`) runs every minute via cron and orchestrates the Developer ↔ Auditor loop:

```
┌─────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  IDLE   │────▶│ RUNNING  │────▶│ WAITING  │────▶│ VERIFY   │
│         │     │(Dev or   │     │ DEPLOY   │     │ VERSION  │
│         │     │ Auditor) │     │          │     │          │
└────▲────┘     └──────────┘     └──────────┘     └─────┬────┘
     │                                                   │
     │          ┌──────────┐                             │
     │          │ FIXING   │◀── deploy failed ───────────┤
     │          │(re-run   │                             │
     │          │ breaker) │                             │
     │          └──────────┘                             │
     │                                                   │
     └───────────── deploy + version verified ◀──────────┘
```

### State Machine

| State | What's Happening |
|-------|-----------------|
| `idle` | Ready to launch next agent |
| `running` | Agent actively working (PID tracked) |
| `waiting_deploy` | Code pushed, waiting for GitHub Actions + Docker deploy |
| `fixing` | Deploy failed — re-running the agent that broke it (2 retries before escalation) |

### Pipeline Status File (`.pipeline-status`)

All agents read/write a shared status file:

```bash
PIPELINE_STATE=waiting_deploy   # Current state
CURRENT_AGENT=improve           # Who's running
LAST_BUILD_ID=1740234567-a1b2c3  # Expected version in container
LAST_COMMIT=abc1234             # Git SHA that was pushed
FIX_RESPONSIBILITY=improve      # Who broke it (if fixing)
FIX_RETRIES=1                   # Retry count (max 2)
```

---

## 🔖 Version Verification System

The classic CI/CD problem: *"Did the deploy actually work?"* — Copilot Hive solves this with build IDs.

### How It Works

**1. Agent stamps a unique build ID before committing:**
```bash
BUILD_ID="$(date +%s)-$(openssl rand -hex 4)"
echo "$BUILD_ID" > .build-id
git add -A && git commit && git push
```

**2. The app exposes it via an API endpoint:**
```python
@app.get("/api/version")
def version():
    build_id = open("/app/.build-id").read().strip()
    return {"build_id": build_id, "status": "running"}
```

**3. Dispatcher verifies after deploy:**
```bash
RUNNING=$(curl -s localhost:8080/api/version | jq -r '.build_id')
if [ "$RUNNING" = "$EXPECTED_BUILD_ID" ]; then
    # ✅ New container is live — next agent can start
else
    # ⏳ Still deploying or deploy failed — keep waiting
fi
```

This prevents the next agent from working against stale code.

---

## 🛡️ Smart Failure Coordination

When a deploy breaks, the system follows an escalation path:

```
Deploy Failed!
     │
     ├─ 1. Re-run the SAME agent that pushed the bad code
     │     (it has context about what it changed)
     │
     ├─ 2. If still broken → re-run again (attempt 2/2)
     │
     └─ 3. If STILL broken → 🚑 Emergency Fixer
           Gets full context:
           • Docker container logs (last 50 lines)
           • Container health check status
           • HTTP response codes from all services
           • GitHub Actions build logs
           • Which agent broke it and what they tried
```

The Emergency Fixer's prompt includes live diagnostics:

```
CONTAINER STATUS:
  yourproject-api: running (healthy) — Up 2 hours
  yourproject-web: running (healthy) — Up 2 hours
  yourproject-db:  running (healthy) — Up 5 days

HTTP CHECKS:
  Website: 200 (0.05s)
  API:     502 (0.01s)  ← PROBLEM

RECENT API LOGS:
  ModuleNotFoundError: No module named 'newfeature'
  ...

ALERT CONTEXT:
  Monitor: API Health Check
  Status: DOWN for 30 minutes
  Previous agent (improve) failed to fix in 2 attempts
```

---

## 🏥 Health Monitoring & Self-Healing

### Uptime Kuma Integration

[Uptime Kuma](https://github.com/louislam/uptime-kuma) monitors all services with beautiful dashboards:

```
┌─────────────────────────────────────────┐
│         UPTIME KUMA MONITORS            │
├─────────────────────────────────────────┤
│ ✅ Website (HTTP)     → port 80         │
│ ✅ API Health (HTTP)  → /health         │
│ ✅ API Version (HTTP) → /api/version    │
│ ✅ External HTTPS     → your domain     │
│ ✅ Database (TCP)     → port 5432       │
│ ✅ Web Container      → Docker status   │
│ ✅ API Container      → Docker status   │
│ ✅ DB Container       → Docker status   │
├─────────────────────────────────────────┤
│ Check interval: 60 seconds              │
│ Alert threshold: 30 minutes             │
│ Webhook → Emergency Fixer               │
└─────────────────────────────────────────┘
```

### Health Webhook (`health-webhook.py`)

A tiny Python HTTP server that bridges Uptime Kuma → Emergency Fixer:

```
Uptime Kuma detects service DOWN for 30 min
         │
         ▼
   Webhook receives alert
         │
         ├─ Is an agent already working on it?
         │    → Yes: skip (let them finish)
         │    → No: continue
         │
         ├─ Cooldown check (10 min between triggers)
         │
         ├─ Write .alert-context.json with details
         │
         └─ Launch Emergency Fixer with full context
```

---

## 📱 SmartThings Push Notifications

Get alerts on your phone when agents fail:

```bash
# notify-smartthings.sh
# Uses SmartThings API to toggle a virtual switch
# SmartThings Automation: Switch ON → Push notification to phone
```

**Setup:**
1. Create a SmartThings Personal Access Token
2. Put it in `.env` as `SMARTTHINGS_PAT=your-token`
3. The script creates a `CopilotAlert` virtual switch
4. Set up a SmartThings Automation: "When CopilotAlert turns ON → Send notification"

---

## 🚨 Urgent Idea System

Need something implemented NOW? Submit an urgent idea:

```json
{
  "ideas": [{
    "id": "my-urgent-fix",
    "title": "Add rate limiting to API",
    "description": "Implement rate limiting on all /api/ endpoints...",
    "urgent": true,
    "status": "pending"
  }]
}
```

**Every agent** checks `admin_ideas.json` at startup. The very next agent to run — whether it's the Website Designer, Lawyer, or Compliance Officer — **temporarily becomes a developer**, implements the idea, pushes it, then returns to its normal role.

```
Any agent starts → Check for urgent ideas
  │
  ├─ No urgent ideas → Normal work
  │
  └─ Urgent idea found!
       → Switch to developer mode
       → Implement the idea
       → Push to GitHub
       → Mark as "implemented"
       → Exit
```

---

## 🔬 Agent Prompt Examples

### Radical Visionary (excerpt)

```
YOUR MISSION: You are the VISIONARY — the most important research agent.
Your job is to find BIG IDEAS that make the platform 10x better overnight.

You provide exactly 5 ideas per run — each must be TRANSFORMATIVE:
  🔥 Ideas that create massive visual impact — jaw-dropping dashboards
  🔥 Ideas that leapfrog competitors — features nobody else has
  🔥 Ideas that dramatically improve performance — 10x faster
  🔥 Ideas that bring cutting-edge AI/ML in ways competitors haven't

QUALITY BAR: Each idea should be worth MORE than all 10 ideas
from any specialist agent combined. Think disruption, not polish.
```

### Developer Agent (excerpt)

```
You are the DEVELOPER agent. You are part of an eleven-agent autonomous team.
Read the following idea files and implement the best improvements:
  - ideas/web_design_latest.md   (Website Designer — 10 ideas)
  - ideas/portal_design_latest.md (Portal Designer — 10 ideas)
  - ideas/api_architect_latest.md (API Architect — 10 ideas)
  - ideas/radical_latest.md      (Radical Visionary — 5 game-changers)
  - ideas/lawyer_latest.md       (Lawyer — legal ideas)
  - ideas/compliance_latest.md   (Compliance — certification ideas)

Pick the highest-impact ideas and implement them. Use --yolo mode.
After implementation, stamp .build-id and push to GitHub.
```

### Research Agents (read-only enforcement)

```bash
# Research agents use --deny-tool to prevent code modifications:
copilot --deny-tool "bash(git push*)" \
        --deny-tool "bash(git commit*)" \
        --deny-tool "bash(git add*)" \
        --add-dir "/opt/yourproject:ro"  # Read-only access
```

---

## ⏰ Crontab Schedule

```cron
# PIPELINE DISPATCHER — every minute
* * * * * /opt/copilot-hive/copilot-dispatcher.sh

# SPECIALIST RESEARCH — every HOUR (10 ideas each)
0  * * * * /opt/copilot-hive/copilot-designer-web.sh
5  * * * * /opt/copilot-hive/copilot-designer-portal.sh
10 * * * * /opt/copilot-hive/copilot-architect-api.sh

# VISIONARY + SUPPORT — every 2 HOURS
15 0,2,4,6,8,10,12,14,16,18,20,22 * * * /opt/copilot-hive/copilot-radical.sh
20 0,2,4,6,8,10,12,14,16,18,20,22 * * * /opt/copilot-hive/copilot-lawyer.sh
25 0,2,4,6,8,10,12,14,16,18,20,22 * * * /opt/copilot-hive/copilot-compliance.sh

# REPORTER
0 18 * * *   /opt/copilot-hive/copilot-reporter.sh daily
0 18 * * 0   /opt/copilot-hive/copilot-reporter.sh weekly
```

---

## 🚀 Getting Started

### Prerequisites

- [GitHub Copilot CLI](https://docs.github.com/en/copilot/github-copilot-in-the-cli) (`copilot` command)
- Docker + Docker Compose
- A Dockerized application with a health endpoint
- Git credentials configured (`~/.git-credentials`)
- (Optional) Samsung SmartThings account for notifications
- (Optional) Uptime Kuma for monitoring

### Quick Setup

1. **Clone and configure:**
   ```bash
   git clone https://github.com/yourusername/copilot-hive.git /opt/copilot-hive
   cd /opt/copilot-hive
   cp .env.example .env
   # Edit .env with your tokens
   ```

2. **Update paths in scripts:**
   - Set `PROJECT_DIR` to your application's source code path
   - Set `IDEAS_DIR` to where idea files should be written
   - Update Docker container names to match your setup

3. **Add the `/api/version` endpoint to your app:**
   ```python
   @app.get("/api/version")
   def version():
       build_id = open("/app/.build-id").read().strip()
       return {"build_id": build_id, "status": "running"}
   ```

4. **Install crontab:**
   ```bash
   crontab crontab.example
   ```

5. **Start monitoring (optional):**
   ```bash
   docker-compose -f monitoring.yml up -d
   ```

### Customization

- **Add/remove research agents** — copy any `copilot-designer-*.sh` and change the prompt focus area
- **Change idea counts** — edit "EXACTLY 10 ideas" in prompts
- **Adjust schedules** — modify crontab entries
- **Add competitors** — update the competitor list in `copilot-radical.sh`
- **Change escalation behavior** — edit `MAX_FIX_RETRIES` in `copilot-dispatcher.sh`

---

## 📁 File Reference

| File | Purpose |
|------|---------|
| `copilot-dispatcher.sh` | 📡 Pipeline orchestrator — runs every 1 min, chains Developer ↔ Auditor |
| `copilot-improve.sh` | 🔧 Developer agent — implements ideas from all research agents |
| `copilot-audit.sh` | 🔍 Auditor agent — security, tests, code quality |
| `copilot-emergencyfixer.sh` | 🚑 Emergency agent — fixes critical failures with full diagnostics |
| `copilot-designer-web.sh` | 🎨 Website Designer — 10 UI/UX ideas per hour |
| `copilot-designer-portal.sh` | 🖥️ Portal Designer — 10 dashboard ideas per hour |
| `copilot-architect-api.sh` | ⚙️ API Architect — 10 backend ideas per hour |
| `copilot-radical.sh` | 🔥 Radical Visionary — 5 game-changing ideas every 2h |
| `copilot-lawyer.sh` | ⚖️ Lawyer — legal/compliance research |
| `copilot-compliance.sh` | 📋 Compliance — certification readiness |
| `copilot-reporter.sh` | 📧 Reporter — daily/weekly HTML email summaries |
| `copilot-deployer.sh` | 🚀 Deployment helper |
| `copilot-gitguardian.sh` | 🔐 Secret scanner |
| `copilot-regressiontest.sh` | 🧪 Regression test runner |
| `health-webhook.py` | 🏥 Uptime Kuma → Emergency Fixer bridge |
| `notify-smartthings.sh` | 📱 SmartThings push notification sender |
| `.pipeline-status.example` | 📋 Example pipeline state file |
| `.env.example` | 🔑 Example environment variables |
| `ideas/` | 💡 Idea files written by research agents |

---

## 🤝 Contributing

This is an open-source framework. Contributions welcome! Some ideas:

- 🆕 New agent types (e.g., Performance Agent, Accessibility Agent, i18n Agent)
- 📊 Web dashboard for agent status and idea management
- 🔌 Integrations with other notification services (Slack, Discord, Telegram)
- 🐳 Docker Compose setup for the entire hive
- 📈 Prometheus/Grafana metrics for agent performance

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

<div align="center">

*Built with [GitHub Copilot](https://github.com/features/copilot) 🤖*

**🐝 The hive never sleeps.**

</div>
