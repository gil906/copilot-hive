# Changelog

All notable changes to Copilot Hive will be documented in this file.

## [2.0.0] - 2026-10-22

### Added
- **5 Smart Orchestration Topologies (`lib/hive-engine.js`)**:
  - `cyclic-pipeline` (Deterministic continuous loop: Developer → GitGuardian → Deployer → Regression → Auditor)
  - `star-hub` (Central Dispatcher hub coordinating specialist spokes with strict health verification)
  - `dag-mesh` (Directed Acyclic Graph with parallel Fan-Out research/verification stages and Fan-In synthesis)
  - `adaptive-swarm` (Dynamic routing powered by real-time Multi-Factor Agent Utility Scoring and ICE idea prioritization)
  - `self-healing-ring` (Circuit-breaker ring with automatic breaker retry, git rollback, and Emergency Fixer escalation)
- **Context-Mode Knowledge Base & Sandbox Engine (`lib/context-mode.js`)**:
  - Built-in hybrid retrieval combining Okapi BM25, Porter Stemming, 3-gram Trigram matching, and Reciprocal Rank Fusion (RRF) with proximity reranking
  - Think-in-Code subprocess sandbox (`ctx-exec`) for JavaScript, Python, and Shell processing of large files (`FILE_CONTENT`) without polluting agent context windows
  - Live context savings telemetry (`ctx-stats`) tracking raw bytes processed vs. emitted bytes and estimated tokens saved
  - Automatic `.mcp.json` scaffolding pre-configured with `context-mode` (`npx -y context-mode`)
- **Magic UI Web Command Center (`dashboard.js`)**:
  - Complete cybernetic dark-mode overhaul using Magic UI components (`MagicCard`, `BorderBeam`, `AnimatedBeam`, `OrbitingCircles`, `Particles`, `FlickeringGrid`, `NumberTicker`, `AnimatedCircularProgressBar`, `ShimmerButton`, `HyperText`, `BentoGrid`, `Terminal`)
  - Interactive 5-Topology SVG Studio with live animated energy beams and per-agent utility score bars
  - Context-Mode Search & Sandbox Studio, Ideas/Bugs CRUD manager, Agent Inspector, and Live Log Terminal
- **Complete 14-Agent Autonomous Swarm & Prompt Suite**:
  - Added dedicated prompt files for `deployer.md`, `gitguardian.md`, `regressiontest.md`, `reporter.md`, and `dispatcher.md` alongside the 9 core research/pipeline prompts
  - Shared `lib/agent-helpers.sh` for DRY prompt loading, Context-Mode pre-indexing, and safe `--deny-tool` enforcement
- **CLI v2.0 (`bin/cli.js`) & SDK (`index.js`)**:
  - Added `topology`, `next-agent`, `ctx-index`, `ctx-search`, `ctx-stats`, `ctx-exec`, `doctor`, and `dashboard` CLI subcommands
  - Full 14-agent support across `list` (with `--research`, `--pipeline`, `--verification`, `--security`, `--governance`, `--emergency`, `--orchestrator` filters) and `show` (supporting both canonical names and short script aliases)

### Fixed
- Fixed argument order bug in `copilot-dispatcher.sh` where `PROJECT_ID` was overwritten by `--dry-run` before `load-project.sh` ran
- Fixed `.pipeline-status` race condition between `copilot-dispatcher.sh` and `copilot-improve.sh` / `copilot-audit.sh`
- Fixed `set_status` JSON escaping and `flock` subshell lock release across all pipeline scripts
- Fixed `run-all-projects.sh` and `run-agent.sh` to dispatch across all registered projects and support all 14 agent names
- Removed all hardcoded personal host paths and environment-specific defaults across scripts, configs, and SVG screenshots

## [1.6.0] - 2026-04-03

### Added
- Cross-platform support for macOS (Intel & Apple Silicon), WSL 2, and Docker Desktop
- `platform-detect.sh` — portable shell library with OS detection, locking, hex encoding, file stats
- macOS launchd plist generation in installer (alternative to cron)
- Docker socket auto-detection (Docker Desktop, Colima, Podman)
- Multi-arch Dockerfile via `TARGETPLATFORM` ARG (AMD64 + ARM64)
- OS-aware default paths: macOS uses `$HOME/.copilot-hive`, Linux uses `/opt/copilot-hive`
- Supported Platforms section in README with compatibility table
- Platform badge in README header

### Changed
- All `flock` calls replaced with `portable_lock`/`acquire_agent_lock` (works on macOS)
- All `xxd` calls replaced with `random_hex`/`generate_build_id` (works on macOS)
- All `stat -c`/`stat -f` calls replaced with `get_file_size` helper
- All `date -r` calls replaced with `get_file_mtime` helper
- Installer detects OS and adjusts paths, scheduling method, and defaults
- Docker socket mount uses `${DOCKER_SOCK}` env var for Docker Desktop compatibility

## [1.5.0] - 2026-04-03

### Added
- Central `config.sh` for all shared configuration (#22, #23)
- File locking (`flock`) on pipeline status to prevent race conditions (#3)
- Atomic writes to `.pipeline-status` via tmp+mv (#4)
- Bearer token authentication on health webhook (#5)
- Stale agent detection and auto-kill after 1h timeout (#6)
- Pre-push syntax validation for Python, JavaScript, and shell scripts (#7, #30)
- Rollback mechanism on repeated deploy failures (#9)
- Per-agent flock locking for research agents (#13)
- Retry helper with exponential backoff for network operations (#18)
- Research agent output file validation (#19)
- Parallel regression test execution (#21)
- Git history secret scanning in gitguardian (#25)
- Log rotation for all agent logs (>10MB auto-rotated) (#27)
- HTML report template for reporter agent (#28)
- Team context generation (`.team-context.md`) for inter-agent awareness (#36)
- Quality scoring format (priority/impact/effort) for research agents (#37)
- Failure history and auditor feedback passed to Developer agent (#38)
- Structured diagnostics JSON for Emergency Fixer (#40)
- Metrics tracking (`track-metrics.sh` + `metrics.jsonl`) (#41)
- Rejected ideas log to prevent re-suggesting failed ideas (#42)
- Pre-push quality gate script (`pre-push-check.sh`) (#43)
- Full project scaffolding in CLI `init` command (#44)
- Dispatcher heartbeat for external health monitoring (#45)
- Runtime prompt loading from `prompts/` directory (#46)
- `--dry-run` mode for safe agent testing (#47)
- Dockerfile and docker-compose.yml for containerized deployment (#49)

### Fixed
- Syntax errors in audit.sh and emergencyfixer.sh notify calls (#1, #2)
- Broken date format in radical.sh (missing `+` prefix) (#35)
- Build version "unknown" bypass in deploy verification (#10)
- Double commit on urgent admin requests (#14)
- SmartThings notification now delivers message text (#17)
- Atomic SmartThings switch toggle with cleanup trap (#16)
- Hardcoded DB credentials removed from reporter (#15)
- Deploy SHA only recorded after health verification (#20)
- Auditor now reviews only new commits since last audit (#39)
- Idea deduplication instructions added to Developer prompt (#33)
- Git push failure in crash recovery path now handled (#8)

### Changed
- Implemented.log now loads last 500 lines (was 50) (#11)
- Ideas files read in full (was truncated at 200 lines) (#12)
- Gitguardian scans 10 additional file extensions (#26)
- Agent count updated from 11 to 13 in README (#48)
- Version bumped to 1.5.0 (#50)

## [1.0.0] - Initial Release

- 11-agent autonomous development framework
- Event-driven pipeline with dispatcher
- Research agents, developer, auditor, emergency fixer
- SmartThings notifications
- Health webhook for Uptime Kuma
- npm CLI package
