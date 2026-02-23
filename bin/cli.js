#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const VERSION = '1.0.0';
const PROMPTS_DIR = path.join(__dirname, '..', 'prompts');
const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');

const AGENTS = [
  { name: 'developer', file: 'developer.md', icon: '🔧', type: 'pipeline' },
  { name: 'auditor', file: 'auditor.md', icon: '🔍', type: 'pipeline' },
  { name: 'emergency-fixer', file: 'emergency-fixer.md', icon: '🚑', type: 'emergency' },
  { name: 'website-designer', file: 'website-designer.md', icon: '🎨', type: 'research' },
  { name: 'portal-designer', file: 'portal-designer.md', icon: '🖥️', type: 'research' },
  { name: 'api-architect', file: 'api-architect.md', icon: '⚙️', type: 'research' },
  { name: 'radical-visionary', file: 'radical-visionary.md', icon: '🔥', type: 'research' },
  { name: 'lawyer', file: 'lawyer.md', icon: '⚖️', type: 'research' },
  { name: 'compliance', file: 'compliance.md', icon: '📋', type: 'research' },
];

function showHelp() {
  console.log(`
🐝 Copilot Hive v${VERSION}
   Autonomous AI Agent Swarm for Continuous Development

Usage:
  copilot-hive list                    List all agent prompts
  copilot-hive show <agent>            Show an agent's full prompt
  copilot-hive init [dir]              Scaffold agent scripts into a directory
  copilot-hive prompts                 Show the prompts directory path

Agents:
${AGENTS.map(a => `  ${a.icon}  ${a.name.padEnd(20)} (${a.type})`).join('\n')}

Examples:
  copilot-hive show developer          View the Developer agent prompt
  copilot-hive show radical-visionary  View the Radical Visionary prompt
  copilot-hive init ./my-agents        Scaffold all scripts into ./my-agents
  copilot-hive list --research         List only research agent prompts

Learn more: https://github.com/gil906/copilot-hive
  `);
}

function listAgents(filter) {
  console.log('\n🐝 Copilot Hive — Agent Prompts\n');
  const filtered = filter 
    ? AGENTS.filter(a => a.type === filter)
    : AGENTS;
  
  const groups = {};
  filtered.forEach(a => {
    if (!groups[a.type]) groups[a.type] = [];
    groups[a.type].push(a);
  });

  for (const [type, agents] of Object.entries(groups)) {
    console.log(`  ${type.toUpperCase()}:`);
    agents.forEach(a => {
      console.log(`    ${a.icon}  ${a.name.padEnd(22)} prompts/${a.file}`);
    });
    console.log('');
  }
}

function showAgent(name) {
  const agent = AGENTS.find(a => a.name === name || a.file === name || a.file === name + '.md');
  if (!agent) {
    console.error(`❌ Unknown agent: ${name}`);
    console.error(`   Available: ${AGENTS.map(a => a.name).join(', ')}`);
    process.exit(1);
  }
  const promptPath = path.join(PROMPTS_DIR, agent.file);
  if (fs.existsSync(promptPath)) {
    console.log(fs.readFileSync(promptPath, 'utf8'));
  } else {
    console.error(`❌ Prompt file not found: ${promptPath}`);
    process.exit(1);
  }
}

function initScaffold(dir) {
  const targetDir = dir || './copilot-hive';
  console.log(`\n🐝 Scaffolding Copilot Hive into ${targetDir}\n`);
  
  // Create directories
  fs.mkdirSync(path.join(targetDir, 'prompts'), { recursive: true });
  fs.mkdirSync(path.join(targetDir, 'templates'), { recursive: true });
  fs.mkdirSync(path.join(targetDir, 'ideas'), { recursive: true });

  // Copy prompts
  const prompts = fs.readdirSync(PROMPTS_DIR);
  prompts.forEach(f => {
    fs.copyFileSync(path.join(PROMPTS_DIR, f), path.join(targetDir, 'prompts', f));
    console.log(`  📋 prompts/${f}`);
  });

  // Copy templates
  if (fs.existsSync(TEMPLATES_DIR)) {
    const templates = fs.readdirSync(TEMPLATES_DIR);
    templates.forEach(f => {
      fs.copyFileSync(path.join(TEMPLATES_DIR, f), path.join(targetDir, 'templates', f));
      console.log(`  📄 templates/${f}`);
    });
  }

  console.log(`\n✅ Scaffolded! Next steps:`);
  console.log(`   1. Edit templates/ — set PROJECT_DIR and other paths`);
  console.log(`   2. Read prompts/ — customize for your project`);
  console.log(`   3. Set up crontab (see README)`);
  console.log(`\n   Full docs: https://github.com/gil906/copilot-hive\n`);
}

// Parse args
const args = process.argv.slice(2);
const cmd = args[0];

switch (cmd) {
  case 'list':
    listAgents(args[1] === '--research' ? 'research' : args[1] === '--pipeline' ? 'pipeline' : null);
    break;
  case 'show':
    if (!args[1]) { console.error('Usage: copilot-hive show <agent-name>'); process.exit(1); }
    showAgent(args[1]);
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
  default:
    showHelp();
}
