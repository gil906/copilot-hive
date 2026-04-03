# Changelog

All notable changes to Copilot Hive will be documented in this file.

## [2.0.0] - 2026-04-03

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
- Version bumped to 2.0.0 (#50)

## [1.0.0] - Initial Release

- 11-agent autonomous development framework
- Event-driven pipeline with dispatcher
- Research agents, developer, auditor, emergency fixer
- SmartThings notifications
- Health webhook for Uptime Kuma
- npm CLI package
