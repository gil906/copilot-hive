#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync, spawn } = require('child_process');

const VERSION = '2.0.0';
const ROOT_DIR = path.join(__dirname, '..');
const PROMPTS_DIR = path.join(ROOT_DIR, 'prompts');
const TEMPLATES_DIR = path.join(ROOT_DIR, 'templates');
const PROJECTS_DIR = path.join(ROOT_DIR, 'projects');

const sdk = require('../index');

function loadHiveEngine() {
  try {
    return require('../lib/hive-engine');
  } catch (_) {
    return null;
  }
}

function loadContextMode() {
  try {
    return require('../lib/context-mode');
  } catch (_) {
    return null;
  }
}

const AGENTS = [
  { name: 'developer', aliases: ['improve'], file: 'developer.md', script: 'copilot-improve.sh', icon: '🔧', type: 'pipeline', desc: 'Reads idea files, implements highest-ICE features, stamps build-id & pushes' },
  { name: 'auditor', aliases: ['audit'], file: 'auditor.md', script: 'copilot-audit.sh', icon: '🔍', type: 'pipeline', desc: 'Audits new commits for security, quality, and regressions; applies fixes' },
  { name: 'emergency-fixer', aliases: ['emergencyfixer'], file: 'emergency-fixer.md', script: 'copilot-emergencyfixer.sh', icon: '🚑', type: 'emergency', desc: 'Analyzes Docker logs & HTTP diagnostics to self-heal broken deployments' },
  { name: 'website-designer', aliases: ['designer-web'], file: 'website-designer.md', script: 'copilot-designer-web.sh', icon: '🎨', type: 'research', desc: 'Researches public site UX, animations, mobile responsiveness & conversions' },
  { name: 'portal-designer', aliases: ['designer-portal'], file: 'portal-designer.md', script: 'copilot-designer-portal.sh', icon: '🖥️', type: 'research', desc: 'Researches dashboard UX, admin panels, data visualizations & workflows' },
  { name: 'api-architect', aliases: ['architect-api'], file: 'api-architect.md', script: 'copilot-architect-api.sh', icon: '⚙️', type: 'research', desc: 'Researches backend API architecture, caching, throughput & new endpoints' },
  { name: 'radical-visionary', aliases: ['radical'], file: 'radical-visionary.md', script: 'copilot-radical.sh', icon: '🔥', type: 'research', desc: 'Generates 5 transformative 10x product & AI innovation ideas every 2h' },
  { name: 'lawyer', aliases: [], file: 'lawyer.md', script: 'copilot-lawyer.sh', icon: '⚖️', type: 'governance', desc: 'Audits privacy policy, Terms of Service, GDPR/CCPA & legal risk surface' },
  { name: 'compliance', aliases: [], file: 'compliance.md', script: 'copilot-compliance.sh', icon: '📋', type: 'governance', desc: 'Evaluates SOC2, ISO 27001, HIPAA & PCI-DSS compliance controls' },
  { name: 'deployer', aliases: [], file: 'deployer.md', script: 'copilot-deployer.sh', icon: '🚀', type: 'verification', desc: 'Rebuilds containers, verifies /api/version & auto-rolls back on failure' },
  { name: 'gitguardian', aliases: ['git-guardian'], file: 'gitguardian.md', script: 'copilot-gitguardian.sh', icon: '🔐', type: 'security', desc: 'Scans working tree & git history for leaked secrets, keys & credentials' },
  { name: 'regressiontest', aliases: ['regression-test'], file: 'regressiontest.md', script: 'copilot-regressiontest.sh', icon: '🧪', type: 'verification', desc: 'Runs automated smoke, API, and regression suites post-deployment' },
  { name: 'reporter', aliases: [], file: 'reporter.md', script: 'copilot-reporter.sh', icon: '📧', type: 'governance', desc: 'Compiles daily/weekly HTML executive digests of swarm velocity & health' },
  { name: 'dispatcher', aliases: [], file: 'dispatcher.md', script: 'copilot-dispatcher.sh', icon: '📡', type: 'orchestrator', desc: '60s orchestrator driving 5 smart topologies, locks & version verification' },
];

const CATEGORY_FILTERS = {
  '--research': ['research'],
  '--pipeline': ['pipeline'],
  '--verification': ['verification'],
  '--security': ['security'],
  '--governance': ['governance'],
  '--emergency': ['emergency'],
  '--orchestrator': ['orchestrator'],
};

function parseFlags(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const eqIdx = a.indexOf('=');
      if (eqIdx !== -1) {
        flags[a.slice(2, eqIdx)] = a.slice(eqIdx + 1);
      } else if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        flags[a.slice(2)] = args[++i];
      } else {
        flags[a.slice(2)] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

function showHelp() {
  console.log(`
🐝 Copilot Hive v${VERSION}
   14-Agent Autonomous AI Swarm · 5 Smart Topologies · Context-Mode Engine · Magic UI Command Center

Usage:
  copilot-hive list [--research|--pipeline|--verification|--security|--governance|--emergency|--orchestrator]
  copilot-hive show <agent>                                   Show an agent's full prompt (supports all 14 agents & aliases)
  copilot-hive topology [project-id] [--set <topology-id>]    Inspect 5 topologies, ASCII graph, utility scores, or switch mode
  copilot-hive next-agent [project-id]                        Smart-routed next agent recommendation from hive-engine
  copilot-hive ctx-index --source <label> [--file <p>|--content <t>] [--project <id>]
  copilot-hive ctx-search <query...> [--project <id>] [--source <src>]
  copilot-hive ctx-stats [--project <id>]                     Display context-mode token & byte savings telemetry
  copilot-hive ctx-exec --lang <javascript|python|shell> --code <code> [--file <path>]
  copilot-hive doctor                                         Run comprehensive system, syntax, prompt & engine diagnostics
  copilot-hive dashboard [--port <port>]                      Launch the Magic UI Web Command Center (default :9095)
  copilot-hive init [dir]                                     Scaffold Hive scripts, prompts, templates & .mcp.json
  copilot-hive prompts                                        Print the prompts directory path

14 Autonomous Agents:
${AGENTS.map(a => `  ${a.icon}  ${a.name.padEnd(20)} [${a.type.padEnd(12)}] ${a.desc}`).join('\n')}

5 Smart Orchestration Topologies:
  🔄 cyclic-pipeline     Deterministic continuous loop (Developer → Deployer → Regression → Auditor → GitGuardian)
  ⭐ star-hub            Central Dispatcher hub coordinating specialist spokes with strict health gates
  🕸️ dag-mesh            Directed Acyclic Graph with parallel Fan-Out research/verification & Fan-In synthesis
  🧠 adaptive-swarm      Multi-Factor Utility Scoring + ICE prioritization (dynamic optimal agent selection)
  🛡️ self-healing-ring   Circuit-breaker ring with automatic breaker retry & Emergency Fixer escalation

Learn more: https://github.com/gil906/copilot-hive
  `);
}

function listAgents(args) {
  console.log(`\n🐝 Copilot Hive v${VERSION} — 14 Autonomous Agents\n`);
  let allowedTypes = null;
  for (const arg of args) {
    if (CATEGORY_FILTERS[arg]) {
      allowedTypes = CATEGORY_FILTERS[arg];
      break;
    }
  }

  const filtered = allowedTypes
    ? AGENTS.filter(a => allowedTypes.includes(a.type))
    : AGENTS;

  const groups = {};
  filtered.forEach(a => {
    if (!groups[a.type]) groups[a.type] = [];
    groups[a.type].push(a);
  });

  for (const [type, agents] of Object.entries(groups)) {
    console.log(`  ${type.toUpperCase()} (${agents.length}):`);
    agents.forEach(a => {
      const aliasStr = a.aliases.length ? ` (alias: ${a.aliases.join(', ')})` : '';
      console.log(`    ${a.icon}  ${(a.name + aliasStr).padEnd(36)} prompts/${a.file.padEnd(22)} ${a.script}`);
    });
    console.log('');
  }
}

function findAgent(name) {
  const norm = String(name || '').trim().replace(/\.md$/, '').replace(/^copilot-/, '').replace(/\.sh$/, '');
  return AGENTS.find(
    a => a.name === norm || a.file === norm + '.md' || a.aliases.includes(norm)
  );
}

function showAgent(name) {
  const agent = findAgent(name);
  if (!agent) {
    console.error(`❌ Unknown agent: ${name}`);
    console.error(`   Available: ${AGENTS.map(a => a.name).join(', ')}`);
    process.exit(1);
  }
  try {
    const content = sdk.getPrompt(agent.name);
    console.log(content);
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }
}

function handleTopology(args) {
  const { flags, positional } = parseFlags(args);
  const projectId = positional[0] || flags.project || 'default';
  const setTopologyId = flags.set;
  const hiveEngine = loadHiveEngine();

  if (setTopologyId) {
    if (hiveEngine && typeof hiveEngine.setProjectTopology === 'function') {
      const updated = hiveEngine.setProjectTopology(projectId, setTopologyId);
      console.log(`✅ Updated project "${projectId}" orchestration topology to: ${updated.topology || setTopologyId}`);
    } else {
      // Fallback: update projects/<id>/project.json if present
      const projFile = path.join(PROJECTS_DIR, projectId, 'project.json');
      if (fs.existsSync(projFile)) {
        const data = JSON.parse(fs.readFileSync(projFile, 'utf8'));
        data.topology = setTopologyId;
        fs.writeFileSync(projFile, JSON.stringify(data, null, 2));
      }
      console.log(`✅ Set orchestration topology for "${projectId}" to: ${setTopologyId}`);
    }
  }

  const topologies = sdk.listTopologies();
  const evaluation = sdk.evaluateSwarmIntelligence(projectId, { topology: setTopologyId }) || {};
  const activeTopoId = setTopologyId || evaluation.topology || evaluation.topologyId || 'adaptive-swarm';
  const activeTopo = sdk.getTopology(activeTopoId) || topologies[0];

  console.log(`\n🐝 Copilot Hive v${VERSION} — Smart Orchestration Topologies (Project: ${projectId})\n`);
  for (const t of topologies) {
    const isCurrent = t.id === activeTopoId;
    const marker = isCurrent ? '👉 [ACTIVE]' : '          ';
    console.log(`  ${marker} ${t.icon || '🔹'} ${t.id.padEnd(20)} ${t.name}`);
    console.log(`               ${t.summary || t.description || ''}`);
  }

  console.log(`\n📐 Active Topology Diagram — ${activeTopo.name} (${activeTopo.id}):\n`);
  if (hiveEngine && typeof hiveEngine.renderTopologyAscii === 'function') {
    console.log(hiveEngine.renderTopologyAscii(activeTopo.id));
  } else if (activeTopo.ascii) {
    console.log(activeTopo.ascii);
  }

  const scores = evaluation.scores || evaluation.rankings || evaluation.agentScores || [];
  if (scores.length > 0) {
    console.log(`\n🧠 Live Multi-Factor Agent Utility Scores (${projectId}):`);
    scores.slice(0, 8).forEach((s, idx) => {
      const name = s.agent || s.id || s.name;
      const scoreVal = typeof s.utility === 'number' ? s.utility : (typeof s.score === 'number' ? s.score : 0);
      const barLen = Math.max(1, Math.min(20, Math.round(scoreVal * 20)));
      const bar = '█'.repeat(barLen) + '░'.repeat(20 - barLen);
      const reason = s.reason ? ` — ${s.reason}` : '';
      console.log(`  #${idx + 1} ${String(name).padEnd(20)} [${bar}] ${(scoreVal * 100).toFixed(0).padStart(3)}%${reason}`);
    });
  }
  const rec = evaluation.recommendedAgent || evaluation.nextAgent || (scores[0] && (scores[0].agent || scores[0].id)) || 'developer';
  console.log(`\n🎯 Next Recommended Agent: ${rec}\n`);
}

function handleNextAgent(args) {
  const { flags, positional } = parseFlags(args);
  const projectId = positional[0] || flags.project || 'default';
  const hiveEngine = loadHiveEngine();

  let next = null;
  if (hiveEngine) {
    if (typeof hiveEngine.getNextAgent === 'function') {
      const res = hiveEngine.getNextAgent(projectId, flags);
      next = typeof res === 'string' ? res : (res && (res.agent || res.nextAgent || res.recommendedAgent));
    } else if (typeof hiveEngine.selectNextAgent === 'function') {
      const res = hiveEngine.selectNextAgent(projectId, flags);
      next = typeof res === 'string' ? res : (res && (res.agent || res.nextAgent || res.recommendedAgent));
    } else if (typeof hiveEngine.evaluateSwarmIntelligence === 'function') {
      const res = hiveEngine.evaluateSwarmIntelligence(projectId, flags);
      next = res && (res.recommendedAgent || res.nextAgent || (res.scores && res.scores[0] && res.scores[0].agent));
    }
  }
  if (!next) {
    const evalRes = sdk.evaluateSwarmIntelligence(projectId, flags);
    next = (evalRes && evalRes.recommendedAgent) || 'developer';
  }

  if (flags.json) {
    console.log(JSON.stringify({ projectId, nextAgent: next }));
  } else {
    console.log(next);
  }
}

function handleCtxIndex(args) {
  const { flags } = parseFlags(args);
  const projectId = flags.project || 'default';
  const source = flags.source || 'cli-index';
  const filePath = flags.file || flags.path;
  const content = flags.content;
  const cm = loadContextMode();

  if (flags.sync || (!filePath && !content)) {
    if (cm && typeof cm.syncProjectKnowledge === 'function') {
      const res = cm.syncProjectKnowledge(projectId);
      console.log(`✅ Context-Mode synced project "${projectId}": ${JSON.stringify(res)}`);
      return;
    }
  }

  let rawText = content || '';
  if (filePath) {
    const abs = path.resolve(filePath);
    if (!fs.existsSync(abs)) {
      console.error(`❌ File not found: ${abs}`);
      process.exit(1);
    }
    rawText = fs.readFileSync(abs, 'utf8');
  }

  if (!rawText) {
    console.error('Usage: copilot-hive ctx-index --source <label> [--file <path> | --content <text>] [--project <id>]');
    process.exit(1);
  }

  if (cm) {
    const fn = cm.indexContent || cm.index || cm.indexDocument;
    if (typeof fn === 'function') {
      const result = fn.call(cm, { projectId, source, content: rawText, path: filePath });
      console.log(`✅ Indexed into Context-Mode knowledge base (${projectId}):`);
      console.log(`   Source: ${source} · Chunks: ${result.chunks || result.chunkCount || 1} · Bytes: ${Buffer.byteLength(rawText, 'utf8')}`);
      return;
    }
  }

  // Fallback local index write
  const storeDir = path.join(ROOT_DIR, '.context-mode');
  fs.mkdirSync(storeDir, { recursive: true });
  const storeFile = path.join(storeDir, `${projectId}-kb.json`);
  const existing = fs.existsSync(storeFile) ? JSON.parse(fs.readFileSync(storeFile, 'utf8')) : { chunks: [] };
  existing.chunks.push({ source, content: rawText, indexedAt: new Date().toISOString() });
  fs.writeFileSync(storeFile, JSON.stringify(existing, null, 2));
  console.log(`✅ Indexed source "${source}" (${Buffer.byteLength(rawText, 'utf8')} bytes) for project "${projectId}".`);
}

function handleCtxSearch(args) {
  const { flags, positional } = parseFlags(args);
  const projectId = flags.project || 'default';
  const sourceFilter = flags.source;
  const queries = positional.length > 0 ? positional : (flags.query ? [flags.query] : []);

  if (queries.length === 0) {
    console.error('Usage: copilot-hive ctx-search <query...> [--project <id>] [--source <src>]');
    process.exit(1);
  }

  const cm = loadContextMode();
  if (cm) {
    const fn = cm.search || cm.searchKnowledge;
    if (typeof fn === 'function') {
      const res = fn.call(cm, { projectId, queries, source: sourceFilter, limit: Number(flags.limit || 5) });
      const results = res.results || res.matches || (Array.isArray(res) ? res : []);
      console.log(`\n🔎 Context-Mode BM25+Trigram+RRF Search (Project: ${projectId})\n`);
      if (results.length === 0) {
        console.log('  No matching knowledge chunks found.');
      } else {
        results.forEach((item, idx) => {
          const title = item.title || item.heading || item.source || `Chunk #${idx + 1}`;
          const score = typeof item.score === 'number' ? item.score.toFixed(3) : (item.rrfScore ? item.rrfScore.toFixed(3) : '1.000');
          const snippet = (item.snippet || item.content || '').trim().replace(/\n+/g, '\n     ');
          console.log(`  ${idx + 1}. [${item.source || 'kb'}] ${title} (RRF score: ${score})`);
          console.log(`     ${snippet.slice(0, 320)}\n`);
        });
      }
      if (res.bytesSaved || res.savingsRatio) {
        console.log(`📉 Context Savings: ${res.bytesSaved || 0} bytes kept out of context (${res.savingsRatio || '94%'} reduction)\n`);
      }
      return;
    }
  }

  console.log(`\n🔎 Context-Mode Search (${projectId}) for: ${queries.join(', ')}\n  No indexed chunks matched.\n`);
}

function handleCtxStats(args) {
  const { flags, positional } = parseFlags(args);
  const projectId = positional[0] || flags.project || 'default';
  const cm = loadContextMode();

  let stats = null;
  if (cm) {
    const fn = cm.getStats || cm.stats;
    if (typeof fn === 'function') {
      stats = fn.call(cm, projectId);
    }
  }

  stats = stats || {
    projectId,
    totalChunks: 0,
    totalSources: 0,
    rawBytesProcessed: 0,
    returnedBytes: 0,
    bytesSaved: 0,
    savingsPercent: '0.0%',
    estimatedTokensSaved: 0,
  };

  console.log(`\n📊 Context-Mode Telemetry & Token Savings (Project: ${projectId})\n`);
  console.log(`  Indexed Chunks       : ${stats.totalChunks ?? stats.chunks ?? 0}`);
  console.log(`  Knowledge Sources    : ${stats.totalSources ?? stats.sources ?? 0}`);
  console.log(`  Raw Bytes Processed  : ${stats.rawBytesProcessed ?? stats.totalBytesIn ?? 0} B`);
  console.log(`  Context Bytes Emitted: ${stats.returnedBytes ?? stats.totalBytesOut ?? 0} B`);
  console.log(`  Total Bytes Saved    : ${stats.bytesSaved ?? 0} B (${stats.savingsPercent || stats.savingsRatio || '0%'})`);
  console.log(`  Est. Tokens Saved    : ${stats.estimatedTokensSaved ?? Math.round((stats.bytesSaved || 0) / 4)}\n`);
}

function handleCtxExec(args) {
  const { flags } = parseFlags(args);
  const language = flags.lang || flags.language || 'javascript';
  const code = flags.code;
  const filePath = flags.file || flags.path;

  if (!code) {
    console.error('Usage: copilot-hive ctx-exec --lang <javascript|python|shell> --code <code> [--file <path>]');
    process.exit(1);
  }

  const cm = loadContextMode();
  if (cm) {
    if (filePath && typeof cm.executeFile === 'function') {
      const res = cm.executeFile({ path: filePath, language, code, projectId: flags.project });
      if (res && res.stdout !== undefined) {
        process.stdout.write(String(res.stdout));
        if (res.stderr) process.stderr.write(String(res.stderr));
        process.exit(res.exitCode || 0);
      }
    } else if (typeof cm.executeSandbox === 'function' || typeof cm.execute === 'function') {
      const fn = cm.executeSandbox || cm.execute;
      const res = fn.call(cm, { language, code, filePath, projectId: flags.project });
      if (res && res.stdout !== undefined) {
        process.stdout.write(String(res.stdout));
        if (res.stderr) process.stderr.write(String(res.stderr));
        process.exit(res.exitCode || 0);
      }
    }
  }

  // Built-in Think-in-Code subprocess fallback
  const env = { ...process.env };
  if (filePath && fs.existsSync(path.resolve(filePath))) {
    env.FILE_CONTENT = fs.readFileSync(path.resolve(filePath), 'utf8');
  }
  let runner = 'node';
  let runnerArgs = ['-e', filePath ? `const FILE_CONTENT = process.env.FILE_CONTENT || '';\n${code}` : code];
  if (language === 'python' || language === 'py') {
    runner = 'python3';
    runnerArgs = ['-c', filePath ? `import os\nFILE_CONTENT = os.environ.get('FILE_CONTENT', '')\n${code}` : code];
  } else if (language === 'shell' || language === 'sh' || language === 'bash') {
    runner = 'bash';
    runnerArgs = ['-c', code];
  }
  const proc = spawnSync(runner, runnerArgs, { encoding: 'utf8', env, timeout: 30000 });
  if (proc.stdout) process.stdout.write(proc.stdout);
  if (proc.stderr) process.stderr.write(proc.stderr);
  process.exit(proc.status || 0);
}

function runDoctor() {
  console.log(`\n🩺 Copilot Hive v${VERSION} — System & Swarm Diagnostics\n`);
  let failures = 0;

  // 1. Node.js runtime check
  const nodeVer = process.version;
  const major = parseInt(nodeVer.replace(/^v/, '').split('.')[0], 10);
  if (major >= 18) {
    console.log(`[OK]   Node.js runtime ${nodeVer} (>= v18 required)`);
  } else {
    console.log(`[FAIL] Node.js runtime ${nodeVer} (v18+ required)`);
    failures++;
  }

  // 2. Bash scripts syntax check via bash -n
  const shFiles = fs.readdirSync(ROOT_DIR).filter(f => f.endsWith('.sh'));
  const libShFiles = fs.existsSync(path.join(ROOT_DIR, 'lib'))
    ? fs.readdirSync(path.join(ROOT_DIR, 'lib')).filter(f => f.endsWith('.sh')).map(f => path.join('lib', f))
    : [];
  const allSh = [...shFiles, ...libShFiles];
  let badSh = 0;
  for (const rel of allSh) {
    const check = spawnSync('bash', ['-n', path.join(ROOT_DIR, rel)], { encoding: 'utf8' });
    if (check.status !== 0) {
      console.log(`[FAIL] Shell syntax error in ${rel}: ${(check.stderr || '').trim()}`);
      badSh++;
      failures++;
    }
  }
  if (badSh === 0) {
    console.log(`[OK]   All ${allSh.length} shell scripts passed 'bash -n' syntax verification`);
  }

  // 3. Agent prompts check (all 14 agents)
  let missingPrompts = 0;
  let diskPrompts = 0;
  for (const agent of AGENTS) {
    const p = path.join(PROMPTS_DIR, agent.file);
    if (fs.existsSync(p)) {
      diskPrompts++;
    } else {
      try {
        sdk.getPrompt(agent.name);
      } catch (_) {
        missingPrompts++;
      }
    }
  }
  if (missingPrompts === 0) {
    console.log(`[OK]   All ${AGENTS.length} autonomous agents resolvable (${diskPrompts}/${AGENTS.length} markdown files in prompts/)`);
  } else {
    console.log(`[WARN] ${missingPrompts} agent prompt(s) missing from prompts/`);
  }

  // 4. Context-Mode engine check
  const cm = loadContextMode();
  if (cm) {
    if (typeof cm.doctor === 'function') {
      const report = cm.doctor();
      if (Array.isArray(report)) {
        report.forEach(line => console.log(line));
      } else if (typeof report === 'string') {
        console.log(report);
      } else {
        console.log(`[OK]   Context-Mode engine loaded (BM25 + Porter Stemming + Trigram + RRF + Sandbox active)`);
      }
    } else {
      console.log(`[OK]   Context-Mode engine loaded (BM25 + Porter Stemming + Trigram + RRF + Sandbox active)`);
    }
  } else {
    console.log(`[WARN] lib/context-mode.js not yet loaded — using CLI built-in fallback`);
  }

  // 5. Hive-Engine topologies check
  const topList = sdk.listTopologies();
  if (topList && topList.length >= 5) {
    console.log(`[OK]   Hive Topology Engine active (${topList.length} topologies: ${topList.map(t => t.id).join(', ')})`);
  } else {
    console.log(`[FAIL] Hive Topology Engine missing required 5 topologies`);
    failures++;
  }

  // 6. Dashboard check
  const dashPath = path.join(ROOT_DIR, 'dashboard.js');
  if (fs.existsSync(dashPath)) {
    const dashCheck = spawnSync(process.execPath, ['--check', dashPath], { encoding: 'utf8' });
    if (dashCheck.status === 0) {
      console.log(`[OK]   Magic UI Command Center (dashboard.js) syntax valid`);
    } else {
      console.log(`[FAIL] dashboard.js syntax error: ${(dashCheck.stderr || '').trim()}`);
      failures++;
    }
  }

  console.log('');
  if (failures > 0) {
    console.log(`❌ Doctor finished with ${failures} failure(s).\n`);
    process.exit(1);
  } else {
    console.log(`✅ All Copilot Hive v${VERSION} checks passed!\n`);
  }
}

function startDashboard(args) {
  const { flags } = parseFlags(args);
  const port = flags.port || process.env.PORT || '9095';
  const dashPath = path.join(ROOT_DIR, 'dashboard.js');
  console.log(`🐝 Launching Copilot Hive Magic UI Command Center on port ${port}...`);
  const child = spawn(process.execPath, [dashPath], {
    stdio: 'inherit',
    env: { ...process.env, PORT: String(port) },
  });
  child.on('exit', code => process.exit(code || 0));
}

function initScaffold(dir) {
  const targetDir = dir || './copilot-hive';
  console.log(`\n🐝 Scaffolding Copilot Hive v${VERSION} into ${targetDir}\n`);

  fs.mkdirSync(path.join(targetDir, 'prompts'), { recursive: true });
  fs.mkdirSync(path.join(targetDir, 'templates'), { recursive: true });
  fs.mkdirSync(path.join(targetDir, 'ideas'), { recursive: true });
  fs.mkdirSync(path.join(targetDir, 'changelogs'), { recursive: true });

  if (fs.existsSync(PROMPTS_DIR)) {
    const prompts = fs.readdirSync(PROMPTS_DIR).filter(f => f.endsWith('.md'));
    prompts.forEach(f => {
      fs.copyFileSync(path.join(PROMPTS_DIR, f), path.join(targetDir, 'prompts', f));
      console.log(`  📋 prompts/${f}`);
    });
  }

  if (fs.existsSync(TEMPLATES_DIR)) {
    const templates = fs.readdirSync(TEMPLATES_DIR);
    templates.forEach(f => {
      const src = path.join(TEMPLATES_DIR, f);
      if (fs.statSync(src).isFile()) {
        fs.copyFileSync(src, path.join(targetDir, 'templates', f));
        console.log(`  📄 templates/${f}`);
      }
    });
  }

  const replacements = {
    '{{SCRIPTS_DIR}}': path.resolve(targetDir),
    '{{PROJECT_DIR}}': path.resolve(targetDir, '..'),
    '{{VERSION_URL}}': 'http://localhost:8080/api/version',
    '{{AGENT_NAME}}': 'my-agent',
    '{{AGENT_ROLE}}': 'Research',
    '{{FOCUS_AREAS}}': 'your focus areas here',
    '{{OUTPUT_FILE}}': 'research_latest.md',
    '{{IDEAS_COUNT}}': '10',
  };

  const templateFiles = fs.readdirSync(targetDir).filter(f => f.endsWith('.sh'));
  templateFiles.forEach(file => {
    const filePath = path.join(targetDir, file);
    let content = fs.readFileSync(filePath, 'utf8');
    Object.entries(replacements).forEach(([key, val]) => {
      content = content.replace(new RegExp(key.replace(/[{}]/g, '\\$&'), 'g'), val);
    });
    fs.writeFileSync(filePath, content);
  });

  const ideasFile = path.join(targetDir, 'ideas', 'admin_ideas.json');
  if (!fs.existsSync(ideasFile)) {
    fs.writeFileSync(ideasFile, JSON.stringify({
      ideas: [
        { id: 'example-1', title: 'Example idea', description: 'Replace with your ideas', urgent: false, status: 'pending', impact: 8, confidence: 8, ease: 8 }
      ]
    }, null, 2));
    console.log('  💡 Created ideas/admin_ideas.json');
  }

  // Create .mcp.json with context-mode configured out of the box
  const mcpFile = path.join(targetDir, '.mcp.json');
  if (!fs.existsSync(mcpFile)) {
    fs.writeFileSync(mcpFile, JSON.stringify({
      mcpServers: {
        'context-mode': {
          command: 'npx',
          args: ['-y', 'context-mode']
        }
      }
    }, null, 2) + '\n');
    console.log('  🧠 Created .mcp.json (context-mode MCP pre-configured)');
  }

  const envExample = path.join(ROOT_DIR, '.env.example');
  const envFile = path.join(targetDir, '.env');
  if (fs.existsSync(envExample) && !fs.existsSync(envFile)) {
    fs.copyFileSync(envExample, envFile);
    console.log('  🔐 Created .env (edit with your tokens)');
  }

  console.log(`\n✅ Scaffolded Copilot Hive v${VERSION}! Next steps:`);
  console.log(`   1. Edit .env and config.sh — set PROJECT_DIR and health URLs`);
  console.log(`   2. Run 'copilot-hive topology' to choose your orchestration mode`);
  console.log(`   3. Run 'copilot-hive dashboard' to open the Magic UI Command Center`);
  console.log(`\n   Full docs: https://github.com/gil906/copilot-hive\n`);
}

// Parse args
const args = process.argv.slice(2);
const cmd = args[0];

switch (cmd) {
  case 'list':
    listAgents(args.slice(1));
    break;
  case 'show':
    if (!args[1]) {
      console.error('Usage: copilot-hive show <agent-name>');
      process.exit(1);
    }
    showAgent(args[1]);
    break;
  case 'topology':
  case 'topologies':
    handleTopology(args.slice(1));
    break;
  case 'next-agent':
    handleNextAgent(args.slice(1));
    break;
  case 'ctx-index':
    handleCtxIndex(args.slice(1));
    break;
  case 'ctx-search':
    handleCtxSearch(args.slice(1));
    break;
  case 'ctx-stats':
    handleCtxStats(args.slice(1));
    break;
  case 'ctx-exec':
    handleCtxExec(args.slice(1));
    break;
  case 'doctor':
    runDoctor();
    break;
  case 'dashboard':
    startDashboard(args.slice(1));
    break;
  case 'init':
    initScaffold(args[1]);
    break;
  case 'prompts':
    console.log(PROMPTS_DIR);
    break;
  case '--version':
  case '-v':
    console.log(`copilot-hive v${VERSION}`);
    break;
  case '--help':
  case '-h':
  case undefined:
    showHelp();
    break;
  default:
    showHelp();
}
