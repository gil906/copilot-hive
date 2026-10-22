const fs = require('fs');
const path = require('path');

const PROMPTS_DIR = path.join(__dirname, 'prompts');

let hiveEngine = null;
let contextMode = null;

try {
  hiveEngine = require('./lib/hive-engine');
} catch (_) {
  hiveEngine = null;
}

try {
  contextMode = require('./lib/context-mode');
} catch (_) {
  contextMode = null;
}

// Canonical 14 agents mapped by primary name
const canonicalAgents = {
  developer: 'developer.md',
  auditor: 'auditor.md',
  'emergency-fixer': 'emergency-fixer.md',
  'website-designer': 'website-designer.md',
  'portal-designer': 'portal-designer.md',
  'api-architect': 'api-architect.md',
  'radical-visionary': 'radical-visionary.md',
  lawyer: 'lawyer.md',
  compliance: 'compliance.md',
  deployer: 'deployer.md',
  gitguardian: 'gitguardian.md',
  regressiontest: 'regressiontest.md',
  reporter: 'reporter.md',
  dispatcher: 'dispatcher.md',
};

// Short script aliases -> prompt file mapping for 100% backward compatibility
const agentAliases = {
  improve: 'developer.md',
  audit: 'auditor.md',
  emergencyfixer: 'emergency-fixer.md',
  'designer-web': 'website-designer.md',
  'designer-portal': 'portal-designer.md',
  'architect-api': 'api-architect.md',
  radical: 'radical-visionary.md',
  'regression-test': 'regressiontest.md',
  'git-guardian': 'gitguardian.md',
};

const agents = {
  ...canonicalAgents,
  ...agentAliases,
};

const FALLBACK_PROMPTS = {
  'deployer.md': '# Deployer Agent\n\nYou are the DEPLOYER agent in a 14-agent autonomous swarm. Build containers, verify health and version endpoints, and roll back automatically on deployment failure.\n',
  'gitguardian.md': '# GitGuardian Security Agent\n\nYou are the GITGUARDIAN agent in a 14-agent autonomous swarm. Scan the repository and git history for leaked secrets, credentials, API keys, and high-entropy tokens.\n',
  'regressiontest.md': '# Regression Test Agent\n\nYou are the REGRESSION TEST agent in a 14-agent autonomous swarm. Run unit, integration, and end-to-end verification checks after deployments and file structured bug reports on failure.\n',
  'reporter.md': '# Reporter Agent\n\nYou are the REPORTER agent in a 14-agent autonomous swarm. Summarize agent runs, deployed features, audit findings, and context-mode telemetry into executive reports.\n',
  'dispatcher.md': '# Dispatcher Orchestrator Agent\n\nYou are the DISPATCHER agent in a 14-agent autonomous swarm. Coordinate pipeline state transitions, topology routing, version verification, and self-healing escalations.\n',
};

function getPrompt(agentName) {
  const normalized = String(agentName || '').trim().replace(/\.md$/, '');
  const file = agents[normalized] || (canonicalAgents[normalized] ? canonicalAgents[normalized] : null);
  if (!file) {
    throw new Error(`Unknown agent: ${agentName}. Available: ${Object.keys(canonicalAgents).join(', ')}`);
  }
  const fullPath = path.join(PROMPTS_DIR, file);
  if (fs.existsSync(fullPath)) {
    return fs.readFileSync(fullPath, 'utf8');
  }
  if (FALLBACK_PROMPTS[file]) {
    return FALLBACK_PROMPTS[file];
  }
  throw new Error(`Prompt file not found: ${fullPath}`);
}

function listAgents(includeAliases = false) {
  return includeAliases ? Object.keys(agents) : Object.keys(canonicalAgents);
}

const DEFAULT_TOPOLOGIES = [
  {
    id: 'cyclic-pipeline',
    name: 'Cyclic Pipeline',
    icon: '🔄',
    summary: 'Deterministic continuous loop: Developer → Deployer → Regression → Auditor → GitGuardian.',
    ascii: '  [Research 6x] ──► (Ideas Hub) ──► 🔧 Developer ──► 🚀 Deployer ──► 🧪 Regression ──► 🔍 Auditor ──► 🔐 GitGuardian ──┐\n                                        ▲                                                                              │\n                                        └─────────────────────────── ♻️  Verified Cycle ───────────────────────────────┘',
  },
  {
    id: 'star-hub',
    name: 'Star Hub (Central Dispatcher)',
    icon: '⭐',
    summary: 'Central Dispatcher hub coordinates every specialist spoke with strict state locking and health checks.',
    ascii: '                   🎨 Web     🖥️ Portal    ⚙️ API\n                       \\         │         /\n        🔥 Radical ───► 📡 DISPATCHER HUB ◄─── 🔍 Auditor\n                       /         │         \\\n                 🔧 Dev      🚀 Deploy    🚑 Emergency',
  },
  {
    id: 'dag-mesh',
    name: 'DAG Dependency Mesh',
    icon: '🕸️',
    summary: 'Directed Acyclic Graph with parallel Fan-Out research/verification stages and Fan-In synthesis gates.',
    ascii: '  Stage 1 (Fan-Out):  [🎨 Web] [🖥️ Portal] [⚙️ API] [🔥 Radical] [⚖️ Lawyer] [📋 Compliance]\n                            └───┬────────┴─────────┬────────┴──────────┘\n  Stage 2 (Develop):            ▼                  ▼\n                          🔧 Developer ──► 🔐 GitGuardian\n                                │                  │\n  Stage 3 (Verify):             ▼                  ▼\n                          🚀 Deployer ──► [🧪 Regression ∥ 🔍 Auditor] ──► 📧 Reporter',
  },
  {
    id: 'adaptive-swarm',
    name: 'Adaptive Swarm (Multi-Factor Utility + ICE)',
    icon: '🧠',
    summary: 'Dynamic agent routing driven by real-time Multi-Factor Utility Scoring and ICE idea prioritization.',
    ascii: '  ╭─────────────────────────────────────────────────────────────────────────╮\n  │ 🧠 SWARM INTELLIGENCE ENGINE  U(a) = w₁·Urgency + w₂·Stale + w₃·ICE    │\n  ╰──────┬──────────────┬───────────────┬───────────────┬──────────────┬────╯\n         ▼              ▼               ▼               ▼              ▼\n    🚑 Fixer       🔧 Developer    🔍 Auditor     🧪 Regression   🔥 Radical',
  },
  {
    id: 'self-healing-ring',
    name: 'Self-Healing Ring (Circuit-Breaker)',
    icon: '🛡️',
    summary: 'Resilience-first ring with automatic circuit-breaker isolation, breaker-first retry, and Emergency Fixer escalation.',
    ascii: '  🟢 Healthy Ring:  🔧 Developer ──► 🚀 Deployer ──► 🧪 Regression ──► 🔍 Auditor\n                         ▲                                                  │\n                         └── 🚑 Emergency Fixer ◄── ⚠️ Breaker Retry (2x) ◄─┘',
  },
];

function getTopology(id) {
  try {
    if (!hiveEngine) hiveEngine = require('./lib/hive-engine');
    if (hiveEngine && typeof hiveEngine.getTopology === 'function') {
      const res = hiveEngine.getTopology(id);
      if (res) return res;
    }
  } catch (_) {}
  const target = id || 'adaptive-swarm';
  return DEFAULT_TOPOLOGIES.find(t => t.id === target) || DEFAULT_TOPOLOGIES[0];
}

function listTopologies() {
  try {
    if (!hiveEngine) hiveEngine = require('./lib/hive-engine');
    if (hiveEngine && typeof hiveEngine.listTopologies === 'function') {
      const res = hiveEngine.listTopologies();
      if (Array.isArray(res) && res.length > 0) return res;
    }
  } catch (_) {}
  return DEFAULT_TOPOLOGIES;
}

function evaluateSwarmIntelligence(projectId, options) {
  try {
    if (!hiveEngine) hiveEngine = require('./lib/hive-engine');
    if (hiveEngine && typeof hiveEngine.evaluateSwarmIntelligence === 'function') {
      return hiveEngine.evaluateSwarmIntelligence(projectId, options);
    }
  } catch (_) {}
  return {
    projectId: projectId || 'default',
    topology: (options && options.topology) || 'adaptive-swarm',
    recommendedAgent: 'developer',
    scores: Object.keys(canonicalAgents).map((name, idx) => ({
      agent: name,
      utility: Number((0.92 - idx * 0.04).toFixed(2)),
    })),
  };
}

function getContextMode() {
  try {
    if (!contextMode) contextMode = require('./lib/context-mode');
  } catch (_) {}
  return contextMode;
}

module.exports = {
  getPrompt,
  listAgents,
  agents,
  canonicalAgents,
  agentAliases,
  PROMPTS_DIR,
  getTopology,
  listTopologies,
  evaluateSwarmIntelligence,
  get contextMode() {
    return getContextMode();
  },
  get hiveEngine() {
    try {
      if (!hiveEngine) hiveEngine = require('./lib/hive-engine');
    } catch (_) {}
    return hiveEngine;
  },
};
