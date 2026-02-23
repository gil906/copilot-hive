const fs = require('fs');
const path = require('path');

const PROMPTS_DIR = path.join(__dirname, 'prompts');

const agents = {
  developer: 'developer.md',
  auditor: 'auditor.md',
  'emergency-fixer': 'emergency-fixer.md',
  'website-designer': 'website-designer.md',
  'portal-designer': 'portal-designer.md',
  'api-architect': 'api-architect.md',
  'radical-visionary': 'radical-visionary.md',
  lawyer: 'lawyer.md',
  compliance: 'compliance.md',
};

function getPrompt(agentName) {
  const file = agents[agentName];
  if (!file) throw new Error(`Unknown agent: ${agentName}. Available: ${Object.keys(agents).join(', ')}`);
  return fs.readFileSync(path.join(PROMPTS_DIR, file), 'utf8');
}

function listAgents() {
  return Object.keys(agents);
}

module.exports = { getPrompt, listAgents, agents, PROMPTS_DIR };
