# ══════════════════════════════════════════════════════════════════════
#  Copilot Hive — Containerized Agent Framework
#  Runs the dispatcher and all agent scripts via cron
# ══════════════════════════════════════════════════════════════════════
# Multi-arch support: builds on AMD64, ARM64 (Apple Silicon, Raspberry Pi)
ARG TARGETPLATFORM=linux/amd64
FROM --platform=${TARGETPLATFORM} ubuntu:22.04

RUN apt-get update && apt-get install -y \
    bash curl git python3 python3-pip jq cron docker.io \
    nodejs npm \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/copilot-hive

# Copy all scripts and config
COPY *.sh ./
COPY *.js ./
COPY *.py ./
COPY config.sh ./
COPY package.json ./
COPY bin/ ./bin/
COPY lib/ ./lib/
COPY prompts/ ./prompts/
COPY templates/ ./templates/
COPY .env.example ./

# Make scripts executable
RUN chmod +x *.sh lib/*.sh

# Create runtime directories
RUN mkdir -p ideas changelogs projects

# Install npm dependencies (if any)
RUN npm install --production 2>/dev/null || true

# Crontab setup
COPY crontab.example /etc/cron.d/copilot-hive
RUN chmod 0644 /etc/cron.d/copilot-hive 2>/dev/null || true

EXPOSE 9095 9096

# Health check
HEALTHCHECK --interval=60s --timeout=10s --retries=3 \
  CMD [ -f /opt/copilot-hive/.dispatcher-heartbeat ] && \
      [ $(($(date +%s) - $(cat /opt/copilot-hive/.dispatcher-heartbeat))) -lt 180 ] || exit 1

# Run health webhook + dashboard + cron
CMD ["bash", "-c", "python3 health-webhook.py & node dashboard.js & cron -f"]
