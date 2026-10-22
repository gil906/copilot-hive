'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const contextMode = require('./context-mode');

const HIVE_ROOT = path.resolve(__dirname, '..');

/**
 * 1. Complete 13+1 Agent Registry (AGENTS_CATALOG)
 */
const AGENTS_CATALOG = {
  dispatcher: {
    id: 'dispatcher',
    name: 'Orchestrator Hub',
    icon: '🧠',
    category: 'orchestrator',
    role: 'Central Event & Topology Router',
    color: '#a855f7',
    script: 'copilot-dispatcher.sh',
    promptFile: 'prompts/dispatcher.md',
    researchFile: null,
    inputs: ['.pipeline-status', 'ideas/agent_status.json', 'ideas/admin_ideas.json', 'ideas/context_knowledge_base.json'],
    outputs: ['.pipeline-status', 'next_agent_dispatch'],
    dependencies: [],
    coordinates: {
      'cyclic-pipeline': { x: 450, y: 260 },
      'star-hub': { x: 450, y: 260 },
      'dag-mesh': { x: 450, y: 210 },
      'adaptive-swarm': { x: 450, y: 260 },
      'self-healing-ring': { x: 450, y: 260 }
    },
    x: 450,
    y: 260
  },
  improve: {
    id: 'improve',
    name: 'Feature Engineer',
    icon: '🔧',
    category: 'pipeline',
    role: 'Full-Stack Feature & Bug Implementation',
    color: '#3b82f6',
    script: 'copilot-improve.sh',
    promptFile: 'prompts/developer.md',
    researchFile: 'implemented.log',
    inputs: ['ideas/admin_ideas.json', 'ideas/*_latest.md', 'ideas/compliance_checklist.json'],
    outputs: ['git_commits', 'ideas/implemented.log', 'changelogs/*.md'],
    dependencies: ['radical', 'architect-api', 'designer-web', 'designer-portal'],
    coordinates: {
      'cyclic-pipeline': { x: 180, y: 120 },
      'star-hub': { x: 720, y: 170 },
      'dag-mesh': { x: 450, y: 330 },
      'adaptive-swarm': { x: 260, y: 140 },
      'self-healing-ring': { x: 140, y: 140 }
    },
    x: 180,
    y: 120
  },
  deployer: {
    id: 'deployer',
    name: 'Release Engineer',
    icon: '🚀',
    category: 'pipeline',
    role: 'Zero-Downtime Container Build & Rollout',
    color: '#06b6d4',
    script: 'copilot-deployer.sh',
    promptFile: 'prompts/deployer.md',
    researchFile: null,
    inputs: ['git_commits', 'docker-compose.yml', '.pipeline-status'],
    outputs: ['running_containers', 'LAST_BUILD_ID', '.pipeline-status'],
    dependencies: ['improve'],
    coordinates: {
      'cyclic-pipeline': { x: 480, y: 90 },
      'star-hub': { x: 820, y: 260 },
      'dag-mesh': { x: 640, y: 150 },
      'adaptive-swarm': { x: 640, y: 140 },
      'self-healing-ring': { x: 660, y: 380 }
    },
    x: 480,
    y: 90
  },
  regressiontest: {
    id: 'regressiontest',
    name: 'QA Sentinel',
    icon: '🧪',
    category: 'verification',
    role: 'Parallel HTTP, JSON & Container Verification',
    color: '#10b981',
    script: 'copilot-regressiontest.sh',
    promptFile: 'prompts/regressiontest.md',
    researchFile: null,
    inputs: ['running_containers', 'HEALTH_URL', 'VERSION_URL'],
    outputs: ['DEPLOY_VERIFIED', 'qa_telemetry'],
    dependencies: ['deployer'],
    coordinates: {
      'cyclic-pipeline': { x: 760, y: 160 },
      'star-hub': { x: 820, y: 380 },
      'dag-mesh': { x: 640, y: 270 },
      'adaptive-swarm': { x: 760, y: 260 },
      'self-healing-ring': { x: 450, y: 70 }
    },
    x: 760,
    y: 160
  },
  audit: {
    id: 'audit',
    name: 'Code & Security Auditor',
    icon: '🔍',
    category: 'verification',
    role: 'OWASP, Logic, Performance & Dead-Code Audit',
    color: '#f59e0b',
    script: 'copilot-audit.sh',
    promptFile: 'prompts/auditor.md',
    researchFile: 'audit_latest.md',
    inputs: ['git_diff', 'ideas/compliance_checklist.json', 'running_containers'],
    outputs: ['audit_fixes', 'ideas/audit_latest.md', '.pipeline-status'],
    dependencies: ['regressiontest'],
    coordinates: {
      'cyclic-pipeline': { x: 720, y: 390 },
      'star-hub': { x: 720, y: 350 },
      'dag-mesh': { x: 640, y: 390 },
      'adaptive-swarm': { x: 660, y: 390 },
      'self-healing-ring': { x: 720, y: 160 }
    },
    x: 720,
    y: 390
  },
  gitguardian: {
    id: 'gitguardian',
    name: 'Secret & Repo Guardian',
    icon: '🛡️',
    category: 'security',
    role: 'Credential Leak, Conflict & Git Hygiene Scanner',
    color: '#ef4444',
    script: 'copilot-gitguardian.sh',
    promptFile: 'prompts/gitguardian.md',
    researchFile: 'gitguardian_latest.md',
    inputs: ['git_history', 'working_tree', '.gitignore'],
    outputs: ['sanitized_repo', 'security_report'],
    dependencies: ['audit', 'deployer'],
    coordinates: {
      'cyclic-pipeline': { x: 240, y: 400 },
      'star-hub': { x: 580, y: 430 },
      'dag-mesh': { x: 270, y: 390 },
      'adaptive-swarm': { x: 240, y: 390 },
      'self-healing-ring': { x: 750, y: 290 }
    },
    x: 240,
    y: 400
  },
  emergencyfixer: {
    id: 'emergencyfixer',
    name: 'Incident Responder',
    icon: '🚑',
    category: 'emergency',
    role: 'Autonomous Outage Triage, Self-Healing & Rollback',
    color: '#dc2626',
    script: 'copilot-emergencyfixer.sh',
    promptFile: 'prompts/emergency-fixer.md',
    researchFile: null,
    inputs: ['.alert-context.json', 'container_logs', '.pipeline-status'],
    outputs: ['hotfix_commit', 'service_recovery', '.pipeline-status'],
    dependencies: ['regressiontest', 'deployer'],
    coordinates: {
      'cyclic-pipeline': { x: 840, y: 280 },
      'star-hub': { x: 450, y: 460 },
      'dag-mesh': { x: 820, y: 380 },
      'adaptive-swarm': { x: 450, y: 90 },
      'self-healing-ring': { x: 450, y: 450 }
    },
    x: 840,
    y: 280
  },
  radical: {
    id: 'radical',
    name: 'Radical Visionary',
    icon: '🔥',
    category: 'research',
    role: 'Competitor Intelligence & 10x Feature Ideation',
    color: '#f97316',
    script: 'copilot-radical.sh',
    promptFile: 'prompts/radical-visionary.md',
    researchFile: 'radical_latest.md',
    inputs: ['COMPETITOR_SITES', 'PROJECT_CONTEXT', 'web_search'],
    outputs: ['ideas/radical_latest.md'],
    dependencies: [],
    coordinates: {
      'cyclic-pipeline': { x: 70, y: 190 },
      'star-hub': { x: 140, y: 90 },
      'dag-mesh': { x: 90, y: 90 },
      'adaptive-swarm': { x: 120, y: 170 },
      'self-healing-ring': { x: 90, y: 240 }
    },
    x: 90,
    y: 90
  },
  'architect-api': {
    id: 'architect-api',
    name: 'Systems & API Architect',
    icon: '⚙️',
    category: 'research',
    role: 'Backend Scalability, Caching & API Design',
    color: '#0ea5e9',
    script: 'copilot-architect-api.sh',
    promptFile: 'prompts/api-architect.md',
    researchFile: 'api_architect_latest.md',
    inputs: ['api_routes', 'database_schema', 'performance_metrics'],
    outputs: ['ideas/api_architect_latest.md'],
    dependencies: [],
    coordinates: {
      'cyclic-pipeline': { x: 70, y: 260 },
      'star-hub': { x: 110, y: 180 },
      'dag-mesh': { x: 90, y: 190 },
      'adaptive-swarm': { x: 120, y: 260 },
      'self-healing-ring': { x: 90, y: 320 }
    },
    x: 90,
    y: 190
  },
  'designer-web': {
    id: 'designer-web',
    name: 'Web UI/UX Designer',
    icon: '🎨',
    category: 'research',
    role: 'Landing Page, Motion & Conversion Design',
    color: '#ec4899',
    script: 'copilot-designer-web.sh',
    promptFile: 'prompts/website-designer.md',
    researchFile: 'website_designer_latest.md',
    inputs: ['public_pages', 'css_tokens', 'lighthouse_metrics'],
    outputs: ['ideas/website_designer_latest.md'],
    dependencies: [],
    coordinates: {
      'cyclic-pipeline': { x: 70, y: 330 },
      'star-hub': { x: 110, y: 280 },
      'dag-mesh': { x: 90, y: 290 },
      'adaptive-swarm': { x: 140, y: 350 },
      'self-healing-ring': { x: 90, y: 400 }
    },
    x: 90,
    y: 290
  },
  'designer-portal': {
    id: 'designer-portal',
    name: 'Portal & Dashboard Designer',
    icon: '🖥️',
    category: 'research',
    role: 'App Ergonomics, Workflows & Data Visualization',
    color: '#8b5cf6',
    script: 'copilot-designer-portal.sh',
    promptFile: 'prompts/portal-designer.md',
    researchFile: 'portal_designer_latest.md',
    inputs: ['dashboard_views', 'component_tree', 'user_flows'],
    outputs: ['ideas/portal_designer_latest.md'],
    dependencies: [],
    coordinates: {
      'cyclic-pipeline': { x: 70, y: 400 },
      'star-hub': { x: 140, y: 370 },
      'dag-mesh': { x: 90, y: 390 },
      'adaptive-swarm': { x: 320, y: 440 },
      'self-healing-ring': { x: 180, y: 440 }
    },
    x: 90,
    y: 390
  },
  lawyer: {
    id: 'lawyer',
    name: 'Legal & IP Counsel',
    icon: '⚖️',
    category: 'governance',
    role: 'Terms, Privacy, Licensing & Liability Analysis',
    color: '#eab308',
    script: 'copilot-lawyer.sh',
    promptFile: 'prompts/lawyer.md',
    researchFile: 'lawyer_latest.md',
    inputs: ['LEGAL_SITES', 'license_manifest', 'privacy_policy'],
    outputs: ['ideas/lawyer_latest.md'],
    dependencies: [],
    coordinates: {
      'cyclic-pipeline': { x: 160, y: 460 },
      'star-hub': { x: 220, y: 440 },
      'dag-mesh': { x: 270, y: 150 },
      'adaptive-swarm': { x: 560, y: 440 },
      'self-healing-ring': { x: 240, y: 200 }
    },
    x: 270,
    y: 150
  },
  compliance: {
    id: 'compliance',
    name: 'Compliance Officer',
    icon: '📋',
    category: 'governance',
    role: 'SOC2, GDPR, HIPAA & ISO27001 Controls',
    color: '#14b8a6',
    script: 'copilot-compliance.sh',
    promptFile: 'prompts/compliance.md',
    researchFile: 'compliance_checklist.json',
    inputs: ['ideas/compliance_checklist.json', 'security_headers', 'auth_controls'],
    outputs: ['ideas/compliance_checklist.json'],
    dependencies: ['lawyer'],
    coordinates: {
      'cyclic-pipeline': { x: 340, y: 460 },
      'star-hub': { x: 240, y: 60 },
      'dag-mesh': { x: 270, y: 270 },
      'adaptive-swarm': { x: 780, y: 170 },
      'self-healing-ring': { x: 240, y: 340 }
    },
    x: 270,
    y: 270
  },
  reporter: {
    id: 'reporter',
    name: 'Executive Reporter',
    icon: '📊',
    category: 'telemetry',
    role: 'Daily/Weekly Digest & Velocity Telemetry',
    color: '#6366f1',
    script: 'copilot-reporter.sh',
    promptFile: 'prompts/reporter.md',
    researchFile: null,
    inputs: ['changelogs/*.md', 'ideas/agent_status.json', 'ideas/implemented.log'],
    outputs: ['executive_digest', 'telemetry_metrics'],
    dependencies: ['audit', 'deployer'],
    coordinates: {
      'cyclic-pipeline': { x: 540, y: 460 },
      'star-hub': { x: 820, y: 120 },
      'dag-mesh': { x: 820, y: 230 },
      'adaptive-swarm': { x: 800, y: 360 },
      'self-healing-ring': { x: 220, y: 290 }
    },
    x: 820,
    y: 230
  }
};

/**
 * Helper to materialize topology-specific node array with coordinates and roles.
 */
function buildTopologyNodes(topologyId, stageMap = {}) {
  return Object.values(AGENTS_CATALOG).map(agent => {
    const coords = (agent.coordinates && agent.coordinates[topologyId]) || { x: agent.x, y: agent.y };
    return {
      id: agent.id,
      name: agent.name,
      icon: agent.icon,
      category: agent.category,
      role: agent.role,
      color: agent.color,
      script: agent.script,
      x: coords.x,
      y: coords.y,
      stage: stageMap[agent.id] || 1,
      inputs: agent.inputs,
      outputs: agent.outputs,
      dependencies: agent.dependencies
    };
  });
}

/**
 * Helper to create a selection result that works both as a structured object and string primitive.
 */
function makeSelectionResult({ agent, cohort = [], reason = '', topology = 'adaptive-swarm', stage = null }) {
  const result = {
    agent,
    nextAgent: agent,
    cohort: cohort.length > 0 ? cohort : [agent],
    reason,
    topology,
    stage,
    valueOf() { return this.agent; },
    toString() { return this.agent; }
  };
  return result;
}

/**
 * 2. Five Orchestration Topologies (TOPOLOGIES)
 */
const TOPOLOGIES = {
  'cyclic-pipeline': {
    id: 'cyclic-pipeline',
    name: 'Cyclic Delivery Pipeline',
    tagline: 'Continuous deterministic build-deploy-verify-audit-guard loop',
    description: 'Classic continuous delivery loop (improve → deployer → regressiontest → audit → deployer → gitguardian → improve) with autonomous emergencyfixer escalation on verification failure.',
    algorithm: 'Deterministic Finite State Machine (FSM) with Emergency Interrupt Branch',
    nodes: buildTopologyNodes('cyclic-pipeline', {
      improve: 1,
      deployer: 2,
      regressiontest: 3,
      audit: 4,
      gitguardian: 5,
      emergencyfixer: 3,
      dispatcher: 0,
      radical: 1,
      'architect-api': 1,
      'designer-web': 1,
      'designer-portal': 1,
      lawyer: 4,
      compliance: 4,
      reporter: 5
    }),
    edges: [
      { from: 'improve', to: 'deployer', type: 'primary', label: 'commit & build', animated: true },
      { from: 'deployer', to: 'regressiontest', type: 'primary', label: 'verify rollout', animated: true },
      { from: 'regressiontest', to: 'audit', type: 'primary', label: 'QA passed', animated: true },
      { from: 'audit', to: 'deployer', type: 'primary', label: 'redeploy fixes', animated: true },
      { from: 'deployer', to: 'gitguardian', type: 'primary', label: 'post-deploy scan', animated: true },
      { from: 'gitguardian', to: 'improve', type: 'feedback', label: 'next cycle', animated: true },
      { from: 'regressiontest', to: 'emergencyfixer', type: 'escalation', label: 'health failure', animated: true },
      { from: 'deployer', to: 'emergencyfixer', type: 'escalation', label: 'build crash', animated: true },
      { from: 'emergencyfixer', to: 'deployer', type: 'feedback', label: 'hotfix recovery', animated: true },
      { from: 'radical', to: 'improve', type: 'knowledge', label: '10x ideas', animated: true },
      { from: 'architect-api', to: 'improve', type: 'knowledge', label: 'API specs', animated: true },
      { from: 'designer-web', to: 'improve', type: 'knowledge', label: 'UI specs', animated: true },
      { from: 'designer-portal', to: 'improve', type: 'knowledge', label: 'UX specs', animated: true },
      { from: 'compliance', to: 'audit', type: 'knowledge', label: 'controls', animated: true },
      { from: 'lawyer', to: 'audit', type: 'knowledge', label: 'legal policy', animated: true },
      { from: 'gitguardian', to: 'reporter', type: 'knowledge', label: 'cycle digest', animated: true }
    ],
    selectNextAgent(state = {}, scores = {}) {
      if (state.alertActive || state.pipelineState === 'broken' || state.deployVerified === 'no') {
        return makeSelectionResult({
          agent: 'emergencyfixer',
          cohort: ['emergencyfixer'],
          reason: 'Escalation branch triggered by broken pipeline or failed verification',
          topology: 'cyclic-pipeline'
        });
      }
      const order = ['improve', 'deployer', 'regressiontest', 'audit', 'gitguardian'];
      const last = state.lastAgent || '';
      if (last === 'audit' && state.needsRedeploy) {
        return makeSelectionResult({
          agent: 'deployer',
          cohort: ['deployer'],
          reason: 'Audit produced fixes requiring container redeploy',
          topology: 'cyclic-pipeline'
        });
      }
      const idx = order.indexOf(last);
      const next = idx >= 0 ? order[(idx + 1) % order.length] : (state.nextAgent || 'improve');
      return makeSelectionResult({
        agent: next,
        cohort: [next],
        reason: `Cyclic pipeline transition after ${last || 'initial state'} → ${next}`,
        topology: 'cyclic-pipeline'
      });
    }
  },

  'star-hub': {
    id: 'star-hub',
    name: 'Star Hub & Parallel Research Fan-Out',
    tagline: 'Central dispatcher hub radiating to 6 research/governance agents into Context-Mode KB',
    description: 'Central dispatcher hub radiates out to all 6 research & governance specialists in parallel (radical, architect-api, designer-web, designer-portal, lawyer, compliance), aggregates findings into Context-Mode KB, then dispatches improve → deployer → audit.',
    algorithm: 'Hub-and-Spoke MapReduce via Context-Mode Hybrid Knowledge Base',
    nodes: buildTopologyNodes('star-hub', {
      dispatcher: 1,
      radical: 2,
      'architect-api': 2,
      'designer-web': 2,
      'designer-portal': 2,
      lawyer: 2,
      compliance: 2,
      improve: 3,
      deployer: 4,
      audit: 5,
      regressiontest: 4,
      gitguardian: 5,
      emergencyfixer: 4,
      reporter: 5
    }),
    edges: [
      { from: 'dispatcher', to: 'radical', type: 'primary', label: 'fan-out research', animated: true },
      { from: 'dispatcher', to: 'architect-api', type: 'primary', label: 'fan-out architecture', animated: true },
      { from: 'dispatcher', to: 'designer-web', type: 'primary', label: 'fan-out web UI', animated: true },
      { from: 'dispatcher', to: 'designer-portal', type: 'primary', label: 'fan-out portal UX', animated: true },
      { from: 'dispatcher', to: 'lawyer', type: 'primary', label: 'fan-out legal', animated: true },
      { from: 'dispatcher', to: 'compliance', type: 'primary', label: 'fan-out compliance', animated: true },
      { from: 'radical', to: 'dispatcher', type: 'knowledge', label: 'index KB', animated: true },
      { from: 'architect-api', to: 'dispatcher', type: 'knowledge', label: 'index KB', animated: true },
      { from: 'designer-web', to: 'dispatcher', type: 'knowledge', label: 'index KB', animated: true },
      { from: 'designer-portal', to: 'dispatcher', type: 'knowledge', label: 'index KB', animated: true },
      { from: 'lawyer', to: 'dispatcher', type: 'knowledge', label: 'index KB', animated: true },
      { from: 'compliance', to: 'dispatcher', type: 'knowledge', label: 'index KB', animated: true },
      { from: 'dispatcher', to: 'improve', type: 'primary', label: 'synthesized spec', animated: true },
      { from: 'improve', to: 'deployer', type: 'primary', label: 'rollout', animated: true },
      { from: 'deployer', to: 'audit', type: 'primary', label: 'verify & audit', animated: true },
      { from: 'audit', to: 'dispatcher', type: 'feedback', label: 'audit telemetry', animated: true },
      { from: 'deployer', to: 'regressiontest', type: 'primary', label: 'smoke test', animated: true },
      { from: 'audit', to: 'gitguardian', type: 'primary', label: 'secret scan', animated: true },
      { from: 'dispatcher', to: 'emergencyfixer', type: 'escalation', label: 'incident', animated: true },
      { from: 'dispatcher', to: 'reporter', type: 'knowledge', label: 'hub summary', animated: true }
    ],
    selectNextAgent(state = {}, scores = {}) {
      if (state.alertActive || state.pipelineState === 'broken') {
        return makeSelectionResult({
          agent: 'emergencyfixer',
          cohort: ['emergencyfixer'],
          reason: 'Star-Hub emergency interrupt activated',
          topology: 'star-hub'
        });
      }
      const researchSpokes = ['radical', 'architect-api', 'designer-web', 'designer-portal', 'lawyer', 'compliance'];
      const staleSpokes = researchSpokes.filter(a => (scores[a]?.score || 0) >= 70);
      if (staleSpokes.length > 0 && state.lastAgent !== 'improve' && state.lastAgent !== 'deployer') {
        staleSpokes.sort((a, b) => (scores[b]?.score || 0) - (scores[a]?.score || 0));
        return makeSelectionResult({
          agent: staleSpokes[0],
          cohort: staleSpokes.slice(0, 3),
          reason: `Star-Hub parallel research fan-out to refresh KB (${staleSpokes.join(', ')})`,
          topology: 'star-hub'
        });
      }
      const execChain = ['improve', 'deployer', 'audit'];
      const idx = execChain.indexOf(state.lastAgent);
      const next = idx >= 0 && idx < execChain.length - 1 ? execChain[idx + 1] : 'improve';
      return makeSelectionResult({
        agent: next,
        cohort: [next],
        reason: `Star-Hub aggregated KB ready → dispatching ${next}`,
        topology: 'star-hub'
      });
    }
  },

  'dag-mesh': {
    id: 'dag-mesh',
    name: '5-Stage Directed Acyclic Graph (DAG Mesh)',
    tagline: 'Topological stage barrier across Discovery → Policy → Build → Verification → Digest',
    description: '5-stage Directed Acyclic Graph: Stage 1 Discovery (radical, architect-api, designer-web, designer-portal) → Stage 2 Policy & Security (lawyer, compliance, gitguardian) → Stage 3 Synthesis & Build (dispatcher, improve) → Stage 4 Verification (deployer, regressiontest, audit) → Stage 5 Digest (reporter), with emergencyfixer watching Stage 4.',
    algorithm: 'Kahn Topological Sort & Stage Barrier Synchronization',
    nodes: buildTopologyNodes('dag-mesh', {
      radical: 1,
      'architect-api': 1,
      'designer-web': 1,
      'designer-portal': 1,
      lawyer: 2,
      compliance: 2,
      gitguardian: 2,
      dispatcher: 3,
      improve: 3,
      deployer: 4,
      regressiontest: 4,
      audit: 4,
      emergencyfixer: 4,
      reporter: 5
    }),
    edges: [
      // Stage 1 -> Stage 2 & 3
      { from: 'radical', to: 'lawyer', type: 'knowledge', label: 'feature review', animated: true },
      { from: 'architect-api', to: 'compliance', type: 'knowledge', label: 'API controls', animated: true },
      { from: 'designer-web', to: 'dispatcher', type: 'knowledge', label: 'UI specs', animated: true },
      { from: 'designer-portal', to: 'dispatcher', type: 'knowledge', label: 'portal specs', animated: true },
      // Stage 2 -> Stage 3
      { from: 'lawyer', to: 'dispatcher', type: 'primary', label: 'legal gate', animated: true },
      { from: 'compliance', to: 'dispatcher', type: 'primary', label: 'SOC2/OWASP gate', animated: true },
      { from: 'gitguardian', to: 'improve', type: 'primary', label: 'clean tree gate', animated: true },
      // Stage 3 -> Stage 4
      { from: 'dispatcher', to: 'improve', type: 'primary', label: 'prioritized DAG spec', animated: true },
      { from: 'improve', to: 'deployer', type: 'primary', label: 'stage 4 build', animated: true },
      // Stage 4 internal & escalation
      { from: 'deployer', to: 'regressiontest', type: 'primary', label: 'live endpoints', animated: true },
      { from: 'regressiontest', to: 'audit', type: 'primary', label: 'deep audit', animated: true },
      { from: 'deployer', to: 'emergencyfixer', type: 'escalation', label: 'stage 4 fault', animated: true },
      { from: 'regressiontest', to: 'emergencyfixer', type: 'escalation', label: 'QA fault', animated: true },
      { from: 'emergencyfixer', to: 'deployer', type: 'feedback', label: 'self-heal', animated: true },
      // Stage 4 -> Stage 5
      { from: 'audit', to: 'reporter', type: 'primary', label: 'stage 5 digest', animated: true },
      { from: 'regressiontest', to: 'reporter', type: 'knowledge', label: 'QA metrics', animated: true }
    ],
    selectNextAgent(state = {}, scores = {}) {
      if (state.alertActive || state.pipelineState === 'broken') {
        return makeSelectionResult({
          agent: 'emergencyfixer',
          cohort: ['emergencyfixer'],
          reason: 'Stage 4 fault watcher triggered emergencyfixer',
          topology: 'dag-mesh',
          stage: 4
        });
      }
      const stages = [
        { stage: 1, name: 'Discovery', agents: ['radical', 'architect-api', 'designer-web', 'designer-portal'] },
        { stage: 2, name: 'Policy & Security', agents: ['lawyer', 'compliance', 'gitguardian'] },
        { stage: 3, name: 'Synthesis & Build', agents: ['dispatcher', 'improve'] },
        { stage: 4, name: 'Verification', agents: ['deployer', 'regressiontest', 'audit'] },
        { stage: 5, name: 'Digest', agents: ['reporter'] }
      ];

      // If urgent idea or high-utility stage exists, pick highest-scoring stage/agent
      let bestStage = stages[2];
      let bestAgent = 'improve';
      let bestScore = -1;

      for (const s of stages) {
        for (const a of s.agents) {
          const sc = scores[a]?.score ?? 50;
          if (sc > bestScore) {
            bestScore = sc;
            bestAgent = a;
            bestStage = s;
          }
        }
      }

      return makeSelectionResult({
        agent: bestAgent === 'dispatcher' ? 'improve' : bestAgent,
        cohort: bestStage.agents,
        reason: `DAG Stage ${bestStage.stage} (${bestStage.name}) ready → ${bestAgent} (U=${bestScore})`,
        topology: 'dag-mesh',
        stage: bestStage.stage
      });
    }
  },

  'adaptive-swarm': {
    id: 'adaptive-swarm',
    name: 'Adaptive Utility-Scored Swarm',
    tagline: 'Real-time multi-factor utility function U(agent) ∈ [0, 100] with ICE idea ranking',
    description: 'Dynamic Multi-Factor Utility Scoring Swarm where the orchestrator computes real-time utility scores U(agent) (0–100) from alert urgency, admin ideas, research staleness, git velocity, and exit telemetry, dispatching the highest-scoring agent cohort.',
    algorithm: 'Multi-Factor Utility Maximization U(a) = w_u·Urgency + w_s·Staleness + w_d·CommitDelta + w_r·Recovery',
    nodes: buildTopologyNodes('adaptive-swarm', {
      dispatcher: 1,
      emergencyfixer: 1,
      improve: 2,
      deployer: 2,
      regressiontest: 2,
      audit: 2,
      gitguardian: 2,
      radical: 3,
      'architect-api': 3,
      'designer-web': 3,
      'designer-portal': 3,
      lawyer: 3,
      compliance: 3,
      reporter: 3
    }),
    edges: [
      { from: 'dispatcher', to: 'emergencyfixer', type: 'escalation', label: 'U(fix)=99', animated: true },
      { from: 'dispatcher', to: 'improve', type: 'primary', label: 'U(improve)', animated: true },
      { from: 'dispatcher', to: 'deployer', type: 'primary', label: 'U(deploy)', animated: true },
      { from: 'dispatcher', to: 'regressiontest', type: 'primary', label: 'U(qa)', animated: true },
      { from: 'dispatcher', to: 'audit', type: 'primary', label: 'U(audit)', animated: true },
      { from: 'dispatcher', to: 'gitguardian', type: 'primary', label: 'U(guard)', animated: true },
      { from: 'dispatcher', to: 'radical', type: 'knowledge', label: 'U(radical)', animated: true },
      { from: 'dispatcher', to: 'architect-api', type: 'knowledge', label: 'U(arch)', animated: true },
      { from: 'dispatcher', to: 'designer-web', type: 'knowledge', label: 'U(web)', animated: true },
      { from: 'dispatcher', to: 'designer-portal', type: 'knowledge', label: 'U(portal)', animated: true },
      { from: 'dispatcher', to: 'lawyer', type: 'knowledge', label: 'U(legal)', animated: true },
      { from: 'dispatcher', to: 'compliance', type: 'knowledge', label: 'U(soc2)', animated: true },
      { from: 'dispatcher', to: 'reporter', type: 'knowledge', label: 'U(report)', animated: true },
      { from: 'improve', to: 'deployer', type: 'feedback', label: 'commit delta boost', animated: true },
      { from: 'deployer', to: 'regressiontest', type: 'feedback', label: 'rollout verify boost', animated: true }
    ],
    selectNextAgent(state = {}, scores = {}) {
      const entries = Object.entries(scores)
        .filter(([id]) => id !== 'dispatcher')
        .map(([id, obj]) => ({
          id,
          score: typeof obj === 'number' ? obj : (obj?.score ?? 0),
          reason: obj?.reason || 'Utility evaluated'
        }))
        .sort((a, b) => b.score - a.score);

      if (entries.length === 0) {
        return makeSelectionResult({
          agent: 'improve',
          cohort: ['improve'],
          reason: 'Default adaptive fallback to improve',
          topology: 'adaptive-swarm'
        });
      }

      const winner = entries[0];
      const cohort = entries.slice(0, 3).map(e => e.id);
      return makeSelectionResult({
        agent: winner.id,
        cohort,
        reason: `Highest utility score U(${winner.id})=${winner.score}: ${winner.reason}`,
        topology: 'adaptive-swarm'
      });
    }
  },

  'self-healing-ring': {
    id: 'self-healing-ring',
    name: 'Self-Healing High-Availability Ring',
    tagline: 'Zero-regression token ring focused on uptime, security, and autonomous recovery',
    description: 'High-availability production ring (regressiontest → audit → gitguardian → emergencyfixer → deployer → reporter) focused on continuous endpoint verification, secret hygiene, and autonomous rollback/healing.',
    algorithm: 'Fault-Tolerant Token Ring with Preemptive Self-Healing Bypass',
    nodes: buildTopologyNodes('self-healing-ring', {
      regressiontest: 1,
      audit: 2,
      gitguardian: 3,
      emergencyfixer: 4,
      deployer: 5,
      reporter: 6,
      dispatcher: 1,
      improve: 2,
      radical: 3,
      'architect-api': 3,
      'designer-web': 3,
      'designer-portal': 3,
      lawyer: 2,
      compliance: 2
    }),
    edges: [
      { from: 'regressiontest', to: 'audit', type: 'primary', label: 'ring token 1→2', animated: true },
      { from: 'audit', to: 'gitguardian', type: 'primary', label: 'ring token 2→3', animated: true },
      { from: 'gitguardian', to: 'emergencyfixer', type: 'primary', label: 'ring token 3→4', animated: true },
      { from: 'emergencyfixer', to: 'deployer', type: 'primary', label: 'ring token 4→5', animated: true },
      { from: 'deployer', to: 'reporter', type: 'primary', label: 'ring token 5→6', animated: true },
      { from: 'reporter', to: 'regressiontest', type: 'feedback', label: 'close HA ring', animated: true },
      { from: 'regressiontest', to: 'emergencyfixer', type: 'escalation', label: 'fast-path heal', animated: true },
      { from: 'compliance', to: 'audit', type: 'knowledge', label: 'SOC2 checks', animated: true },
      { from: 'improve', to: 'deployer', type: 'knowledge', label: 'queued patch', animated: true }
    ],
    selectNextAgent(state = {}, scores = {}) {
      if (state.alertActive || state.pipelineState === 'broken' || state.deployVerified === 'no') {
        return makeSelectionResult({
          agent: 'emergencyfixer',
          cohort: ['emergencyfixer', 'deployer', 'regressiontest'],
          reason: 'Self-Healing Ring fast-path triggered by health/verification alert',
          topology: 'self-healing-ring'
        });
      }
      const ring = ['regressiontest', 'audit', 'gitguardian', 'emergencyfixer', 'deployer', 'reporter'];
      const last = state.lastAgent || '';
      const idx = ring.indexOf(last);
      let next = idx >= 0 ? ring[(idx + 1) % ring.length] : 'regressiontest';
      // Skip emergencyfixer in nominal ring rotation if health is 100% clean
      if (next === 'emergencyfixer' && (scores.emergencyfixer?.score || 0) < 50) {
        next = 'deployer';
      }
      return makeSelectionResult({
        agent: next,
        cohort: [next, ring[(ring.indexOf(next) + 1) % ring.length]],
        reason: `Self-Healing Ring token rotation (${last || 'start'} → ${next})`,
        topology: 'self-healing-ring'
      });
    }
  }
};

/**
 * Parse key=value .pipeline-status file.
 */
function parsePipelineStatus(ideasDir) {
  const projectRoot = path.dirname(ideasDir);
  const candidates = [
    path.join(projectRoot, '.pipeline-status'),
    path.join(HIVE_ROOT, '.pipeline-status'),
    path.join(HIVE_ROOT, '.pipeline-status.example')
  ];

  const rawMap = {};
  let foundPath = null;
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      foundPath = p;
      const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq > 0) {
          const k = trimmed.slice(0, eq).trim();
          const v = trimmed.slice(eq + 1).trim();
          rawMap[k] = v;
        }
      }
      break;
    }
  }

  return {
    sourcePath: foundPath,
    pipelineState: (rawMap.PIPELINE_STATE || 'idle').toLowerCase(),
    currentAgent: rawMap.CURRENT_AGENT || '',
    lastAgent: rawMap.LAST_AGENT || '',
    lastFinished: Number(rawMap.LAST_FINISHED || 0),
    lastCommit: rawMap.LAST_COMMIT || '',
    lastBuildId: rawMap.LAST_BUILD_ID || '',
    deployVerified: (rawMap.DEPLOY_VERIFIED || 'yes').toLowerCase(),
    nextAgent: rawMap.NEXT_AGENT || 'improve',
    fixResponsibility: rawMap.FIX_RESPONSIBILITY || '',
    fixRetries: Number(rawMap.FIX_RETRIES || 0),
    raw: rawMap
  };
}

/**
 * Compute ICE Score (Impact * Confidence * Ease) for an idea item.
 */
function scoreIdeaICE(idea) {
  const text = `${idea.title || ''} ${idea.description || ''}`.toLowerCase();
  let impact = Number(idea.impact) || 7;
  let confidence = Number(idea.confidence) || 7;
  let ease = Number(idea.ease) || 7;

  if (idea.urgent) {
    impact = Math.max(impact, 9.5);
    confidence = Math.max(confidence, 9.0);
    ease = Math.max(ease, 8.0);
  }
  if (/security|auth|vulnerability|crash|outage|critical|owasp|soc2|fix|performance/.test(text)) {
    impact = Math.min(10, impact + 1.5);
  }
  if (/api|cache|index|search|dashboard|topology|swarm|context-mode|ui|ux/.test(text)) {
    impact = Math.min(10, impact + 1.0);
    confidence = Math.min(10, confidence + 0.8);
  }
  if (/toggle|css|button|badge|tooltip|markdown|config|header/.test(text)) {
    ease = Math.min(10, ease + 1.2);
  }

  const rawIce = Number((impact * confidence * ease).toFixed(1)); // 1..1000
  const normalizedScore = Number(Math.min(100, (rawIce / 10)).toFixed(1)); // 0..100

  return {
    id: idea.id || `idea-${Math.random().toString(36).slice(2, 8)}`,
    title: idea.title || 'Untitled Idea',
    description: idea.description || '',
    source: idea.source || 'admin_ideas.json',
    urgent: Boolean(idea.urgent),
    status: idea.status || 'pending',
    impact: Number(impact.toFixed(1)),
    confidence: Number(confidence.toFixed(1)),
    ease: Number(ease.toFixed(1)),
    iceScore: normalizedScore,
    rawIce
  };
}

/**
 * Load and rank ideas from admin_ideas.json + markdown research files using ICE heuristic.
 */
function loadAndRankIdeas(ideasDir) {
  const ideas = [];
  const adminCandidates = [
    path.join(ideasDir, 'admin_ideas.json'),
    path.join(ideasDir, 'admin_ideas.example.json')
  ];

  for (const candidate of adminCandidates) {
    if (fs.existsSync(candidate)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'));
        if (parsed && Array.isArray(parsed.ideas)) {
          for (const item of parsed.ideas) {
            if (!item.status || item.status === 'pending' || item.status === 'in_progress') {
              ideas.push(scoreIdeaICE(Object.assign({}, item, { source: path.basename(candidate) })));
            }
          }
        }
        break;
      } catch (_) {}
    }
  }

  // Also extract ideas from *_latest.md research files if present
  const researchFiles = [
    'radical_latest.md',
    'api_architect_latest.md',
    'website_designer_latest.md',
    'portal_designer_latest.md',
    'lawyer_latest.md'
  ];

  for (const rf of researchFiles) {
    const fullPath = path.join(ideasDir, rf);
    if (!fs.existsSync(fullPath)) continue;
    try {
      const content = fs.readFileSync(fullPath, 'utf8');
      const headings = content.match(/^#{2,3}\s+(.+)$/gm) || [];
      headings.slice(0, 5).forEach((h, idx) => {
        const title = h.replace(/^#{2,3}\s+/, '').trim();
        if (title.length > 4) {
          ideas.push(scoreIdeaICE({
            id: `${rf.replace('_latest.md', '')}-${idx + 1}`,
            title,
            description: `Extracted from ${rf}`,
            source: rf,
            urgent: false,
            status: 'pending'
          }));
        }
      });
    } catch (_) {}
  }

  // Also check compliance_checklist.json for missing/partial high-priority controls
  const compliancePath = path.join(ideasDir, 'compliance_checklist.json');
  if (fs.existsSync(compliancePath)) {
    try {
      const comp = JSON.parse(fs.readFileSync(compliancePath, 'utf8'));
      if (comp && Array.isArray(comp.standards)) {
        for (const std of comp.standards) {
          for (const item of (std.items || [])) {
            if (item.status !== 'implemented' && item.what_we_need) {
              ideas.push(scoreIdeaICE({
                id: `compliance-${item.id}`,
                title: `${std.name}: ${item.name}`,
                description: item.what_we_need,
                source: 'compliance_checklist.json',
                urgent: item.priority === 'critical',
                impact: item.priority === 'high' ? 8.5 : 7.0,
                confidence: 8.5,
                ease: 7.0,
                status: 'pending'
              }));
            }
          }
        }
      }
    } catch (_) {}
  }

  ideas.sort((a, b) => {
    if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
    return b.iceScore - a.iceScore;
  });

  return ideas;
}

/**
 * Count recent git commits to gauge repository velocity.
 */
function getRecentCommitCount(projectRoot) {
  try {
    const proc = spawnSync('git', ['--no-pager', ' rev-list', '--count', 'HEAD~15..HEAD'], {
      cwd: projectRoot,
      encoding: 'utf8',
      timeout: 3000
    });
    if (proc.status === 0 && proc.stdout) {
      return parseInt(proc.stdout.trim(), 10) || 1;
    }
    const logProc = spawnSync('git', ['--no-pager', 'log', '--oneline', '-n', '20'], {
      cwd: projectRoot,
      encoding: 'utf8',
      timeout: 3000
    });
    if (logProc.status === 0 && logProc.stdout) {
      return logProc.stdout.trim().split('\n').filter(Boolean).length;
    }
  } catch (_) {}
  return 1;
}

/**
 * 3. Smart Agent Utility Scoring & Priority Queue (evaluateSwarmIntelligence)
 */
function evaluateSwarmIntelligence(projectId, options = {}) {
  const ideasDir = contextMode.resolveIdeasDir(projectId);
  const projectRoot = path.dirname(ideasDir);
  const requestedTopology = options.topology && TOPOLOGIES[options.topology]
    ? options.topology
    : null;

  // Ensure KB is synced so contextStats are live
  contextMode.syncProjectKnowledge(projectId);
  const contextStats = contextMode.getContextStats(projectId);

  const pipelineState = parsePipelineStatus(ideasDir);
  const prioritizedIdeas = loadAndRankIdeas(ideasDir);

  // Check active alerts (.alert-context.json)
  const alertCandidates = [
    path.join(projectRoot, '.alert-context.json'),
    path.join(ideasDir, '.alert-context.json'),
    path.join(HIVE_ROOT, '.alert-context.json')
  ];
  const alertFile = alertCandidates.find(p => fs.existsSync(p));
  const alertActive = Boolean(
    alertFile ||
    options.alertActive ||
    pipelineState.pipelineState === 'broken' ||
    pipelineState.pipelineState === 'failed' ||
    pipelineState.pipelineState === 'emergency' ||
    pipelineState.deployVerified === 'no' ||
    pipelineState.fixRetries > 0
  );

  // Load agent_status.json
  let agentStatusMap = {};
  const statusCandidates = [
    path.join(ideasDir, 'agent_status.json'),
    path.join(ideasDir, 'agent_status.example.json')
  ];
  for (const sc of statusCandidates) {
    if (fs.existsSync(sc)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(sc, 'utf8'));
        agentStatusMap = (parsed && parsed.agents) ? parsed.agents : {};
        break;
      } catch (_) {}
    }
  }

  const hasUrgentIdeas = Boolean(
    options.hasUrgentIdeas ||
    prioritizedIdeas.some(i => i.urgent && i.source.includes('admin_ideas'))
  );
  const pendingAdminIdeas = prioritizedIdeas.filter(i => i.source.includes('admin_ideas'));

  const commitDelta = getRecentCommitCount(projectRoot);
  const nowMs = Date.now();

  // Helper to check research file staleness in hours
  const getResearchAgeHours = (filename) => {
    if (!filename) return 0;
    const fp = path.join(ideasDir, filename);
    if (!fs.existsSync(fp)) return 999; // missing -> very stale
    try {
      const mtimeMs = fs.statSync(fp).mtimeMs;
      return Math.max(0, (nowMs - mtimeMs) / (1000 * 3600));
    } catch (_) {
      return 999;
    }
  };

  const agentScores = {};

  for (const agent of Object.values(AGENTS_CATALOG)) {
    let score = 45;
    const reasons = [];
    const statusInfo = agentStatusMap[agent.id] || {};

    if (agent.id === 'emergencyfixer') {
      if (alertActive) {
        score = 99;
        reasons.push('Active alert or broken deployment state detected');
      } else {
        score = 15;
        reasons.push('System healthy; standby mode');
      }
    } else if (agent.id === 'improve') {
      if (hasUrgentIdeas) {
        score = 98;
        reasons.push('Urgent admin idea queued for immediate implementation');
      } else if (pendingAdminIdeas.length > 0) {
        score = 86;
        reasons.push(`${pendingAdminIdeas.length} pending admin idea(s) ready`);
      } else if (prioritizedIdeas.length > 0) {
        score = 76;
        reasons.push(`${prioritizedIdeas.length} prioritized backlog items available`);
      }
    } else if (agent.id === 'deployer') {
      if (pipelineState.lastAgent === 'improve' || pipelineState.lastAgent === 'audit') {
        score = 89;
        reasons.push(`Unshipped changes from ${pipelineState.lastAgent} ready for rollout`);
      } else {
        score = Math.min(82, 50 + commitDelta * 2);
        reasons.push(`${commitDelta} recent commit(s) in repository`);
      }
    } else if (agent.id === 'regressiontest') {
      if (pipelineState.lastAgent === 'deployer' || pipelineState.deployVerified !== 'yes') {
        score = 92;
        reasons.push('Recent deployment requires QA endpoint & container verification');
      } else {
        score = Math.min(80, 52 + commitDelta * 1.5);
        reasons.push('Periodic endpoint & container verification');
      }
    } else if (agent.id === 'audit') {
      const age = getResearchAgeHours('audit_latest.md');
      if (pipelineState.lastAgent === 'regressiontest') {
        score = 88;
        reasons.push('Post-QA code & OWASP security audit due');
      } else if (age > 24) {
        score = Math.min(85, 65 + Math.round(commitDelta * 1.5));
        reasons.push(`Audit report missing/stale (${age > 500 ? 'missing' : Math.round(age) + 'h old'})`);
      } else {
        score = 60;
        reasons.push('Routine security & logic audit');
      }
    } else if (agent.id === 'gitguardian') {
      score = Math.min(84, 54 + commitDelta * 2);
      reasons.push(`Secret & git hygiene scan across ${commitDelta} recent commits`);
    } else if (agent.researchFile) {
      const age = getResearchAgeHours(agent.researchFile);
      if (age >= 999) {
        score = 79;
        reasons.push(`Research artifact ${agent.researchFile} missing (>24h stale boost)`);
      } else if (age > 24) {
        score = Math.min(85, 70 + Math.round((age - 24) / 4));
        reasons.push(`Research artifact ${agent.researchFile} is ${Math.round(age)}h old (>24h threshold)`);
      } else {
        score = 42;
        reasons.push(`Research artifact ${agent.researchFile} is fresh (${age.toFixed(1)}h old)`);
      }
    } else if (agent.id === 'reporter') {
      score = pipelineState.lastAgent === 'audit' || pipelineState.lastAgent === 'gitguardian' ? 74 : 48;
      reasons.push('Executive velocity & telemetry digest');
    } else if (agent.id === 'dispatcher') {
      score = 80;
      reasons.push('Active central topology router');
    }

    // Penalize or boost based on last exit code from agent_status.json
    if (typeof statusInfo.last_exit_code === 'number' && statusInfo.last_exit_code !== 0) {
      if (agent.id === 'emergencyfixer') {
        score = Math.max(score, 99);
      } else {
        score = Math.min(95, score + 8);
        reasons.push(`Previous run exited with code ${statusInfo.last_exit_code} (retry boost)`);
      }
    }

    agentScores[agent.id] = {
      agent: agent.id,
      name: agent.name,
      icon: agent.icon,
      category: agent.category,
      score: Math.max(0, Math.min(100, Math.round(score))),
      lastExitCode: statusInfo.last_exit_code ?? 0,
      status: statusInfo.status || 'idle',
      reason: reasons.join('; ') || agent.role
    };
  }

  // Choose topology automatically if not explicitly requested
  let activeTopologyId = requestedTopology || 'adaptive-swarm';
  if (!requestedTopology) {
    if (alertActive) {
      activeTopologyId = 'self-healing-ring';
    } else if (hasUrgentIdeas) {
      activeTopologyId = 'cyclic-pipeline';
    } else {
      const staleResearchCount = ['radical', 'architect-api', 'designer-web', 'designer-portal', 'lawyer', 'compliance']
        .filter(id => (agentScores[id]?.score || 0) >= 75).length;
      if (staleResearchCount >= 4 && pendingAdminIdeas.length === 0) {
        activeTopologyId = 'star-hub';
      } else {
        activeTopologyId = 'adaptive-swarm';
      }
    }
  }

  const topologyObj = TOPOLOGIES[activeTopologyId] || TOPOLOGIES['adaptive-swarm'];
  const selection = topologyObj.selectNextAgent(
    {
      alertActive,
      pipelineState: pipelineState.pipelineState,
      deployVerified: pipelineState.deployVerified,
      lastAgent: pipelineState.lastAgent,
      nextAgent: pipelineState.nextAgent
    },
    agentScores
  );

  // Override recommendedAgent when urgent/alert rules apply in adaptive-swarm
  let recommendedAgent = selection.agent;
  let recommendedCohort = selection.cohort;
  let reason = selection.reason;

  if (alertActive) {
    recommendedAgent = 'emergencyfixer';
    recommendedCohort = ['emergencyfixer', 'deployer', 'regressiontest'];
    reason = agentScores.emergencyfixer.reason;
  } else if (hasUrgentIdeas) {
    recommendedAgent = 'improve';
    recommendedCohort = ['improve', 'deployer', 'regressiontest'];
    reason = agentScores.improve.reason;
  }

  const failingAgents = Object.values(agentStatusMap).filter(a => a && a.last_exit_code && a.last_exit_code !== 0).length;
  const healthScore = Math.max(
    10,
    Math.min(100, 100 - (alertActive ? 35 : 0) - (failingAgents * 10) - (pipelineState.fixRetries * 8))
  );

  return {
    topology: activeTopologyId,
    topologyName: topologyObj.name,
    recommendedAgent,
    recommendedCohort,
    reason,
    agentScores,
    prioritizedIdeas: prioritizedIdeas.slice(0, 15),
    pipelineState,
    healthScore,
    contextStats,
    topologyGraph: {
      id: topologyObj.id,
      name: topologyObj.name,
      tagline: topologyObj.tagline,
      algorithm: topologyObj.algorithm,
      nodes: topologyObj.nodes,
      edges: topologyObj.edges
    }
  };
}

/**
 * Targeted Context-Mode query profiles per agent role.
 */
const AGENT_QUERY_PROFILES = {
  dispatcher: ['pipeline status', 'urgent admin ideas', 'agent execution status', 'compliance gaps'],
  improve: ['urgent admin ideas', 'pending feature implementation', 'API architecture scalability', 'UI UX portal design'],
  deployer: ['docker compose rollout', 'pipeline build status', 'container health verification'],
  regressiontest: ['health endpoint verification', 'regression test failures', 'container status'],
  audit: ['OWASP security vulnerabilities', 'compliance checklist gaps', 'broken access control injection', 'audit findings'],
  gitguardian: ['credential leak secret scan', 'git conflict hygiene', 'cryptographic failures'],
  emergencyfixer: ['emergency outage crash rollback', 'broken pipeline alert', 'container logs error'],
  radical: ['competitor intelligence 10x features', 'radical visionary ideas', 'market differentiation'],
  'architect-api': ['API architecture caching scalability', 'database schema performance', 'backend endpoints'],
  'designer-web': ['landing page conversion motion design', 'website UI UX styling', 'responsive layout'],
  'designer-portal': ['portal dashboard data visualization', 'workflow ergonomics dark mode', 'admin interface'],
  lawyer: ['terms of service privacy policy', 'open source licensing liability', 'GDPR legal compliance'],
  compliance: ['SOC 2 Type II OWASP Top 10 controls', 'logical access MFA encryption', 'compliance checklist'],
  reporter: ['changelog release velocity', 'implemented features log', 'agent execution status summary']
};

/**
 * 4. Team Context & Prompt Enricher (buildSmartAgentContext)
 */
function buildSmartAgentContext(agentName, projectId) {
  const normalizedAgent = AGENTS_CATALOG[agentName] ? agentName : 'improve';
  const agentMeta = AGENTS_CATALOG[normalizedAgent];

  // 1. Sync project knowledge into Context-Mode KB
  contextMode.syncProjectKnowledge(projectId);

  // 2. Run targeted multi-strategy search queries for this agent
  const queries = AGENT_QUERY_PROFILES[normalizedAgent] || [
    `${normalizedAgent} tasks`,
    'urgent admin ideas',
    'compliance security checklist'
  ];

  const searchRes = contextMode.searchKnowledge({
    queries,
    limit: 5,
    projectId
  });

  const swarmIntel = evaluateSwarmIntelligence(projectId);
  const topIdeas = swarmIntel.prioritizedIdeas.slice(0, 5);
  const stats = contextMode.getContextStats(projectId);

  // 3. Build compact, high-signal markdown context block + Think-in-Code instructions
  const lines = [
    `## ${agentMeta.icon} Copilot Hive Smart Context — ${agentMeta.name} (\`${agentMeta.id}\`)`,
    `- **Role**: ${agentMeta.role} | **Category**: \`${agentMeta.category}\``,
    `- **Active Topology**: \`${swarmIntel.topology}\` (${swarmIntel.topologyName}) | **Swarm Health**: \`${swarmIntel.healthScore}%\``,
    `- **Agent Utility Score**: \`U(${agentMeta.id}) = ${swarmIntel.agentScores[agentMeta.id]?.score ?? 75}/100\` (${swarmIntel.agentScores[agentMeta.id]?.reason || 'Ready'})`,
    `- **Context-Mode Savings**: \`${stats.savingsRatioPercent}%\` saved (\`${stats.estimatedTokensSaved}\` est. tokens saved across \`${stats.totalChunks}\` indexed chunks)`,
    ''
  ];

  if (topIdeas.length > 0) {
    lines.push('### Top ICE-Prioritized Ideas Queue');
    for (const idea of topIdeas) {
      const badge = idea.urgent ? '🚨 [URGENT] ' : '';
      lines.push(`- ${badge}**${idea.title}** (\`ICE: ${idea.iceScore}\` — I:${idea.impact} C:${idea.confidence} E:${idea.ease}) [${idea.source}]: ${idea.description.slice(0, 180)}`);
    }
    lines.push('');
  }

  if (searchRes.results && searchRes.results.length > 0) {
    lines.push('### Relevant Knowledge Base Snippets (BM25 + Trigram + RRF)');
    for (const r of searchRes.results) {
      lines.push(`#### [${r.source}] ${r.heading} (\`RRF: ${r.rrfScore}\`, \`${r.contentType}\`)`);
      lines.push(r.snippet);
      lines.push('');
    }
  }

  lines.push('### Context-Mode Think-in-Code Protocol');
  lines.push('1. **Never dump large raw files into prompt context**: Query indexed knowledge via `searchKnowledge({ queries })` or process large logs/JSON in-sandbox via `executeSandbox({ language, code, filePath })`.');
  lines.push('2. **Keep changes surgical & verified**: Coordinate with upstream dependencies (`' + (agentMeta.dependencies.join(', ') || 'none') + '`) and record outputs cleanly.');

  const markdown = lines.join('\n');

  return {
    agentName: normalizedAgent,
    agent: agentMeta,
    projectId: projectId || 'default',
    queries,
    matchedSections: searchRes.results,
    prioritizedIdeas: topIdeas,
    swarmSummary: {
      topology: swarmIntel.topology,
      recommendedAgent: swarmIntel.recommendedAgent,
      healthScore: swarmIntel.healthScore
    },
    contextStats: stats,
    markdown,
    promptBlock: markdown,
    toString() {
      return this.markdown;
    }
  };
}

module.exports = {
  AGENTS_CATALOG,
  TOPOLOGIES,
  evaluateSwarmIntelligence,
  buildSmartAgentContext,
  scoreIdeaICE,
  parsePipelineStatus
};
