#!/usr/bin/env node
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { spawn, execSync } = require('child_process');
const net = require('net');

const PORT = Number(process.env.PORT) || 9096;
const HIVE_DIR = __dirname;
const PROJECTS_DIR = path.join(HIVE_DIR, 'projects');
const REGISTRY_FILE = path.join(PROJECTS_DIR, 'registry.json');
const PROMPTS_DIR = path.join(HIVE_DIR, 'prompts');

// ---------------------------------------------------------------------------
// Dynamic Lazy Loaders for lib/hive-engine.js & lib/context-mode.js
// ---------------------------------------------------------------------------

function getHiveEngine() {
  try {
    return require('./lib/hive-engine');
  } catch {
    return null;
  }
}

function getContextMode() {
  try {
    return require('./lib/context-mode');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 14-Agent Master Catalog (with built-in fallback metadata)
// ---------------------------------------------------------------------------

const ALL_AGENTS = [
  'dispatcher',
  'improve',
  'deployer',
  'regressiontest',
  'audit',
  'gitguardian',
  'emergencyfixer',
  'radical',
  'architect-api',
  'designer-web',
  'designer-portal',
  'lawyer',
  'compliance',
  'reporter'
];

const DEFAULT_AGENT_META = {
  dispatcher: { id: 'dispatcher', name: 'Orchestrator Hub', icon: '🧠', category: 'orchestrator', role: 'Central Event & Topology Router', color: '#a855f7', ring: 0, promptFile: 'dispatcher.md' },
  improve: { id: 'improve', name: 'Feature Engineer', icon: '🔧', category: 'pipeline', role: 'Full-Stack Feature & Bug Implementation', color: '#3b82f6', ring: 1, promptFile: 'developer.md' },
  deployer: { id: 'deployer', name: 'Release Engineer', icon: '🚀', category: 'pipeline', role: 'Zero-Downtime Container Build & Rollout', color: '#06b6d4', ring: 1, promptFile: 'deployer.md' },
  regressiontest: { id: 'regressiontest', name: 'QA Sentinel', icon: '🧪', category: 'verification', role: 'Parallel HTTP, JSON & Container Verification', color: '#10b981', ring: 1, promptFile: 'regressiontest.md' },
  audit: { id: 'audit', name: 'Code & Security Auditor', icon: '🔍', category: 'verification', role: 'OWASP, Logic, Performance & Dead-Code Audit', color: '#f59e0b', ring: 1, promptFile: 'auditor.md' },
  gitguardian: { id: 'gitguardian', name: 'Secret & Repo Guardian', icon: '🛡️', category: 'security', role: 'Credential Leak, Conflict & Git Hygiene Scanner', color: '#ef4444', ring: 2, promptFile: 'gitguardian.md' },
  emergencyfixer: { id: 'emergencyfixer', name: 'Incident Responder', icon: '🚑', category: 'emergency', role: 'Autonomous Outage Triage, Self-Healing & Rollback', color: '#dc2626', ring: 2, promptFile: 'emergency-fixer.md' },
  radical: { id: 'radical', name: 'Radical Visionary', icon: '🔥', category: 'research', role: 'Competitor Intelligence & 10x Feature Ideation', color: '#f97316', ring: 3, promptFile: 'radical-visionary.md' },
  'architect-api': { id: 'architect-api', name: 'Systems & API Architect', icon: '⚙️', category: 'research', role: 'Backend Scalability, Caching & API Design', color: '#0ea5e9', ring: 3, promptFile: 'api-architect.md' },
  'designer-web': { id: 'designer-web', name: 'Web UI/UX Designer', icon: '🎨', category: 'research', role: 'Landing Page, Motion & Conversion Design', color: '#ec4899', ring: 3, promptFile: 'website-designer.md' },
  'designer-portal': { id: 'designer-portal', name: 'Portal & Dashboard Designer', icon: '🖥️', category: 'research', role: 'App Ergonomics, Workflows & Data Visualization', color: '#8b5cf6', ring: 3, promptFile: 'portal-designer.md' },
  lawyer: { id: 'lawyer', name: 'Legal & IP Counsel', icon: '⚖️', category: 'governance', role: 'Terms, Privacy, Licensing & Liability Analysis', color: '#eab308', ring: 3, promptFile: 'lawyer.md' },
  compliance: { id: 'compliance', name: 'Compliance Officer', icon: '📋', category: 'governance', role: 'SOC2, GDPR, HIPAA & ISO27001 Controls', color: '#14b8a6', ring: 3, promptFile: 'compliance.md' },
  reporter: { id: 'reporter', name: 'Executive Reporter', icon: '📊', category: 'telemetry', role: 'Daily/Weekly Digest & Velocity Telemetry', color: '#6366f1', ring: 2, promptFile: 'reporter.md' }
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureProjectsDir() {
  if (!fs.existsSync(PROJECTS_DIR)) fs.mkdirSync(PROJECTS_DIR, { recursive: true });
  if (!fs.existsSync(REGISTRY_FILE)) fs.writeFileSync(REGISTRY_FILE, '[]', 'utf8');
}

function readRegistry() {
  ensureProjectsDir();
  try {
    const raw = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
    if (Array.isArray(raw)) return raw;
    if (raw && Array.isArray(raw.projects)) return raw.projects;
    return [];
  } catch { return []; }
}

function writeRegistry(data) {
  ensureProjectsDir();
  let existing;
  try { existing = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8')); } catch { existing = null; }
  if (existing && !Array.isArray(existing) && 'projects' in existing) {
    existing.projects = data;
    fs.writeFileSync(REGISTRY_FILE, JSON.stringify(existing, null, 2), 'utf8');
  } else {
    fs.writeFileSync(REGISTRY_FILE, JSON.stringify(data, null, 2), 'utf8');
  }
}

/**
 * Fix project.json Schema Mismatch Bug:
 * Synchronize top-level fields (compose_file, containers, health_url, version_url, topology)
 * AND nested docker: { compose_file, containers, health_url, version_url } so both
 * lib/load-project.sh and the Web GUI read the exact same config!
 */
function normalizeProjectConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return null;
  const docker = (cfg.docker && typeof cfg.docker === 'object') ? cfg.docker : {};
  const compose_file = cfg.compose_file !== undefined ? cfg.compose_file : (docker.compose_file || '');
  const containers = (cfg.containers && Object.keys(cfg.containers).length > 0)
    ? cfg.containers
    : (docker.containers && typeof docker.containers === 'object' ? docker.containers : {});
  const health_url = cfg.health_url !== undefined ? cfg.health_url : (docker.health_url || 'http://localhost:8080/');
  const version_url = cfg.version_url !== undefined ? cfg.version_url : (docker.version_url || '');
  const topology = cfg.topology || 'adaptive-swarm';
  const agents = Array.isArray(cfg.agents) && cfg.agents.length > 0 ? cfg.agents : ALL_AGENTS;

  cfg.compose_file = compose_file;
  cfg.containers = containers;
  cfg.health_url = health_url;
  cfg.version_url = version_url;
  cfg.topology = topology;
  cfg.agents = agents;
  cfg.docker = {
    compose_file,
    containers,
    health_url,
    version_url
  };
  return cfg;
}

function readProjectConfig(id) {
  if (!id || id === 'default') return null;
  const p = path.join(PROJECTS_DIR, id, 'project.json');
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    return normalizeProjectConfig(raw);
  } catch { return null; }
}

function writeProjectConfig(id, data) {
  const dir = path.join(PROJECTS_DIR, id);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const normalized = normalizeProjectConfig({ ...data, id });
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(normalized, null, 2), 'utf8');
  return normalized;
}

function resolveProjectRoot(id) {
  if (!id || id === 'default') return HIVE_DIR;
  const pDir = path.join(PROJECTS_DIR, id);
  if (fs.existsSync(pDir)) return pDir;
  return HIVE_DIR;
}

function resolveProjectIdeasDir(id) {
  const root = resolveProjectRoot(id);
  const ideasDir = path.join(root, 'ideas');
  if (!fs.existsSync(ideasDir)) fs.mkdirSync(ideasDir, { recursive: true });
  return ideasDir;
}

function isProjectPaused(id) {
  const root = resolveProjectRoot(id);
  return fs.existsSync(path.join(root, '.agents-paused'));
}

function isAgentPaused(id, agent) {
  const root = resolveProjectRoot(id);
  const perProjectPause = path.join(root, `.agent-paused-${agent}`);
  const globalPause = path.join(HIVE_DIR, `.agent-paused-${agent}`);
  return fs.existsSync(perProjectPause) || (root !== HIVE_DIR && fs.existsSync(globalPause));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function slugify(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// ---------------------------------------------------------------------------
// HTML SPA
// ---------------------------------------------------------------------------

function getHTML() {
  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Copilot Hive v2.0 — Autonomous 14-Agent Swarm & Topology Studio</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#05070f;
  --bg-elevated:#0b1021;
  --card:rgba(15,21,42,0.74);
  --card-solid:#10172e;
  --card-hover:rgba(24,33,64,0.88);
  --accent:#00d4ff;
  --purple:#9e7aff;
  --pink:#fe8bbb;
  --amber:#ffaa40;
  --success:#10b981;
  --warning:#f59e0b;
  --error:#ef4444;
  --text:#f1f5f9;
  --muted:#94a3b8;
  --border:rgba(148,163,184,0.16);
  --radius:16px;
}
body{
  font-family:'Inter',system-ui,-apple-system,BlinkMacSystemFont,sans-serif;
  background:var(--bg);
  color:var(--text);
  min-height:100vh;
  overflow-x:hidden;
  position:relative;
}
a{color:var(--accent);text-decoration:none}
button,select,input,textarea{font-family:inherit}
button{cursor:pointer}

/* ── Magic UI Background: Particles + FlickeringGrid Canvas ── */
#magic-bg-canvas{
  position:fixed;
  inset:0;
  width:100vw;
  height:100vh;
  z-index:0;
  pointer-events:none;
}
.ambient-orb{
  position:fixed;
  border-radius:9999px;
  filter:blur(110px);
  opacity:0.22;
  pointer-events:none;
  z-index:0;
}
.ambient-orb-1{width:520px;height:520px;top:-140px;left:-100px;background:radial-gradient(circle,#9e7aff,transparent 70%)}
.ambient-orb-2{width:460px;height:460px;bottom:-120px;right:-80px;background:radial-gradient(circle,#00d4ff,transparent 70%)}

.app-shell{position:relative;z-index:1;min-height:100vh;display:flex;flex-direction:column}

/* ── Magic UI HyperText & AuroraText ── */
.hyper-text{
  font-family:'JetBrains Mono','Fira Code',monospace;
  letter-spacing:0.04em;
  font-weight:800;
  cursor:pointer;
}
.aurora-text{
  background:linear-gradient(120deg,#00d4ff 0%,#9e7aff 32%,#fe8bbb 66%,#ffaa40 100%);
  background-size:240% 240%;
  -webkit-background-clip:text;
  background-clip:text;
  -webkit-text-fill-color:transparent;
  animation:auroraShift 6s ease infinite;
}
@keyframes auroraShift{
  0%,100%{background-position:0% 50%}
  50%{background-position:100% 50%}
}
.aurora-badge{
  display:inline-flex;
  align-items:center;
  gap:6px;
  padding:4px 11px;
  border-radius:999px;
  font-size:0.74rem;
  font-weight:700;
  background:linear-gradient(135deg,rgba(0,212,255,0.14),rgba(158,122,255,0.18),rgba(254,139,187,0.14));
  border:1px solid rgba(158,122,255,0.38);
  color:#e2e8f0;
  box-shadow:0 0 18px rgba(158,122,255,0.18);
}

/* ── Magic UI MagicCard + BorderBeam ── */
.magic-card{
  --mouse-x:-300px;
  --mouse-y:-300px;
  position:relative;
  background:var(--card);
  backdrop-filter:blur(16px);
  -webkit-backdrop-filter:blur(16px);
  border:1px solid var(--border);
  border-radius:var(--radius);
  padding:20px;
  overflow:hidden;
  transition:transform 0.25s cubic-bezier(.16,1,.3,1),border-color 0.25s ease,box-shadow 0.25s ease;
}
.magic-card::before{
  content:"";
  position:absolute;
  inset:0;
  border-radius:inherit;
  background:radial-gradient(360px circle at var(--mouse-x) var(--mouse-y),rgba(158,122,255,0.16),rgba(0,212,255,0.06) 45%,transparent 80%);
  opacity:0;
  transition:opacity 0.3s ease;
  pointer-events:none;
  z-index:0;
}
.magic-card::after{
  content:"";
  position:absolute;
  inset:0;
  border-radius:inherit;
  padding:1px;
  background:radial-gradient(260px circle at var(--mouse-x) var(--mouse-y),#00d4ff,#9e7aff,#fe8bbb,transparent 100%);
  -webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);
  -webkit-mask-composite:xor;
  mask-composite:exclude;
  opacity:0;
  transition:opacity 0.3s ease;
  pointer-events:none;
  z-index:1;
}
.magic-card:hover{
  transform:translateY(-2px);
  box-shadow:0 14px 40px -10px rgba(0,212,255,0.14),0 0 1px 1px rgba(158,122,255,0.22);
}
.magic-card:hover::before,.magic-card:hover::after{opacity:1}
.magic-card > *{position:relative;z-index:2}

/* Magic UI BorderBeam */
.border-beam{
  pointer-events:none;
  position:absolute;
  inset:0;
  border-radius:inherit;
  padding:1.5px;
  background:conic-gradient(from var(--beam-angle,0deg),transparent 0deg,transparent 265deg,#ffaa40 295deg,#9e7aff 330deg,#00d4ff 360deg);
  -webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);
  -webkit-mask-composite:xor;
  mask-composite:exclude;
  animation:borderBeamSpin 4.5s linear infinite;
  z-index:1;
}
@keyframes borderBeamSpin{
  0%{--beam-angle:0deg;filter:hue-rotate(0deg)}
  100%{--beam-angle:360deg;filter:hue-rotate(360deg)}
}
@property --beam-angle{
  syntax:'<angle>';
  initial-value:0deg;
  inherits:false;
}

/* ── Magic UI ShimmerButton & RippleButton ── */
.shimmer-btn{
  position:relative;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:8px;
  padding:9px 18px;
  border-radius:999px;
  font-weight:700;
  font-size:0.84rem;
  color:#fff;
  background:#0c1226;
  border:1px solid rgba(255,255,255,0.16);
  overflow:hidden;
  transition:transform 0.2s ease,box-shadow 0.2s ease;
  box-shadow:0 4px 20px rgba(158,122,255,0.25),inset 0 -6px 12px rgba(255,255,255,0.08);
}
.shimmer-btn::before{
  content:"";
  position:absolute;
  inset:-150%;
  background:conic-gradient(from 0deg,transparent 0deg,transparent 280deg,#00d4ff 320deg,#fe8bbb 345deg,#ffffff 360deg);
  animation:shimmerRotate 3.2s linear infinite;
  z-index:0;
}
.shimmer-btn::after{
  content:"";
  position:absolute;
  inset:1.5px;
  border-radius:999px;
  background:linear-gradient(135deg,#0f172a 0%,#1a1438 100%);
  z-index:0;
}
.shimmer-btn > span{position:relative;z-index:1;display:inline-flex;align-items:center;gap:6px}
.shimmer-btn:hover{transform:translateY(-1px);box-shadow:0 8px 26px rgba(0,212,255,0.35)}
.shimmer-btn:active{transform:translateY(1px)}
@keyframes shimmerRotate{to{transform:rotate(360deg)}}

.ripple-btn{
  position:relative;
  overflow:hidden;
  display:inline-flex;
  align-items:center;
  gap:6px;
  padding:7px 14px;
  border-radius:10px;
  font-size:0.8rem;
  font-weight:600;
  border:1px solid var(--border);
  background:rgba(15,23,42,0.75);
  color:var(--text);
  transition:all 0.2s ease;
}
.ripple-btn:hover{border-color:var(--accent);color:var(--accent);background:rgba(0,212,255,0.08)}
.ripple-btn.danger{border-color:rgba(239,68,68,0.4);color:#fca5a5}
.ripple-btn.danger:hover{background:rgba(239,68,68,0.18);color:#fff}
.ripple-btn.success{border-color:rgba(16,185,129,0.4);color:#6ee7b7}
.ripple-btn.success:hover{background:rgba(16,185,129,0.18);color:#fff}
.ripple-circle{
  position:absolute;
  border-radius:50%;
  transform:scale(0);
  animation:rippleAnim 600ms linear;
  background:rgba(0,212,255,0.35);
  pointer-events:none;
}
@keyframes rippleAnim{to{transform:scale(4);opacity:0}}

/* ── Header & Navigation ── */
.header{
  display:flex;
  align-items:center;
  justify-content:space-between;
  padding:16px 28px;
  border-bottom:1px solid var(--border);
  background:rgba(8,12,26,0.82);
  backdrop-filter:blur(20px);
  position:sticky;
  top:0;
  z-index:40;
  flex-wrap:wrap;
  gap:14px;
}
.brand{display:flex;align-items:center;gap:12px}
.brand-logo{
  width:42px;height:42px;border-radius:12px;
  display:flex;align-items:center;justify-content:center;
  font-size:1.45rem;
  background:linear-gradient(135deg,rgba(0,212,255,0.2),rgba(158,122,255,0.25));
  border:1px solid rgba(0,212,255,0.35);
  box-shadow:0 0 20px rgba(0,212,255,0.2);
}
.header-controls{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.project-select{
  padding:8px 14px;
  border:1px solid var(--border);
  border-radius:10px;
  background:#0b1124;
  color:var(--text);
  font-size:0.84rem;
  font-weight:600;
  min-width:190px;
}
.project-select:focus{outline:none;border-color:var(--accent)}

/* ── Top Bento Telemetry Bar (NumberTicker + AnimatedCircularProgressBar) ── */
.bento-telemetry{
  display:grid;
  grid-template-columns:repeat(6,minmax(160px,1fr));
  gap:12px;
  padding:14px 28px;
  background:rgba(7,11,22,0.7);
  border-bottom:1px solid var(--border);
}
@media(max-width:1200px){.bento-telemetry{grid-template-columns:repeat(3,1fr)}}
@media(max-width:680px){.bento-telemetry{grid-template-columns:repeat(2,1fr)}}
.telemetry-tile{
  padding:12px 15px;
  border-radius:12px;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
}
.telemetry-label{font-size:0.72rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--muted);font-weight:600}
.telemetry-val{font-size:1.4rem;font-weight:800;font-family:'JetBrains Mono',monospace;margin-top:2px;color:#fff}
.telemetry-sub{font-size:0.7rem;color:var(--muted);margin-top:2px}
.circular-gauge{width:44px;height:44px;flex-shrink:0;transform:rotate(-90deg)}
.circular-gauge circle{fill:none;stroke-width:4.5;stroke-linecap:round;transition:stroke-dashoffset 0.8s cubic-bezier(.16,1,.3,1)}

/* ── Navigation Tabs ── */
.nav-tabs{
  display:flex;
  gap:6px;
  padding:12px 28px 0;
  border-bottom:1px solid var(--border);
  background:rgba(8,12,26,0.55);
  overflow-x:auto;
}
.nav-tab{
  padding:11px 18px;
  border:none;
  background:transparent;
  color:var(--muted);
  font-size:0.85rem;
  font-weight:700;
  border-bottom:2px solid transparent;
  display:inline-flex;
  align-items:center;
  gap:8px;
  white-space:nowrap;
  transition:all 0.2s ease;
}
.nav-tab:hover{color:var(--text);background:rgba(255,255,255,0.03);border-radius:10px 10px 0 0}
.nav-tab.active{
  color:var(--accent);
  border-bottom-color:var(--accent);
  background:linear-gradient(180deg,transparent,rgba(0,212,255,0.08));
}

/* ── Main Container & Bento Grids ── */
.container{max-width:1540px;width:100%;margin:0 auto;padding:24px 28px;flex:1}
.bento-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(350px,1fr));gap:18px}
.section-header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px;flex-wrap:wrap}
.section-title{font-size:1.2rem;font-weight:800;display:flex;align-items:center;gap:10px}

/* ── Badges & Status Dots ── */
.badge{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:999px;font-size:0.72rem;font-weight:700}
.badge-active{background:rgba(16,185,129,0.16);color:#34d399;border:1px solid rgba(16,185,129,0.35)}
.badge-running{background:rgba(245,158,11,0.18);color:#fbbf24;border:1px solid rgba(245,158,11,0.4)}
.badge-paused{background:rgba(148,163,184,0.16);color:#cbd5e1;border:1px solid rgba(148,163,184,0.3)}
.badge-error{background:rgba(239,68,68,0.18);color:#f87171;border:1px solid rgba(239,68,68,0.4)}
.badge-urgent{background:rgba(239,68,68,0.22);color:#fca5a5;border:1px solid rgba(239,68,68,0.5);box-shadow:0 0 12px rgba(239,68,68,0.3)}

.status-dot{width:9px;height:9px;border-radius:50%;display:inline-block}
.status-dot.running{background:var(--warning);box-shadow:0 0 10px var(--warning);animation:pulseDot 1.4s infinite}
.status-dot.idle{background:var(--success);box-shadow:0 0 6px rgba(16,185,129,0.5)}
.status-dot.paused{background:var(--muted)}
.status-dot.error{background:var(--error);box-shadow:0 0 8px var(--error)}
@keyframes pulseDot{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.4;transform:scale(1.25)}}

/* ── Topology Studio: AnimatedBeam SVG & OrbitingCircles ── */
.topology-bar{
  display:flex;
  gap:8px;
  flex-wrap:wrap;
  margin-bottom:16px;
}
.topo-pill{
  padding:8px 14px;
  border-radius:12px;
  border:1px solid var(--border);
  background:rgba(15,23,42,0.7);
  color:var(--muted);
  font-size:0.8rem;
  font-weight:700;
  transition:all 0.2s;
}
.topo-pill:hover{border-color:var(--accent);color:var(--text)}
.topo-pill.active{
  background:linear-gradient(135deg,rgba(0,212,255,0.18),rgba(158,122,255,0.22));
  border-color:var(--accent);
  color:#fff;
  box-shadow:0 0 20px rgba(0,212,255,0.2);
}
.topology-stage{
  position:relative;
  width:100%;
  min-height:540px;
  border-radius:var(--radius);
  background:radial-gradient(circle at 50% 50%,rgba(24,34,70,0.55) 0%,rgba(7,10,22,0.92) 100%);
  border:1px solid var(--border);
  overflow:hidden;
}
.beam-svg{
  width:100%;
  height:540px;
  display:block;
}
.beam-edge-base{
  fill:none;
  stroke:rgba(148,163,184,0.18);
  stroke-width:1.75;
}
.beam-edge-glow{
  fill:none;
  stroke-width:2.6;
  stroke-linecap:round;
  stroke-dasharray:14 10;
  animation:beamFlow 1.8s linear infinite;
}
@keyframes beamFlow{to{stroke-dashoffset:-48}}

/* OrbitingCircles View */
.orbit-stage{
  position:relative;
  width:100%;
  height:560px;
  display:flex;
  align-items:center;
  justify-content:center;
  overflow:hidden;
}
.orbit-ring{
  position:absolute;
  border-radius:50%;
  border:1px dashed rgba(148,163,184,0.22);
  pointer-events:none;
}
.orbit-core{
  position:relative;
  z-index:10;
  width:118px;
  height:118px;
  border-radius:50%;
  background:radial-gradient(circle,#1e1b4b 0%,#0f172a 100%);
  border:2px solid var(--accent);
  box-shadow:0 0 40px rgba(0,212,255,0.35),inset 0 0 20px rgba(158,122,255,0.4);
  display:flex;
  flex-direction:column;
  align-items:center;
  justify-content:center;
  text-align:center;
  cursor:pointer;
  padding:8px;
}
.orbit-satellite{
  position:absolute;
  width:52px;
  height:52px;
  margin-left:-26px;
  margin-top:-26px;
  border-radius:50%;
  background:rgba(15,23,42,0.92);
  border:1.5px solid rgba(0,212,255,0.45);
  box-shadow:0 0 16px rgba(0,212,255,0.22);
  display:flex;
  flex-direction:column;
  align-items:center;
  justify-content:center;
  cursor:pointer;
  z-index:8;
  animation:orbitSpin var(--orbit-duration,28s) linear infinite;
  animation-direction:var(--orbit-dir,normal);
  transition:border-color 0.2s;
}
.orbit-satellite:hover{
  border-color:#fe8bbb;
  box-shadow:0 0 24px rgba(254,139,187,0.65);
  z-index:20;
}
.orbit-satellite-label{
  position:absolute;
  top:54px;
  white-space:nowrap;
  font-size:0.65rem;
  font-weight:700;
  background:rgba(5,8,18,0.88);
  padding:2px 6px;
  border-radius:6px;
  border:1px solid var(--border);
  color:var(--text);
}
@keyframes orbitSpin{
  from{transform:rotate(var(--start-angle,0deg)) translateX(var(--orbit-radius,140px)) rotate(calc(-1 * var(--start-angle,0deg)))}
  to{transform:rotate(calc(var(--start-angle,0deg) + 360deg)) translateX(var(--orbit-radius,140px)) rotate(calc(-1 * (var(--start-angle,0deg) + 360deg)))}
}

/* ── Agent Inspector Drawer ── */
.inspector-drawer{
  position:fixed;
  top:0;
  right:0;
  width:460px;
  max-width:95vw;
  height:100vh;
  background:rgba(10,15,30,0.96);
  backdrop-filter:blur(24px);
  border-left:1px solid rgba(0,212,255,0.3);
  box-shadow:-16px 0 50px rgba(0,0,0,0.65);
  z-index:90;
  padding:24px;
  overflow-y:auto;
  transform:translateX(105%);
  transition:transform 0.3s cubic-bezier(.16,1,.3,1);
}
.inspector-drawer.open{transform:translateX(0)}

/* ── Magic UI Terminal Component ── */
.magic-terminal{
  background:#040711;
  border:1px solid rgba(148,163,184,0.22);
  border-radius:14px;
  overflow:hidden;
  box-shadow:0 16px 40px rgba(0,0,0,0.5);
}
.terminal-header{
  display:flex;
  align-items:center;
  justify-content:space-between;
  padding:10px 16px;
  background:#0b1021;
  border-bottom:1px solid var(--border);
  gap:10px;
  flex-wrap:wrap;
}
.traffic-lights{display:flex;gap:7px;align-items:center}
.traffic-dot{width:12px;height:12px;border-radius:50%}
.traffic-dot.red{background:#ff5f56}
.traffic-dot.yellow{background:#ffbd2e}
.traffic-dot.green{background:#27c93f}
.terminal-body{
  padding:16px;
  font-family:'JetBrains Mono','Cascadia Code','Fira Code',monospace;
  font-size:0.78rem;
  line-height:1.6;
  color:#cbd5e1;
  max-height:420px;
  overflow-y:auto;
  white-space:pre-wrap;
  word-break:break-word;
}
.log-ts{color:#64748b}
.log-ok{color:#34d399;font-weight:600}
.log-warn{color:#fbbf24;font-weight:600}
.log-err{color:#f87171;font-weight:700}
.log-cmd{color:#38bdf8}

/* ── Utility Score Bar ── */
.utility-bar-track{
  width:100%;
  height:6px;
  background:rgba(148,163,184,0.14);
  border-radius:999px;
  overflow:hidden;
  margin-top:6px;
}
.utility-bar-fill{
  height:100%;
  border-radius:999px;
  background:linear-gradient(90deg,#00d4ff,#9e7aff,#fe8bbb);
  transition:width 0.5s ease;
}

/* ── Modals & Forms ── */
.overlay{
  position:fixed;
  inset:0;
  background:rgba(3,6,15,0.78);
  backdrop-filter:blur(8px);
  z-index:100;
  display:flex;
  align-items:flex-start;
  justify-content:center;
  padding:36px 16px;
  overflow-y:auto;
}
.modal{
  background:#0e152b;
  border:1px solid rgba(0,212,255,0.3);
  border-radius:18px;
  width:100%;
  max-width:720px;
  padding:28px;
  box-shadow:0 24px 60px rgba(0,0,0,0.65);
}
.modal h2{font-size:1.25rem;margin-bottom:18px;display:flex;align-items:center;gap:10px}
.field{margin-bottom:14px}
.field label{display:block;font-size:0.8rem;font-weight:600;color:var(--muted);margin-bottom:5px}
.field input[type=text],.field input[type=number],.field select,.field textarea{
  width:100%;
  padding:9px 13px;
  border:1px solid var(--border);
  border-radius:10px;
  background:#060a17;
  color:var(--text);
  font-size:0.86rem;
}
.field input:focus,.field select:focus,.field textarea:focus{outline:none;border-color:var(--accent)}
.field textarea{min-height:88px;resize:vertical}
.field-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.field-row-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}
.checks{display:grid;grid-template-columns:repeat(auto-fill,minmax(195px,1fr));gap:7px;max-height:190px;overflow-y:auto;padding:8px;border:1px solid var(--border);border-radius:10px;background:#060a17}
.checks label{display:flex;align-items:center;gap:7px;font-size:0.8rem;color:var(--text);cursor:pointer;margin:0}
.modal-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:20px;padding-top:14px;border-top:1px solid var(--border)}

/* ── Markdown Viewer ── */
.md-viewer{
  background:#060a17;
  border:1px solid var(--border);
  border-radius:12px;
  padding:20px;
  font-size:0.86rem;
  line-height:1.68;
  color:#e2e8f0;
  max-height:540px;
  overflow-y:auto;
}
.md-viewer h1,.md-viewer h2,.md-viewer h3{color:#fff;margin:14px 0 8px}
.md-viewer h1{font-size:1.25rem;border-bottom:1px solid var(--border);padding-bottom:6px}
.md-viewer h2{font-size:1.05rem;color:var(--accent)}
.md-viewer h3{font-size:0.94rem;color:#c084fc}
.md-viewer pre{background:#02040a;padding:12px;border-radius:8px;border:1px solid var(--border);overflow-x:auto;font-family:'JetBrains Mono',monospace;font-size:0.78rem;margin:10px 0}
.md-viewer code{font-family:'JetBrains Mono',monospace;background:rgba(158,122,255,0.14);padding:1px 5px;border-radius:4px;font-size:0.8rem}
.md-viewer ul{padding-left:20px;margin:8px 0}

/* ── Toast ── */
.toast-container{position:fixed;bottom:22px;right:22px;z-index:200;display:flex;flex-direction:column;gap:8px}
.toast{padding:11px 18px;border-radius:10px;font-size:0.84rem;font-weight:700;color:#fff;box-shadow:0 8px 25px rgba(0,0,0,0.45)}
.toast-success{background:linear-gradient(135deg,#059669,#10b981)}
.toast-error{background:linear-gradient(135deg,#dc2626,#ef4444)}
</style>
</head>
<body>

<canvas id="magic-bg-canvas"></canvas>
<div class="ambient-orb ambient-orb-1"></div>
<div class="ambient-orb ambient-orb-2"></div>

<div class="app-shell">
  <!-- Header -->
  <header class="header">
    <div class="brand">
      <div class="brand-logo">🐝</div>
      <div>
        <div style="display:flex;align-items:center;gap:10px">
          <h1 class="hyper-text aurora-text" id="hyper-title" data-value="COPILOT HIVE v2.0" onmouseenter="scrambleHyperText(this)">COPILOT HIVE v2.0</h1>
          <span class="aurora-badge">✨ Magic UI Swarm Studio</span>
        </div>
        <div style="font-size:0.76rem;color:var(--muted);margin-top:2px">14-Agent Autonomous Engineering Swarm · Hybrid BM25+Trigram+RRF Context-Mode</div>
      </div>
    </div>

    <div class="header-controls">
      <select id="project-selector" class="project-select" onchange="onProjectSelect(this.value)">
        <option value="default">🌐 Global Workspace (default)</option>
      </select>
      <button class="shimmer-btn" onclick="triggerSmartDispatch()">
        <span>⚡ Dispatch Swarm Tick</span>
      </button>
      <button class="shimmer-btn" onclick="showAddModal()">
        <span>＋ New Project</span>
      </button>
    </div>
  </header>

  <!-- Bento Telemetry Bar (NumberTicker + AnimatedCircularProgressBar) -->
  <section class="bento-telemetry" id="bento-telemetry">
    <div class="magic-card telemetry-tile">
      <div>
        <div class="telemetry-label">Active Projects</div>
        <div class="telemetry-val" id="ticker-projects">0</div>
        <div class="telemetry-sub" id="sub-projects">Multi-project registry</div>
      </div>
      <div id="gauge-projects"></div>
    </div>
    <div class="magic-card telemetry-tile">
      <div>
        <div class="telemetry-label">Running Agents</div>
        <div class="telemetry-val" id="ticker-running">0</div>
        <div class="telemetry-sub" id="sub-running">14 specialists online</div>
      </div>
      <div id="gauge-running"></div>
    </div>
    <div class="magic-card telemetry-tile">
      <div>
        <div class="telemetry-label">Swarm Health</div>
        <div class="telemetry-val"><span id="ticker-health">98</span>%</div>
        <div class="telemetry-sub" id="sub-health">Self-healing active</div>
      </div>
      <div id="gauge-health"></div>
    </div>
    <div class="magic-card telemetry-tile">
      <div>
        <div class="telemetry-label">Context-Mode Savings</div>
        <div class="telemetry-val"><span id="ticker-savings">85</span>%</div>
        <div class="telemetry-sub" id="sub-savings">0 tokens saved</div>
      </div>
      <div id="gauge-savings"></div>
    </div>
    <div class="magic-card telemetry-tile">
      <div>
        <div class="telemetry-label">Ideas & Urgent Bugs</div>
        <div class="telemetry-val" id="ticker-ideas">0</div>
        <div class="telemetry-sub" id="sub-ideas">ICE prioritized queue</div>
      </div>
      <div id="gauge-ideas"></div>
    </div>
    <div class="magic-card telemetry-tile">
      <div>
        <div class="telemetry-label">KB Chunks Indexed</div>
        <div class="telemetry-val" id="ticker-chunks">0</div>
        <div class="telemetry-sub" id="sub-chunks">BM25 + Trigram + RRF</div>
      </div>
      <div id="gauge-chunks"></div>
    </div>
  </section>

  <!-- 5 Navigation Tabs -->
  <nav class="nav-tabs" id="nav-tabs">
    <button class="nav-tab active" data-tab="command" onclick="switchTab('command')">🚀 Command Center</button>
    <button class="nav-tab" data-tab="topology" onclick="switchTab('topology')">🕸️ Topology & Orchestrator Studio</button>
    <button class="nav-tab" data-tab="agents" onclick="switchTab('agents')">🤖 14-Agent Matrix & Live Terminal</button>
    <button class="nav-tab" data-tab="ideas" onclick="switchTab('ideas')">💡 Ideas, Bugs & Research Vault</button>
    <button class="nav-tab" data-tab="context" onclick="switchTab('context')">🧠 Context-Mode Knowledge & Sandbox</button>
  </nav>

  <!-- Main View Container -->
  <main class="container" id="app"></main>
</div>

<!-- Agent Inspector Slide-Over Drawer -->
<aside class="inspector-drawer" id="inspector-drawer"></aside>

<!-- Toast Container -->
<div class="toast-container" id="toasts"></div>

<script>
const API = '';
let activeTab = 'command';
let selectedProject = 'default';
let currentDetailProject = null;
let topologyViewMode = 'beam'; // 'beam' | 'orbit'
let activeTopologyId = 'adaptive-swarm';
let cachedTopologies = null;
let cachedAgents = {};
let cachedResearch = null;
let cachedPrompts = [];
let terminalAgent = 'setup';
let terminalAutoScroll = true;
let terminalPollTimer = null;
const tickerState = {};

const AGENT_META = {
  dispatcher: { name: 'Orchestrator Hub', icon: '🧠', category: 'orchestrator', ring: 0, color: '#a855f7' },
  improve: { name: 'Feature Engineer', icon: '🔧', category: 'pipeline', ring: 1, color: '#3b82f6' },
  deployer: { name: 'Release Engineer', icon: '🚀', category: 'pipeline', ring: 1, color: '#06b6d4' },
  regressiontest: { name: 'QA Sentinel', icon: '🧪', category: 'verification', ring: 1, color: '#10b981' },
  audit: { name: 'Code & Security Auditor', icon: '🔍', category: 'verification', ring: 1, color: '#f59e0b' },
  gitguardian: { name: 'Secret & Repo Guardian', icon: '🛡️', category: 'security', ring: 2, color: '#ef4444' },
  emergencyfixer: { name: 'Incident Responder', icon: '🚑', category: 'emergency', ring: 2, color: '#dc2626' },
  radical: { name: 'Radical Visionary', icon: '🔥', category: 'research', ring: 3, color: '#f97316' },
  'architect-api': { name: 'Systems & API Architect', icon: '⚙️', category: 'research', ring: 3, color: '#0ea5e9' },
  'designer-web': { name: 'Web UI/UX Designer', icon: '🎨', category: 'research', ring: 3, color: '#ec4899' },
  'designer-portal': { name: 'Portal & Dashboard Designer', icon: '🖥️', category: 'research', ring: 3, color: '#8b5cf6' },
  lawyer: { name: 'Legal & IP Counsel', icon: '⚖️', category: 'governance', ring: 3, color: '#eab308' },
  compliance: { name: 'Compliance Officer', icon: '📋', category: 'governance', ring: 3, color: '#14b8a6' },
  reporter: { name: 'Executive Reporter', icon: '📊', category: 'telemetry', ring: 2, color: '#6366f1' }
};

function agentLabel(a) { return (AGENT_META[a] && AGENT_META[a].name) || a; }
function agentIcon(a) { return (AGENT_META[a] && AGENT_META[a].icon) || '🤖'; }
function esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

// ── Magic UI 1: Particles + FlickeringGrid Canvas ─────────────────
(function initMagicCanvas() {
  const canvas = document.getElementById('magic-bg-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let w = canvas.width = window.innerWidth;
  let h = canvas.height = window.innerHeight;
  let mouse = { x: -1000, y: -1000 };

  window.addEventListener('resize', () => {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
  });
  window.addEventListener('pointermove', e => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    // Update MagicCard spotlight coordinates
    document.querySelectorAll('.magic-card').forEach(card => {
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mouse-x', (e.clientX - r.left) + 'px');
      card.style.setProperty('--mouse-y', (e.clientY - r.top) + 'px');
    });
  });

  // RippleButton effect delegation
  document.addEventListener('click', e => {
    const btn = e.target.closest('.ripple-btn');
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const circle = document.createElement('span');
    const d = Math.max(r.width, r.height);
    circle.style.width = circle.style.height = d + 'px';
    circle.style.left = (e.clientX - r.left - d / 2) + 'px';
    circle.style.top = (e.clientY - r.top - d / 2) + 'px';
    circle.className = 'ripple-circle';
    btn.appendChild(circle);
    setTimeout(() => circle.remove(), 600);
  });

  const particles = Array.from({ length: 55 }, () => ({
    x: Math.random() * w,
    y: Math.random() * h,
    vx: (Math.random() - 0.5) * 0.45,
    vy: (Math.random() - 0.5) * 0.45,
    r: Math.random() * 1.8 + 0.7,
    alpha: Math.random() * 0.55 + 0.2
  }));

  function draw() {
    ctx.clearRect(0, 0, w, h);
    // Subtle FlickeringGrid dots
    const spacing = 44;
    ctx.fillStyle = 'rgba(148,163,184,0.06)';
    for (let gx = 0; gx < w; gx += spacing) {
      for (let gy = 0; gy < h; gy += spacing) {
        if (((gx + gy) % 88 === 0) && Math.random() > 0.992) {
          ctx.fillStyle = 'rgba(0,212,255,0.22)';
          ctx.fillRect(gx, gy, 2, 2);
          ctx.fillStyle = 'rgba(148,163,184,0.06)';
        } else {
          ctx.fillRect(gx, gy, 1, 1);
        }
      }
    }

    // Magnetic Particles
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0) p.x = w;
      if (p.x > w) p.x = 0;
      if (p.y < 0) p.y = h;
      if (p.y > h) p.y = 0;

      const dx = mouse.x - p.x;
      const dy = mouse.y - p.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 160 && dist > 1) {
        p.x += (dx / dist) * 0.65;
        p.y += (dy / dist) * 0.65;
      }

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,212,255,' + p.alpha + ')';
      ctx.fill();

      for (let j = i + 1; j < particles.length; j++) {
        const p2 = particles[j];
        const d2 = Math.hypot(p.x - p2.x, p.y - p2.y);
        if (d2 < 110) {
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.strokeStyle = 'rgba(158,122,255,' + (0.12 * (1 - d2 / 110)) + ')';
          ctx.lineWidth = 0.7;
          ctx.stroke();
        }
      }
    }
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
})();

// ── Magic UI 2: HyperText Scramble Animation ──────────────────────
function scrambleHyperText(el) {
  if (!el || el.dataset.animating === '1') return;
  const target = el.dataset.value || el.textContent;
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*+';
  let iteration = 0;
  el.dataset.animating = '1';
  const iv = setInterval(() => {
    el.textContent = target
      .split('')
      .map((ch, idx) => {
        if (ch === ' ' || ch === '.') return ch;
        if (idx < iteration) return target[idx];
        return chars[Math.floor(Math.random() * chars.length)];
      })
      .join('');
    iteration += 0.6;
    if (iteration >= target.length) {
      el.textContent = target;
      el.dataset.animating = '0';
      clearInterval(iv);
    }
  }, 24);
}

// ── Magic UI 3: NumberTicker & AnimatedCircularProgressBar ────────
function animateNumberTicker(id, targetValue) {
  const el = document.getElementById(id);
  if (!el) return;
  const target = Number(targetValue) || 0;
  const start = tickerState[id] !== undefined ? tickerState[id] : 0;
  tickerState[id] = target;
  if (start === target) { el.textContent = target; return; }
  const duration = 650;
  const t0 = performance.now();
  function tick(now) {
    const p = Math.min(1, (now - t0) / duration);
    const eased = 1 - Math.pow(1 - p, 3);
    const val = Math.round(start + (target - start) * eased);
    el.textContent = val;
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function renderCircularGauge(containerId, percent, color = '#00d4ff') {
  const el = document.getElementById(containerId);
  if (!el) return;
  const pct = Math.max(0, Math.min(100, Number(percent) || 0));
  const r = 18;
  const c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;
  el.innerHTML = \`
    <svg class="circular-gauge" viewBox="0 0 44 44">
      <circle cx="22" cy="22" r="\${r}" stroke="rgba(148,163,184,0.16)"></circle>
      <circle cx="22" cy="22" r="\${r}" stroke="\${color}" stroke-dasharray="\${c.toFixed(1)}" stroke-dashoffset="\${offset.toFixed(1)}"></circle>
    </svg>\`;
}

// ── Toast & API Helper ────────────────────────────────────────────
function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

async function api(path, opts) {
  try {
    const r = await fetch(API + path, opts);
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e.error || r.statusText);
    }
    return r.json();
  } catch (e) {
    toast(e.message, 'error');
    throw e;
  }
}

function timeAgo(iso) {
  if (!iso) return 'never';
  const diff = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diff < 60) return diff + 's ago';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}

function formatBytes(b) {
  const n = Number(b) || 0;
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(2) + ' MB';
}

// ── Top Telemetry Bar Refresh ─────────────────────────────────────
async function updateBentoTelemetry() {
  const pid = selectedProject || 'default';
  try {
    const [projects, agentsRes, ideasRes, cmStats] = await Promise.all([
      api('/api/projects').catch(() => []),
      api('/api/projects/' + encodeURIComponent(pid) + '/agents').catch(() => ({ agents: {}, health_score: 96 })),
      api('/api/projects/' + encodeURIComponent(pid) + '/ideas').catch(() => ({ stats: { total: 0, urgent: 0 } })),
      api('/api/context-mode/stats?project=' + encodeURIComponent(pid)).catch(() => ({ savingsRatioPercent: 85, estimatedTokensSaved: 0, totalChunks: 0 }))
    ]);

    cachedAgents = agentsRes.agents || {};
    const agentList = Object.values(cachedAgents);
    const runningCount = agentList.filter(a => a.status === 'running').length;
    const enabledCount = agentList.filter(a => a.enabled !== false && !a.paused).length;
    const healthScore = agentsRes.health_score ?? 96;
    const savingsPct = Math.round(cmStats.savingsRatioPercent || 85);
    const totalIdeas = (ideasRes.stats && ideasRes.stats.total) || 0;
    const urgentIdeas = (ideasRes.stats && ideasRes.stats.urgent) || 0;
    const totalChunks = cmStats.totalChunks || 0;

    animateNumberTicker('ticker-projects', projects.length || 1);
    document.getElementById('sub-projects').textContent = projects.length
      ? projects.filter(p => p.setup_status === 'complete').length + ' active in registry'
      : 'Global workspace active';
    renderCircularGauge('gauge-projects', Math.min(100, Math.max(25, projects.length * 25)), '#00d4ff');

    animateNumberTicker('ticker-running', runningCount);
    document.getElementById('sub-running').textContent = enabledCount + '/14 specialists ready';
    renderCircularGauge('gauge-running', Math.round((enabledCount / 14) * 100), '#f59e0b');

    animateNumberTicker('ticker-health', healthScore);
    document.getElementById('sub-health').textContent = 'Next: ' + agentLabel(agentsRes.recommended_next || 'improve');
    renderCircularGauge('gauge-health', healthScore, '#10b981');

    animateNumberTicker('ticker-savings', savingsPct);
    document.getElementById('sub-savings').textContent = (cmStats.estimatedTokensSaved || 0).toLocaleString() + ' est. tokens saved';
    renderCircularGauge('gauge-savings', savingsPct, '#9e7aff');

    animateNumberTicker('ticker-ideas', totalIdeas);
    document.getElementById('sub-ideas').textContent = urgentIdeas > 0 ? ('🚨 ' + urgentIdeas + ' URGENT override(s)') : 'ICE queue healthy';
    renderCircularGauge('gauge-ideas', Math.min(100, totalIdeas * 12 + (urgentIdeas * 30)), urgentIdeas > 0 ? '#ef4444' : '#fe8bbb');

    animateNumberTicker('ticker-chunks', totalChunks);
    document.getElementById('sub-chunks').textContent = (cmStats.codeChunks || 0) + ' code / ' + (cmStats.proseChunks || 0) + ' prose';
    renderCircularGauge('gauge-chunks', Math.min(100, totalChunks * 4), '#38bdf8');
  } catch {}
}

async function populateProjectSelector() {
  const sel = document.getElementById('project-selector');
  if (!sel) return;
  let projects = [];
  try { projects = await api('/api/projects'); } catch { return; }
  sel.innerHTML = '<option value="default">🌐 Global Workspace (default)</option>';
  for (const p of projects) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = '📦 ' + (p.name || p.id);
    if (p.id === selectedProject) opt.selected = true;
    sel.appendChild(opt);
  }
}

function onProjectSelect(pid) {
  selectedProject = pid || 'default';
  currentDetailProject = null;
  render();
}

function switchTab(tab) {
  activeTab = tab;
  currentDetailProject = null;
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  render();
}

function render() {
  stopTerminalPolling();
  populateProjectSelector();
  updateBentoTelemetry();
  if (activeTab === 'command') {
    if (currentDetailProject) renderProjectDetail(currentDetailProject);
    else renderCommandCenter();
  } else if (activeTab === 'topology') {
    renderTopologyStudio();
  } else if (activeTab === 'agents') {
    renderAgentMatrixAndTerminal();
  } else if (activeTab === 'ideas') {
    renderIdeasAndResearchVault();
  } else if (activeTab === 'context') {
    renderContextModeStudio();
  }
}

// ══════════════════════════════════════════════════════════════════
// TAB 1: 🚀 Command Center (Bento Grid & Projects)
// ══════════════════════════════════════════════════════════════════
async function renderCommandCenter() {
  const app = document.getElementById('app');
  const pid = selectedProject || 'default';
  const [projects, topoData] = await Promise.all([
    api('/api/projects').catch(() => []),
    api('/api/topologies?project=' + encodeURIComponent(pid)).catch(() => null)
  ]);

  const recAgent = (topoData && topoData.recommendedAgent) || 'improve';
  const recReason = (topoData && topoData.reason) || 'Multi-factor utility optimization active';
  const activeTopoName = (topoData && topoData.topologyName) || 'Adaptive Utility-Scored Swarm';

  let html = \`
  <!-- Hero Orchestrator Banner -->
  <div class="magic-card" style="margin-bottom:22px;padding:24px;border-color:rgba(0,212,255,0.28)">
    <div class="border-beam"></div>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap">
      <div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
          <span class="aurora-badge">🧠 Active Topology: \${esc(activeTopoName)}</span>
          <span class="badge badge-active">14 Agents Ready</span>
        </div>
        <h2 style="font-size:1.3rem;font-weight:800">Next Recommended Dispatch: <span class="aurora-text">\${agentIcon(recAgent)} \${esc(agentLabel(recAgent))} (\${esc(recAgent)})</span></h2>
        <p style="font-size:0.84rem;color:var(--muted);margin-top:4px">\${esc(recReason)}</p>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="shimmer-btn" onclick="runAgent('\${esc(pid)}','\${esc(recAgent)}')">
          <span>▶ Launch \${esc(agentLabel(recAgent))}</span>
        </button>
        <button class="ripple-btn" onclick="switchTab('topology')">🕸️ Open Topology Studio</button>
        <button class="ripple-btn" onclick="switchTab('context')">🧠 Context-Mode Sandbox</button>
      </div>
    </div>
  </div>

  <div class="section-header">
    <div class="section-title">📦 Registered Swarm Projects</div>
    <button class="ripple-btn" onclick="showAddModal()">＋ Register Project</button>
  </div>\`;

  if (!projects.length) {
    html += \`
    <div class="magic-card" style="text-align:center;padding:48px 24px;margin-bottom:24px">
      <div style="font-size:2.6rem;margin-bottom:10px">🐝</div>
      <h3 style="font-size:1.15rem;margin-bottom:6px">Global Workspace Active — No Secondary Projects Registered Yet</h3>
      <p style="color:var(--muted);font-size:0.86rem;max-width:560px;margin:0 auto 18px">
        Copilot Hive is currently operating on the default workspace with all 14 autonomous agents. Add a local repository or GitHub project to isolate per-project topologies, logs, and knowledge bases.
      </p>
      <div style="display:flex;justify-content:center;gap:10px">
        <button class="shimmer-btn" onclick="showAddModal()"><span>＋ Add First Project</span></button>
        <button class="ripple-btn" onclick="switchTab('agents')">🤖 View 14-Agent Matrix</button>
      </div>
    </div>\`;
  } else {
    html += '<div class="bento-grid" style="margin-bottom:26px">';
    for (const p of projects) {
      const isRunning = p.setup_status === 'running';
      const stBadge = p.paused
        ? '<span class="badge badge-paused">⏸ Paused</span>'
        : p.setup_status === 'complete'
        ? '<span class="badge badge-active">✅ Active</span>'
        : isRunning
        ? '<span class="badge badge-running">🔄 Setting up</span>'
        : '<span class="badge badge-error">❌ Error</span>';
      const agentCount = (p.agents || []).length || 14;
      const topo = p.topology || 'adaptive-swarm';
      html += \`
      <div class="magic-card">
        \${isRunning ? '<div class="border-beam"></div>' : ''}
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:8px">
          <div>
            <div style="font-size:1.08rem;font-weight:800;display:flex;align-items:center;gap:8px">📦 \${esc(p.name)}</div>
            <div style="font-size:0.76rem;color:var(--muted);font-family:monospace;margin-top:2px">\${esc(p.path || '/opt/projects/' + p.id)}</div>
          </div>
          \${stBadge}
        </div>
        <p style="font-size:0.83rem;color:var(--muted);margin-bottom:14px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">\${esc(p.description || 'Autonomous software engineering project.')}</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
          <span class="aurora-badge">🕸️ \${esc(topo)}</span>
          <span class="badge badge-paused">🤖 \${agentCount} agents</span>
          \${p.health_url ? '<span class="badge badge-paused">🩺 ' + esc(p.health_url) + '</span>' : ''}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="ripple-btn" onclick="openProjectDetail('\${esc(p.id)}')">🔍 Inspect</button>
          <button class="ripple-btn" onclick="selectedProject='\${esc(p.id)}';switchTab('topology')">🕸️ Topology</button>
          <button class="ripple-btn" onclick="showEditModal('\${esc(p.id)}')">✏️ Edit</button>
          <button class="ripple-btn" onclick="toggleProjectPause('\${esc(p.id)}')">\${p.paused ? '▶ Resume' : '⏸ Pause'}</button>
          <button class="ripple-btn danger" onclick="deleteProject('\${esc(p.id)}')">✕</button>
        </div>
      </div>\`;
    }
    html += '</div>';
  }

  // Quick 14-Agent Bento Snapshot
  const agentsRes = await api('/api/projects/' + encodeURIComponent(pid) + '/agents').catch(() => ({ agents: {} }));
  const agents = agentsRes.agents || {};
  html += \`
  <div class="section-header">
    <div class="section-title">🤖 Live 14-Agent Utility Pulse (\${esc(pid)})</div>
    <button class="ripple-btn" onclick="switchTab('agents')">Open Full Matrix & Terminal →</button>
  </div>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px">\`;

  for (const [id, info] of Object.entries(agents)) {
    const isRun = info.status === 'running';
    const dotClass = isRun ? 'running' : info.paused ? 'paused' : 'idle';
    html += \`
    <div class="magic-card" style="padding:14px;cursor:pointer" onclick="openAgentInspector('\${esc(id)}')">
      \${isRun ? '<div class="border-beam"></div>' : ''}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <span style="font-weight:700;font-size:0.86rem">\${esc(info.icon)} \${esc(info.name)}</span>
        <span class="status-dot \${dotClass}"></span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:0.74rem;color:var(--muted)">
        <span>\${esc(info.category)}</span>
        <span style="color:var(--accent);font-weight:700">U=\${info.utility_score}/100</span>
      </div>
      <div class="utility-bar-track"><div class="utility-bar-fill" style="width:\${info.utility_score}%"></div></div>
    </div>\`;
  }
  html += '</div>';
  app.innerHTML = html;
}

async function openProjectDetail(id) {
  selectedProject = id;
  currentDetailProject = id;
  populateProjectSelector();
  renderProjectDetail(id);
}

async function renderProjectDetail(id) {
  const app = document.getElementById('app');
  const [p, logsRes, agentsRes] = await Promise.all([
    api('/api/projects/' + encodeURIComponent(id)),
    api('/api/projects/' + encodeURIComponent(id) + '/logs').catch(() => ({ logs: '' })),
    api('/api/projects/' + encodeURIComponent(id) + '/agents').catch(() => ({ agents: {} }))
  ]);
  const containers = p.containers || (p.docker && p.docker.containers) || {};
  const agents = agentsRes.agents || {};

  let html = \`
  <div style="margin-bottom:14px">
    <button class="ripple-btn" onclick="currentDetailProject=null;renderCommandCenter()">← Back to Command Center</button>
  </div>
  <div class="magic-card" style="margin-bottom:20px">
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:16px">
      <div>
        <h2 style="font-size:1.35rem;font-weight:800">📦 \${esc(p.name)} <span class="aurora-badge">\${esc(p.topology || 'adaptive-swarm')}</span></h2>
        <div style="font-family:monospace;font-size:0.82rem;color:var(--muted);margin-top:4px">\${esc(p.path || '')}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="ripple-btn" onclick="showEditModal('\${esc(p.id)}')">✏️ Edit Config</button>
        <button class="ripple-btn" onclick="rerunSetup('\${esc(p.id)}')">🔄 Re-run Setup</button>
        <button class="ripple-btn" onclick="toggleProjectPause('\${esc(p.id)}')">\${p.paused ? '▶ Resume Project' : '⏸ Pause Project'}</button>
        <button class="ripple-btn danger" onclick="deleteProject('\${esc(p.id)}')">🗑 Delete</button>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;font-size:0.84rem;margin-bottom:16px">
      <div><span style="color:var(--muted)">GitHub Repo:</span> <strong>\${esc(p.github_repo || '—')}</strong></div>
      <div><span style="color:var(--muted)">Compose File:</span> <code>\${esc(p.compose_file || '—')}</code></div>
      <div><span style="color:var(--muted)">Health URL:</span> <code>\${esc(p.health_url || '—')}</code></div>
      <div><span style="color:var(--muted)">Containers:</span> <strong>\${Object.entries(containers).map(([k,v])=>k+':'+v).join(', ') || '—'}</strong></div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;margin-bottom:18px">
      \${Object.entries(agents).map(([aId, info]) => \`
        <div class="magic-card" style="padding:12px">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span style="font-weight:700;font-size:0.82rem">\${esc(info.icon)} \${esc(info.name)}</span>
            <span class="status-dot \${info.status === 'running' ? 'running' : info.paused ? 'paused' : 'idle'}"></span>
          </div>
          <div style="font-size:0.72rem;color:var(--muted);margin:4px 0">Utility: \${info.utility_score}/100</div>
          <div style="display:flex;gap:6px;margin-top:8px">
            <button class="ripple-btn" style="padding:4px 9px;font-size:0.72rem" onclick="runAgent('\${esc(p.id)}','\${esc(aId)}')">▶ Run</button>
            <button class="ripple-btn" style="padding:4px 9px;font-size:0.72rem" onclick="toggleAgentPause('\${esc(p.id)}','\${esc(aId)}')">\${info.paused ? 'Resume' : 'Pause'}</button>
          </div>
        </div>
      \`).join('')}
    </div>
    <div class="magic-terminal">
      <div class="terminal-header">
        <div class="traffic-lights"><span class="traffic-dot red"></span><span class="traffic-dot yellow"></span><span class="traffic-dot green"></span><span style="margin-left:8px;font-size:0.78rem;font-weight:700">setup.log — \${esc(p.id)}</span></div>
      </div>
      <div class="terminal-body">\${formatTerminalOutput(logsRes.logs || 'No setup log output yet.')}</div>
    </div>
  </div>\`;
  app.innerHTML = html;
}

// ══════════════════════════════════════════════════════════════════
// TAB 2: 🕸️ Topology & Orchestrator Studio (AnimatedBeam & OrbitingCircles)
// ══════════════════════════════════════════════════════════════════
async function renderTopologyStudio() {
  const app = document.getElementById('app');
  const pid = selectedProject || 'default';
  const data = await api('/api/topologies?project=' + encodeURIComponent(pid) + '&topology=' + encodeURIComponent(activeTopologyId)).catch(() => null);
  cachedTopologies = data;

  if (!data) {
    app.innerHTML = '<div class="magic-card">Failed to load topology engine.</div>';
    return;
  }

  activeTopologyId = data.activeTopology || activeTopologyId;
  const topologies = data.topologies || {};
  const graph = data.topologyGraph || topologies[activeTopologyId] || { nodes: [], edges: [] };
  const scores = data.agentScores || {};

  let html = \`
  <div class="section-header">
    <div>
      <div class="section-title">🕸️ Smart Orchestrator & Topology Visualizer</div>
      <div style="font-size:0.82rem;color:var(--muted);margin-top:2px">\${esc(graph.tagline || '')} · Algorithm: <strong style="color:var(--accent)">\${esc(graph.algorithm || '')}</strong></div>
    </div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <button class="ripple-btn \${topologyViewMode === 'beam' ? 'success' : ''}" onclick="topologyViewMode='beam';renderTopologyStudio()">⚡ AnimatedBeam Graph</button>
      <button class="ripple-btn \${topologyViewMode === 'orbit' ? 'success' : ''}" onclick="topologyViewMode='orbit';renderTopologyStudio()">🪐 OrbitingCircles Swarm</button>
      <button class="shimmer-btn" onclick="activateAndDispatchTopology('\${esc(activeTopologyId)}', true)">
        <span>🚀 Save & Dispatch Next (\${esc(data.recommendedAgent || 'improve')})</span>
      </button>
    </div>
  </div>

  <!-- 5-Topology Preset Switcher -->
  <div class="topology-bar">
    \${Object.values(topologies).map(t => \`
      <button class="topo-pill \${t.id === activeTopologyId ? 'active' : ''}" onclick="selectTopologyPreset('\${esc(t.id)}')">
        \${t.id === 'cyclic-pipeline' ? '🔄' : t.id === 'star-hub' ? '⭐' : t.id === 'dag-mesh' ? '🕸️' : t.id === 'adaptive-swarm' ? '🧠' : '🛡️'} \${esc(t.name)}
      </button>
    \`).join('')}
  </div>

  <div style="display:grid;grid-template-columns:1fr 360px;gap:18px;align-items:start">
    <!-- Left: Interactive Visualizer Stage -->
    <div class="topology-stage" id="topology-stage">
      \${topologyViewMode === 'beam' ? renderAnimatedBeamSVG(graph, scores, data.recommendedAgent) : renderOrbitingCirclesStage(scores, data.recommendedAgent)}
    </div>

    <!-- Right: Smart Agent Utility Scoreboard -->
    <div class="magic-card" style="max-height:540px;overflow-y:auto">
      <div class="border-beam"></div>
      <h3 style="font-size:0.95rem;font-weight:800;margin-bottom:4px">🎯 Multi-Factor Utility Scoreboard</h3>
      <p style="font-size:0.75rem;color:var(--muted);margin-bottom:12px">Click any agent to open the live Inspector Drawer</p>
      <div style="padding:10px 12px;border-radius:10px;background:rgba(0,212,255,0.08);border:1px solid rgba(0,212,255,0.28);margin-bottom:12px;font-size:0.78rem">
        <div><strong>Winner:</strong> <span class="aurora-text">\${agentIcon(data.recommendedAgent)} \${esc(agentLabel(data.recommendedAgent))}</span></div>
        <div style="color:var(--muted);margin-top:3px">\${esc(data.reason || '')}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">
        \${Object.values(scores)
          .sort((a, b) => (b.score || 0) - (a.score || 0))
          .map(s => \`
            <div style="padding:8px 10px;border-radius:10px;background:rgba(6,10,23,0.75);border:1px solid var(--border);cursor:pointer" onclick="openAgentInspector('\${esc(s.agent)}')">
              <div style="display:flex;justify-content:space-between;align-items:center;font-size:0.8rem;font-weight:700">
                <span>\${esc(s.icon)} \${esc(s.name)}</span>
                <span style="color:var(--accent);font-family:monospace">U=\${s.score}/100</span>
              </div>
              <div class="utility-bar-track"><div class="utility-bar-fill" style="width:\${s.score}%"></div></div>
              <div style="font-size:0.7rem;color:var(--muted);margin-top:4px">\${esc(s.reason || '')}</div>
            </div>
          \`).join('')}
      </div>
    </div>
  </div>\`;

  app.innerHTML = html;
}

function renderAnimatedBeamSVG(graph, scores, recommendedAgent) {
  const nodes = graph.nodes || [];
  const edges = graph.edges || [];
  const nodeMap = {};
  nodes.forEach(n => { nodeMap[n.id] = n; });

  // Central Context-Mode Knowledge Hub anchor
  const kbHub = { id: 'context-hub', x: 450, y: 40, name: 'Context-Mode KB', icon: '📚' };

  let defs = \`
    <defs>
      <linearGradient id="beam-primary" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#00d4ff" stop-opacity="0.2"/>
        <stop offset="50%" stop-color="#9e7aff" stop-opacity="0.95"/>
        <stop offset="100%" stop-color="#fe8bbb" stop-opacity="0.85"/>
      </linearGradient>
      <linearGradient id="beam-escalation" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#ef4444" stop-opacity="0.3"/>
        <stop offset="50%" stop-color="#ffaa40" stop-opacity="1"/>
        <stop offset="100%" stop-color="#ef4444" stop-opacity="0.9"/>
      </linearGradient>
      <linearGradient id="beam-knowledge" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#10b981" stop-opacity="0.25"/>
        <stop offset="50%" stop-color="#00d4ff" stop-opacity="0.9"/>
        <stop offset="100%" stop-color="#9e7aff" stop-opacity="0.8"/>
      </linearGradient>
      <filter id="glow-filter" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="3.5" result="blur"/>
        <feComposite in="SourceGraphic" in2="blur" operator="over"/>
      </filter>
    </defs>\`;

  let edgePaths = '';
  edges.forEach((e, idx) => {
    const a = nodeMap[e.from];
    const b = nodeMap[e.to];
    if (!a || !b) return;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const cx1 = a.x + dx * 0.35 - dy * 0.12;
    const cy1 = a.y + dy * 0.35 + dx * 0.12;
    const cx2 = a.x + dx * 0.65 - dy * 0.12;
    const cy2 = a.y + dy * 0.65 + dx * 0.12;
    const d = \`M \${a.x} \${a.y} C \${cx1.toFixed(1)} \${cy1.toFixed(1)}, \${cx2.toFixed(1)} \${cy2.toFixed(1)}, \${b.x} \${b.y}\`;
    const strokeUrl = e.type === 'escalation' ? 'url(#beam-escalation)' : e.type === 'knowledge' ? 'url(#beam-knowledge)' : 'url(#beam-primary)';
    edgePaths += \`
      <path d="\${d}" class="beam-edge-base"/>
      <path d="\${d}" class="beam-edge-glow" stroke="\${strokeUrl}" style="animation-delay:-\${(idx * 0.22).toFixed(2)}s"/>\`;
  });

  // Connect Orchestrator Hub to Context-Mode Knowledge Hub
  if (nodeMap.dispatcher) {
    const dHub = \`M \${kbHub.x} \${kbHub.y} L \${nodeMap.dispatcher.x} \${nodeMap.dispatcher.y}\`;
    edgePaths += \`<path d="\${dHub}" class="beam-edge-glow" stroke="url(#beam-knowledge)"/>\`;
  }

  let nodeEls = \`
    <g transform="translate(\${kbHub.x},\${kbHub.y})" style="cursor:pointer" onclick="switchTab('context')">
      <rect x="-78" y="-18" width="156" height="36" rx="18" fill="#0f172a" stroke="#00d4ff" stroke-width="1.5"/>
      <text x="0" y="5" text-anchor="middle" fill="#e2e8f0" font-size="11" font-weight="700">📚 Context-Mode KB Hub</text>
    </g>\`;

  for (const n of nodes) {
    const sc = (scores[n.id] && scores[n.id].score) ?? 65;
    const isRec = n.id === recommendedAgent;
    const agentInfo = cachedAgents[n.id] || {};
    const isPaused = agentInfo.paused;
    const isRun = agentInfo.status === 'running';
    const borderCol = isRec ? '#00d4ff' : isRun ? '#f59e0b' : isPaused ? '#64748b' : (n.color || '#9e7aff');
    const barW = Math.round((sc / 100) * 96);

    nodeEls += \`
    <g transform="translate(\${n.x},\${n.y})" style="cursor:pointer" onclick="openAgentInspector('\${esc(n.id)}')">
      \${isRec ? '<circle r="38" fill="none" stroke="#00d4ff" stroke-width="1.5" stroke-dasharray="4 4"><animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="8s" repeatCount="indefinite"/></circle>' : ''}
      <rect x="-58" y="-26" width="116" height="52" rx="12" fill="rgba(11,16,33,0.94)" stroke="\${borderCol}" stroke-width="\${isRec ? '2.4' : '1.5'}" filter="\${isRec ? 'url(#glow-filter)' : ''}"/>
      <text x="0" y="-6" text-anchor="middle" fill="#f8fafc" font-size="11" font-weight="700">\${esc(n.icon)} \${esc(n.id)}</text>
      <rect x="-48" y="6" width="96" height="5" rx="2.5" fill="rgba(148,163,184,0.18)"/>
      <rect x="-48" y="6" width="\${barW}" height="5" rx="2.5" fill="\${borderCol}"/>
      <text x="0" y="20" text-anchor="middle" fill="#94a3b8" font-size="9" font-family="monospace">U=\${sc} \${isPaused ? '⏸' : isRun ? '🔄' : ''}</text>
    </g>\`;
  }

  return \`
  <svg class="beam-svg" viewBox="0 0 920 520" preserveAspectRatio="xMidYMid meet">
    \${defs}
    \${edgePaths}
    \${nodeEls}
  </svg>\`;
}

function renderOrbitingCirclesStage(scores, recommendedAgent) {
  const innerRing = ['improve', 'deployer', 'regressiontest', 'audit'];
  const middleRing = ['gitguardian', 'emergencyfixer', 'reporter'];
  const outerRing = ['radical', 'architect-api', 'designer-web', 'designer-portal', 'lawyer', 'compliance'];

  const renderRingSatellites = (list, radius, duration, reverse) => {
    return list.map((id, idx) => {
      const angle = Math.round((360 / list.length) * idx);
      const sc = (scores[id] && scores[id].score) ?? 65;
      const isRec = id === recommendedAgent;
      return \`
      <div class="orbit-satellite" style="--orbit-radius:\${radius}px;--orbit-duration:\${duration}s;--orbit-dir:\${reverse ? 'reverse' : 'normal'};--start-angle:\${angle}deg;\${isRec ? 'border-color:#00d4ff;box-shadow:0 0 22px #00d4ff' : ''}" onclick="openAgentInspector('\${esc(id)}')" title="\${esc(agentLabel(id))} (U=\${sc})">
        <span style="font-size:1.2rem">\${agentIcon(id)}</span>
        <span class="orbit-satellite-label">\${esc(id)} · \${sc}</span>
      </div>\`;
    }).join('');
  };

  return \`
  <div class="orbit-stage">
    <div class="orbit-ring" style="width:240px;height:240px"></div>
    <div class="orbit-ring" style="width:370px;height:370px"></div>
    <div class="orbit-ring" style="width:500px;height:500px"></div>

    <div class="orbit-core" onclick="openAgentInspector('dispatcher')">
      <div style="font-size:1.5rem">🧠</div>
      <div style="font-size:0.75rem;font-weight:800;color:#fff">ORCHESTRATOR</div>
      <div style="font-size:0.65rem;color:var(--accent)">+ Context-Mode KB</div>
    </div>

    \${renderRingSatellites(innerRing, 120, 22, false)}
    \${renderRingSatellites(middleRing, 185, 30, true)}
    \${renderRingSatellites(outerRing, 250, 40, false)}
  </div>\`;
}

async function selectTopologyPreset(topoId) {
  activeTopologyId = topoId;
  await activateAndDispatchTopology(topoId, false);
  renderTopologyStudio();
}

async function activateAndDispatchTopology(topoId, dispatchNow) {
  const pid = selectedProject || 'default';
  try {
    const res = await api('/api/projects/' + encodeURIComponent(pid) + '/topology', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topology: topoId, dispatch: Boolean(dispatchNow) })
    });
    toast(dispatchNow
      ? ('Topology "' + topoId + '" saved & dispatched ' + agentLabel(res.dispatched_agent))
      : ('Active topology switched to "' + topoId + '"'));
    updateBentoTelemetry();
  } catch {}
}

async function triggerSmartDispatch() {
  await activateAndDispatchTopology(activeTopologyId, true);
}

// ── Agent Inspector Drawer ────────────────────────────────────────
async function openAgentInspector(agentId) {
  const drawer = document.getElementById('inspector-drawer');
  if (!drawer) return;
  const pid = selectedProject || 'default';
  drawer.classList.add('open');
  drawer.innerHTML = '<div style="padding:24px;color:var(--muted)">Loading agent telemetry…</div>';

  const [agentsRes, logRes, promptsRes] = await Promise.all([
    api('/api/projects/' + encodeURIComponent(pid) + '/agents').catch(() => ({ agents: {} })),
    api('/api/projects/' + encodeURIComponent(pid) + '/agent-logs?agent=' + encodeURIComponent(agentId) + '&lines=80').catch(() => ({ logs: '' })),
    api('/api/prompts').catch(() => ({ prompts: [] }))
  ]);

  const info = (agentsRes.agents && agentsRes.agents[agentId]) || {
    id: agentId,
    name: agentLabel(agentId),
    icon: agentIcon(agentId),
    role: 'Autonomous Specialist',
    status: 'idle',
    utility_score: 70,
    utility_reason: 'Ready',
    promptFile: agentId + '.md'
  };

  const promptName = (info.promptFile || (agentId + '.md')).replace(/\.md$/, '');
  const matchedPrompt = (promptsRes.prompts || []).find(p => p.name === promptName) || (promptsRes.prompts || [])[0] || { name: promptName, content: '' };

  drawer.innerHTML = \`
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:1.8rem">\${esc(info.icon)}</span>
        <div>
          <h3 style="font-size:1.1rem;font-weight:800">\${esc(info.name)}</h3>
          <div style="font-size:0.75rem;color:var(--muted);font-family:monospace">copilot-\${esc(agentId)}.sh · \${esc(info.category || 'swarm')}</div>
        </div>
      </div>
      <button class="ripple-btn" onclick="closeAgentInspector()">✕ Close</button>
    </div>

    <div class="magic-card" style="padding:14px;margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span class="badge \${info.status === 'running' ? 'badge-running' : info.paused ? 'badge-paused' : 'badge-active'}">\${esc(info.status.toUpperCase())}</span>
        <span style="font-family:monospace;font-weight:800;color:var(--accent)">Utility Score: \${info.utility_score}/100</span>
      </div>
      <div class="utility-bar-track"><div class="utility-bar-fill" style="width:\${info.utility_score}%"></div></div>
      <p style="font-size:0.78rem;color:var(--muted);margin-top:8px">\${esc(info.utility_reason || info.role)}</p>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="shimmer-btn" onclick="runAgent('\${esc(pid)}','\${esc(agentId)}')"><span>▶ Launch Now</span></button>
        <button class="ripple-btn" onclick="toggleAgentPause('\${esc(pid)}','\${esc(agentId)}',true)">\${info.paused ? '▶ Resume Agent' : '⏸ Pause Agent'}</button>
      </div>
    </div>

    <div style="margin-bottom:14px">
      <div style="font-size:0.78rem;font-weight:700;color:var(--muted);margin-bottom:6px;text-transform:uppercase">Live Agent Log Stream</div>
      <div class="magic-terminal">
        <div class="terminal-header">
          <div class="traffic-lights"><span class="traffic-dot red"></span><span class="traffic-dot yellow"></span><span class="traffic-dot green"></span></div>
          <span style="font-size:0.72rem;color:var(--muted);font-family:monospace">copilot-\${esc(agentId)}.log</span>
        </div>
        <div class="terminal-body" style="max-height:190px">\${formatTerminalOutput(logRes.logs || 'No log entries yet.')}</div>
      </div>
    </div>

    <div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span style="font-size:0.78rem;font-weight:700;color:var(--muted);text-transform:uppercase">Prompt Template (prompts/\${esc(matchedPrompt.name)}.md)</span>
        <button class="ripple-btn" style="padding:4px 10px;font-size:0.72rem" onclick="savePromptFromDrawer('\${esc(matchedPrompt.name)}')">💾 Save Prompt</button>
      </div>
      <textarea id="drawer-prompt-editor" style="width:100%;min-height:180px;background:#050814;color:#e2e8f0;border:1px solid var(--border);border-radius:10px;padding:10px;font-family:'JetBrains Mono',monospace;font-size:0.75rem">\${esc(matchedPrompt.content || '')}</textarea>
    </div>\`;
}

function closeAgentInspector() {
  const drawer = document.getElementById('inspector-drawer');
  if (drawer) drawer.classList.remove('open');
}

async function savePromptFromDrawer(promptName) {
  const el = document.getElementById('drawer-prompt-editor');
  if (!el) return;
  try {
    await api('/api/prompts/' + encodeURIComponent(promptName), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: el.value })
    });
    toast('Saved prompt prompts/' + promptName + '.md');
  } catch {}
}

// ══════════════════════════════════════════════════════════════════
// TAB 3: 🤖 14-Agent Matrix & Live Terminal
// ══════════════════════════════════════════════════════════════════
async function renderAgentMatrixAndTerminal() {
  const app = document.getElementById('app');
  const pid = selectedProject || 'default';
  const [agentsRes, logRes, promptsRes] = await Promise.all([
    api('/api/projects/' + encodeURIComponent(pid) + '/agents').catch(() => ({ agents: {} })),
    api('/api/projects/' + encodeURIComponent(pid) + '/agent-logs?agent=' + encodeURIComponent(terminalAgent) + '&lines=200').catch(() => ({ logs: '' })),
    api('/api/prompts').catch(() => ({ prompts: [] }))
  ]);

  const agents = agentsRes.agents || {};
  cachedPrompts = promptsRes.prompts || [];

  let html = \`
  <div class="section-header">
    <div>
      <div class="section-title">🤖 14-Agent Control Matrix (\${esc(pid)})</div>
      <div style="font-size:0.82rem;color:var(--muted)">Individual Pause/Resume, Instant Dispatch, Utility Scoring & Prompt Customization</div>
    </div>
    <div style="display:flex;gap:8px">
      <button class="ripple-btn" onclick="showPromptStudioModal()">📝 Open Prompt Studio (\${cachedPrompts.length} files)</button>
      <button class="ripple-btn" onclick="toggleProjectPause('\${esc(pid)}')">\${agentsRes.project_paused ? '▶ Resume All Agents' : '⏸ Pause Entire Project'}</button>
    </div>
  </div>

  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(275px,1fr));gap:14px;margin-bottom:26px">
    \${Object.entries(agents).map(([id, info]) => {
      const isRun = info.status === 'running';
      const dotClass = isRun ? 'running' : info.paused ? 'paused' : info.last_exit_code !== 0 ? 'error' : 'idle';
      return \`
      <div class="magic-card" style="padding:16px">
        \${isRun ? '<div class="border-beam"></div>' : ''}
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:1.35rem">\${esc(info.icon)}</span>
            <div>
              <div style="font-weight:800;font-size:0.92rem">\${esc(info.name)}</div>
              <div style="font-size:0.72rem;color:var(--muted);font-family:monospace">\${esc(id)} · \${esc(info.category)}</div>
            </div>
          </div>
          <span class="status-dot \${dotClass}"></span>
        </div>
        <div style="font-size:0.78rem;color:var(--muted);margin-bottom:8px;min-height:32px">\${esc(info.role)}</div>
        <div style="display:flex;justify-content:space-between;font-size:0.74rem;margin-bottom:4px">
          <span>Status: <strong style="color:\${isRun ? 'var(--warning)' : info.paused ? 'var(--muted)' : 'var(--success)'}">\${esc(info.status.toUpperCase())}</strong></span>
          <span>Exit: <code>\${info.last_exit_code ?? 0}</code> · <strong style="color:var(--accent)">U=\${info.utility_score}</strong></span>
        </div>
        <div class="utility-bar-track"><div class="utility-bar-fill" style="width:\${info.utility_score}%"></div></div>
        <div style="font-size:0.7rem;color:var(--muted);margin-top:6px">Last activity: \${timeAgo(info.started_at || info.finished_at)}</div>
        <div style="display:flex;gap:6px;margin-top:12px;flex-wrap:wrap">
          <button class="ripple-btn success" style="padding:5px 10px;font-size:0.74rem" onclick="runAgent('\${esc(pid)}','\${esc(id)}')">▶ Run Now</button>
          <button class="ripple-btn" style="padding:5px 10px;font-size:0.74rem" onclick="toggleAgentPause('\${esc(pid)}','\${esc(id)}')">\${info.paused ? '▶ Resume' : '⏸ Pause'}</button>
          <button class="ripple-btn" style="padding:5px 10px;font-size:0.74rem" onclick="selectTerminalAgent('\${esc(id)}')">📟 Logs</button>
          <button class="ripple-btn" style="padding:5px 10px;font-size:0.74rem" onclick="openAgentInspector('\${esc(id)}')">🔍 Inspect</button>
        </div>
      </div>\`;
    }).join('')}
  </div>

  <!-- Magic UI Live Terminal -->
  <div class="magic-terminal" id="live-terminal-box">
    <div class="terminal-header">
      <div class="traffic-lights">
        <span class="traffic-dot red"></span>
        <span class="traffic-dot yellow"></span>
        <span class="traffic-dot green"></span>
        <span style="margin-left:10px;font-weight:800;font-size:0.84rem">📟 Magic UI Live Agent Terminal</span>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <select id="terminal-agent-select" class="project-select" style="min-width:170px;padding:5px 10px;font-size:0.78rem" onchange="selectTerminalAgent(this.value)">
          <option value="setup" \${terminalAgent === 'setup' ? 'selected' : ''}>📦 Setup Log (setup.log)</option>
          \${Object.keys(AGENT_META).map(a => \`<option value="\${a}" \${terminalAgent === a ? 'selected' : ''}>\${agentIcon(a)} \${agentLabel(a)} (\${a})</option>\`).join('')}
        </select>
        <input type="text" id="terminal-filter" placeholder="Filter log lines…" oninput="refreshTerminalLogs()" style="padding:5px 10px;border-radius:8px;border:1px solid var(--border);background:#050814;color:var(--text);font-size:0.78rem">
        <button class="ripple-btn" style="padding:5px 10px;font-size:0.74rem" onclick="terminalAutoScroll=!terminalAutoScroll;this.textContent=terminalAutoScroll?'🔽 Auto-Scroll: ON':'⏸ Auto-Scroll: OFF'">🔽 Auto-Scroll: ON</button>
        <button class="ripple-btn" style="padding:5px 10px;font-size:0.74rem" onclick="refreshTerminalLogs()">🔄 Refresh</button>
      </div>
    </div>
    <div class="terminal-body" id="terminal-output">\${formatTerminalOutput(logRes.logs || '')}</div>
  </div>\`;

  app.innerHTML = html;
  startTerminalPolling();
}

function formatTerminalOutput(raw, filterStr = '') {
  let lines = String(raw || '').split(/\\r?\\n/);
  if (filterStr) {
    const fl = filterStr.toLowerCase();
    lines = lines.filter(l => l.toLowerCase().includes(fl));
  }
  return lines.map(line => {
    const safe = esc(line);
    if (/error|fail|exception|critical/i.test(line)) return '<span class="log-err">' + safe + '</span>';
    if (/warn|retry|pause|stale/i.test(line)) return '<span class="log-warn">' + safe + '</span>';
    if (/success|complete|verified|passed|launched|ready/i.test(line)) return '<span class="log-ok">' + safe + '</span>';
    if (/^\\[(COPILOT|STATUS|ROLE|REASON|INFO)/i.test(line)) return '<span class="log-cmd">' + safe + '</span>';
    return safe;
  }).join('\\n');
}

function selectTerminalAgent(agentName) {
  terminalAgent = agentName;
  const sel = document.getElementById('terminal-agent-select');
  if (sel) sel.value = agentName;
  refreshTerminalLogs();
  const box = document.getElementById('live-terminal-box');
  if (box) box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function refreshTerminalLogs() {
  const pid = selectedProject || 'default';
  const out = document.getElementById('terminal-output');
  if (!out) return;
  const filterVal = document.getElementById('terminal-filter')?.value || '';
  try {
    const res = await api('/api/projects/' + encodeURIComponent(pid) + '/agent-logs?agent=' + encodeURIComponent(terminalAgent) + '&lines=200');
    out.innerHTML = formatTerminalOutput(res.logs || '', filterVal);
    if (terminalAutoScroll) out.scrollTop = out.scrollHeight;
  } catch {}
}

function startTerminalPolling() {
  stopTerminalPolling();
  terminalPollTimer = setInterval(refreshTerminalLogs, 4000);
}

function stopTerminalPolling() {
  if (terminalPollTimer) {
    clearInterval(terminalPollTimer);
    terminalPollTimer = null;
  }
}

// ══════════════════════════════════════════════════════════════════
// TAB 4: 💡 Ideas, Bugs & Research Vault
// ══════════════════════════════════════════════════════════════════
let selectedResearchDoc = 0;

async function renderIdeasAndResearchVault() {
  const app = document.getElementById('app');
  const pid = selectedProject || 'default';
  const [ideasData, researchData] = await Promise.all([
    api('/api/projects/' + encodeURIComponent(pid) + '/ideas').catch(() => ({ ideas: [], implemented: [], stats: {} })),
    api('/api/projects/' + encodeURIComponent(pid) + '/research').catch(() => ({ documents: [], changelogs: [] }))
  ]);

  cachedResearch = researchData;
  const ideas = ideasData.ideas || [];
  const docs = researchData.documents || [];
  const activeDoc = docs[selectedResearchDoc] || docs[0] || { title: 'Research Vault', content: '' };

  let html = \`
  <div style="display:grid;grid-template-columns:1fr 1.15fr;gap:20px;align-items:start">
    <!-- Left Column: Admin Ideas & Urgent Bug Override Queue -->
    <div class="magic-card">
      <div class="section-header" style="margin-bottom:12px">
        <div>
          <div class="section-title" style="font-size:1.05rem">💡 Admin Ideas & Urgent Bug Queue</div>
          <div style="font-size:0.76rem;color:var(--muted)">ICE Priority Scored (Impact × Confidence × Ease)</div>
        </div>
      </div>

      <form onsubmit="submitNewIdea(event)" style="background:rgba(6,10,23,0.75);padding:14px;border-radius:12px;border:1px solid var(--border);margin-bottom:16px">
        <div class="field">
          <label>Idea Title or Urgent Bug Summary *</label>
          <input type="text" id="idea-title" required placeholder="e.g. Add OAuth2 PKCE flow & rate-limiting middleware">
        </div>
        <div class="field">
          <label>Technical Description & Acceptance Criteria</label>
          <textarea id="idea-desc" style="min-height:64px" placeholder="Specify target endpoints, UI behavior, or bug reproduction steps…"></textarea>
        </div>
        <div class="field-row-3" style="margin-bottom:10px">
          <div class="field" style="margin:0"><label>Impact (1-10)</label><input type="number" id="idea-impact" min="1" max="10" step="0.5" value="8.5"></div>
          <div class="field" style="margin:0"><label>Confidence (1-10)</label><input type="number" id="idea-conf" min="1" max="10" step="0.5" value="8.0"></div>
          <div class="field" style="margin:0"><label>Ease (1-10)</label><input type="number" id="idea-ease" min="1" max="10" step="0.5" value="7.5"></div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
          <label style="display:flex;align-items:center;gap:8px;font-size:0.82rem;cursor:pointer;color:#fca5a5;font-weight:700">
            <input type="checkbox" id="idea-urgent" style="width:16px;height:16px;accent-color:#ef4444"> 🚨 Urgent Override (Preempts Backlog)
          </label>
          <button type="submit" class="shimmer-btn"><span>＋ Queue Idea / Bug</span></button>
        </div>
      </form>

      <div style="display:flex;flex-direction:column;gap:10px;max-height:460px;overflow-y:auto">
        \${ideas.length === 0 ? '<div style="text-align:center;padding:24px;color:var(--muted)">No ideas queued yet.</div>' : ideas.map(item => \`
          <div style="padding:12px;border-radius:12px;background:rgba(6,10,23,0.85);border:1px solid \${item.urgent ? 'rgba(239,68,68,0.5)' : 'var(--border)'}">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
              <div style="font-weight:800;font-size:0.9rem">\${item.urgent ? '🚨 ' : '💡 '}\${esc(item.title)}</div>
              <span class="aurora-badge">ICE \${item.iceScore}</span>
            </div>
            <p style="font-size:0.78rem;color:var(--muted);margin:6px 0">\${esc(item.description)}</p>
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-top:8px">
              <div style="display:flex;gap:6px;align-items:center">
                \${item.urgent ? '<span class="badge badge-urgent">URGENT</span>' : ''}
                <span class="badge \${item.status === 'implemented' ? 'badge-active' : item.status === 'in_progress' ? 'badge-running' : 'badge-paused'}">\${esc(item.status)}</span>
              </div>
              <div style="display:flex;gap:6px">
                <button class="ripple-btn" style="padding:3px 8px;font-size:0.7rem" onclick="updateIdea('\${esc(item.id)}',{urgent:\${!item.urgent}})">\${item.urgent ? 'Unmark Urgent' : '🚨 Make Urgent'}</button>
                <button class="ripple-btn" style="padding:3px 8px;font-size:0.7rem" onclick="cycleIdeaStatus('\${esc(item.id)}','\${esc(item.status)}')">🔄 Status</button>
                <button class="ripple-btn danger" style="padding:3px 8px;font-size:0.7rem" onclick="deleteIdea('\${esc(item.id)}')">✕</button>
              </div>
            </div>
          </div>
        \`).join('')}
      </div>
    </div>

    <!-- Right Column: Agent Research Vault & Changelogs -->
    <div class="magic-card">
      <div class="section-header" style="margin-bottom:12px">
        <div>
          <div class="section-title" style="font-size:1.05rem">📚 Specialist Research Vault & Changelogs</div>
          <div style="font-size:0.76rem;color:var(--muted)">Generated intelligence from Radical, API Architect, Web/Portal Designers, Lawyer & Compliance</div>
        </div>
      </div>

      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">
        \${docs.map((d, idx) => \`
          <button class="topo-pill \${idx === selectedResearchDoc ? 'active' : ''}" style="padding:6px 11px;font-size:0.75rem" onclick="selectedResearchDoc=\${idx};renderIdeasAndResearchVault()">
            \${esc(d.icon)} \${esc(d.agent)}
          </button>
        \`).join('')}
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-size:0.78rem;color:var(--muted)">
        <span>📄 <strong>\${esc(activeDoc.title || activeDoc.file)}</strong></span>
        <button class="ripple-btn" style="padding:4px 10px;font-size:0.72rem" onclick="runAgent('\${esc(pid)}','\${esc(activeDoc.agent || 'radical')}')">▶ Regenerate via \${esc(activeDoc.agent || 'agent')}</button>
      </div>

      <div class="md-viewer">\${renderMarkdownHTML(activeDoc.content || '')}</div>
    </div>
  </div>\`;

  app.innerHTML = html;
}

function renderMarkdownHTML(md) {
  const raw = String(md || '');
  // If JSON file, pretty-print key sections
  if (raw.trim().startsWith('{')) {
    try {
      const obj = JSON.parse(raw);
      if (Array.isArray(obj.standards)) {
        return obj.standards.map(std => \`
          <h2>🛡️ \${esc(std.name)} (\${esc(std.overall_status)})</h2>
          <p style="color:var(--muted);font-size:0.8rem;margin-bottom:8px">\${esc(std.how_to_get || '')}</p>
          <ul>
            \${(std.items || []).map(it => \`<li><strong>[\${esc(it.status.toUpperCase())}] \${esc(it.name)}</strong> (\${esc(it.priority)}): \${esc(it.description)}</li>\`).join('')}
          </ul>
        \`).join('');
      }
      return '<pre>' + esc(JSON.stringify(obj, null, 2)) + '</pre>';
    } catch {}
  }

  let html = esc(raw);
  html = html.replace(/\`\`\`([a-zA-Z0-9_-]*)\\n([\\s\\S]*?)\`\`\`/g, '<pre><code>$2</code></pre>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  html = html.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
  html = html.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/\\n\\n/g, '<br><br>');
  return html;
}

async function submitNewIdea(e) {
  e.preventDefault();
  const pid = selectedProject || 'default';
  const body = {
    title: document.getElementById('idea-title').value.trim(),
    description: document.getElementById('idea-desc').value.trim(),
    impact: Number(document.getElementById('idea-impact').value) || 8,
    confidence: Number(document.getElementById('idea-conf').value) || 8,
    ease: Number(document.getElementById('idea-ease').value) || 7.5,
    urgent: document.getElementById('idea-urgent').checked
  };
  try {
    await api('/api/projects/' + encodeURIComponent(pid) + '/ideas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    toast('Idea added & indexed into Context-Mode KB');
    renderIdeasAndResearchVault();
    updateBentoTelemetry();
  } catch {}
}

async function updateIdea(ideaId, patch) {
  const pid = selectedProject || 'default';
  try {
    await api('/api/projects/' + encodeURIComponent(pid) + '/ideas/' + encodeURIComponent(ideaId), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    });
    toast('Idea updated');
    renderIdeasAndResearchVault();
    updateBentoTelemetry();
  } catch {}
}

function cycleIdeaStatus(ideaId, currentStatus) {
  const order = ['pending', 'in_progress', 'implemented'];
  const next = order[(order.indexOf(currentStatus) + 1) % order.length];
  updateIdea(ideaId, { status: next });
}

async function deleteIdea(ideaId) {
  const pid = selectedProject || 'default';
  try {
    await api('/api/projects/' + encodeURIComponent(pid) + '/ideas/' + encodeURIComponent(ideaId), { method: 'DELETE' });
    toast('Idea removed');
    renderIdeasAndResearchVault();
    updateBentoTelemetry();
  } catch {}
}

// ══════════════════════════════════════════════════════════════════
// TAB 5: 🧠 Context-Mode Knowledge & Think-in-Code Sandbox
// ══════════════════════════════════════════════════════════════════
async function renderContextModeStudio() {
  const app = document.getElementById('app');
  const pid = selectedProject || 'default';
  const [stats, initialSearch] = await Promise.all([
    api('/api/context-mode/stats?project=' + encodeURIComponent(pid)).catch(() => ({})),
    api('/api/context-mode/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: pid, queries: ['SOC2 OWASP compliance', 'urgent admin ideas', 'architecture overview'], limit: 5 })
    }).catch(() => ({ results: [] }))
  ]);

  const defaultSandboxCode = [
    "// Think-in-Code Sandbox: Process repository telemetry in-sandbox",
    "// Only console.log() output enters the agent's context window!",
    "const fs = require('fs');",
    "const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));",
    "const scripts = fs.readdirSync('.').filter(f => f.startsWith('copilot-') && f.endsWith('.sh'));",
    "console.log('Package:', pkg.name, 'v' + pkg.version);",
    "console.log('Swarm Agent Scripts (' + scripts.length + '):', scripts.join(', '));"
  ].join('\\n');

  let html = \`
  <div class="section-header">
    <div>
      <div class="section-title">🧠 Context-Mode Knowledge Base & Think-in-Code Sandbox</div>
      <div style="font-size:0.82rem;color:var(--muted)">Hybrid BM25 + Porter Stemming + 3-Char Trigram + Levenshtein Fuzzy + Reciprocal Rank Fusion (RRF)</div>
    </div>
    <div style="display:flex;gap:8px">
      <button class="ripple-btn" onclick="syncContextKnowledge()">🔄 Sync Project Knowledge</button>
      <button class="ripple-btn" onclick="showIndexNoteModal()">＋ Index Custom Architecture Note</button>
    </div>
  </div>

  <!-- Context Window Telemetry Strip -->
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px;margin-bottom:20px">
    <div class="magic-card" style="padding:16px">
      <div class="telemetry-label">Raw Bytes Indexed</div>
      <div class="telemetry-val" style="color:var(--accent)">\${formatBytes(stats.rawBytesIndexed || 0)}</div>
      <div class="telemetry-sub">\${(stats.sources || []).length} active sources</div>
    </div>
    <div class="magic-card" style="padding:16px">
      <div class="telemetry-label">Raw Bytes Avoided</div>
      <div class="telemetry-val" style="color:var(--success)">\${formatBytes(stats.rawBytesAvoided || 0)}</div>
      <div class="telemetry-sub">Kept out of LLM prompt context</div>
    </div>
    <div class="magic-card" style="padding:16px">
      <div class="telemetry-label">Compact Bytes Returned</div>
      <div class="telemetry-val" style="color:var(--purple)">\${formatBytes(stats.bytesReturned || 0)}</div>
      <div class="telemetry-sub">\${stats.totalSearches || 0} hybrid searches · \${stats.sandboxRuns || 0} sandbox runs</div>
    </div>
    <div class="magic-card" style="padding:16px">
      <div class="telemetry-label">Context Window Savings</div>
      <div class="telemetry-val aurora-text">\${stats.savingsRatioPercent || 85}%</div>
      <div class="telemetry-sub">~\${(stats.estimatedTokensSaved || 0).toLocaleString()} tokens saved</div>
    </div>
  </div>

  <div style="display:grid;grid-template-columns:1.05fr 1fr;gap:20px;align-items:start">
    <!-- Left: Hybrid BM25 + Trigram + RRF Search Studio -->
    <div class="magic-card">
      <h3 style="font-size:1rem;font-weight:800;margin-bottom:10px">🔎 Multi-Query Hybrid Knowledge Search</h3>
      <form onsubmit="runContextSearch(event)" style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
        <input type="text" id="cm-search-input" placeholder="Search concepts, OWASP controls, API specs (comma-separated for multi-query RRF)…" value="SOC2 OWASP compliance, urgent admin ideas" style="flex:1;min-width:220px;padding:9px 14px;border-radius:10px;border:1px solid var(--border);background:#050814;color:var(--text);font-size:0.84rem">
        <select id="cm-content-type" class="project-select" style="min-width:110px">
          <option value="">All Types</option>
          <option value="prose">Prose</option>
          <option value="code">Code</option>
        </select>
        <button type="submit" class="shimmer-btn"><span>🔎 Search KB</span></button>
      </form>

      <div id="cm-search-results" style="display:flex;flex-direction:column;gap:10px;max-height:430px;overflow-y:auto">
        \${renderSearchResultsHTML(initialSearch.results || [])}
      </div>
    </div>

    <!-- Right: Interactive Think-in-Code Sandbox -->
    <div class="magic-card">
      <div class="border-beam"></div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px">
        <div>
          <h3 style="font-size:1rem;font-weight:800">⚡ Think-in-Code Subprocess Sandbox</h3>
          <div style="font-size:0.74rem;color:var(--muted)">Execute JS, Python, or Shell over project files without polluting context</div>
        </div>
        <select id="sandbox-lang" class="project-select" style="min-width:130px;padding:6px 10px">
          <option value="javascript">🟨 JavaScript (Node)</option>
          <option value="python">🐍 Python 3</option>
          <option value="shell">🐚 Bash Shell</option>
        </select>
      </div>

      <div class="field">
        <label>Optional Target File (loaded into <code>FILE_CONTENT</code> inside sandbox)</label>
        <input type="text" id="sandbox-filepath" placeholder="e.g. ideas/compliance_checklist.json or package.json" value="ideas/compliance_checklist.json">
      </div>

      <div class="field">
        <label>Sandbox Code</label>
        <textarea id="sandbox-code" style="min-height:145px;font-family:'JetBrains Mono',monospace;font-size:0.78rem">\${esc(defaultSandboxCode)}</textarea>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <span id="sandbox-metrics-badge" class="aurora-badge">Ready to execute</span>
        <button class="shimmer-btn" onclick="executeSandboxCode()"><span>▶ Run Think-in-Code Sandbox</span></button>
      </div>

      <div class="magic-terminal">
        <div class="terminal-header">
          <div class="traffic-lights"><span class="traffic-dot red"></span><span class="traffic-dot yellow"></span><span class="traffic-dot green"></span><span style="margin-left:8px;font-size:0.75rem;font-weight:700">Sandbox Stdout</span></div>
        </div>
        <div class="terminal-body" id="sandbox-output" style="max-height:190px">Click "▶ Run Think-in-Code Sandbox" to inspect live stdout & byte-savings telemetry.</div>
      </div>
    </div>
  </div>\`;

  app.innerHTML = html;
}

function renderSearchResultsHTML(results) {
  if (!results || !results.length) {
    return '<div style="padding:20px;text-align:center;color:var(--muted)">No matching chunks found. Try syncing project knowledge.</div>';
  }
  return results.map(r => \`
    <div style="padding:12px;border-radius:12px;background:rgba(5,8,20,0.85);border:1px solid var(--border)">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">
        <span style="font-weight:800;font-size:0.86rem;color:var(--accent)">[\${esc(r.source)}] \${esc(r.heading)}</span>
        <div style="display:flex;gap:6px">
          <span class="aurora-badge">RRF \${r.rrfScore}</span>
          <span class="badge badge-paused">BM25 \${r.bm25Score}</span>
          <span class="badge badge-paused">\${esc(r.contentType)}</span>
        </div>
      </div>
      <div style="font-size:0.78rem;color:#cbd5e1;font-family:'JetBrains Mono',monospace;white-space:pre-wrap;line-height:1.5">\${esc(r.snippet)}</div>
    </div>
  \`).join('');
}

async function runContextSearch(e) {
  if (e) e.preventDefault();
  const pid = selectedProject || 'default';
  const rawQ = document.getElementById('cm-search-input')?.value || 'overview';
  const contentType = document.getElementById('cm-content-type')?.value || undefined;
  const queries = rawQ.split(',').map(s => s.trim()).filter(Boolean);
  try {
    const res = await api('/api/context-mode/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: pid, queries, contentType, limit: 8 })
    });
    const box = document.getElementById('cm-search-results');
    if (box) box.innerHTML = renderSearchResultsHTML(res.results || []);
    updateBentoTelemetry();
  } catch {}
}

async function syncContextKnowledge() {
  const pid = selectedProject || 'default';
  try {
    const res = await api('/api/context-mode/index', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: pid, sync: true })
    });
    toast('Synced ' + (res.syncedCount || 0) + ' knowledge sources into FTS index');
    renderContextModeStudio();
    updateBentoTelemetry();
  } catch {}
}

async function executeSandboxCode() {
  const pid = selectedProject || 'default';
  const language = document.getElementById('sandbox-lang')?.value || 'javascript';
  const filePath = document.getElementById('sandbox-filepath')?.value.trim() || undefined;
  const code = document.getElementById('sandbox-code')?.value || '';
  const outEl = document.getElementById('sandbox-output');
  const badgeEl = document.getElementById('sandbox-metrics-badge');
  if (outEl) outEl.textContent = 'Running in isolated subprocess sandbox…';
  try {
    const res = await api('/api/context-mode/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: pid, language, filePath, code })
    });
    if (outEl) {
      outEl.innerHTML = formatTerminalOutput((res.stdout || '') + (res.stderr ? '\\n[STDERR]\\n' + res.stderr : ''));
    }
    if (badgeEl) {
      badgeEl.textContent = \`Processed \${formatBytes(res.rawBytesProcessed || 0)} → Returned \${formatBytes(res.bytesReturned || 0)} (\${res.durationMs || 0}ms)\`;
    }
    updateBentoTelemetry();
  } catch {}
}

function showIndexNoteModal() {
  const existing = document.getElementById('modal-overlay');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.id = 'modal-overlay';
  overlay.innerHTML = \`
    <div class="modal" onclick="event.stopPropagation()">
      <h2>📚 Index Custom Architecture Note</h2>
      <form onsubmit="submitCustomNote(event)">
        <div class="field">
          <label>Source Label *</label>
          <input type="text" id="note-source" required placeholder="architecture/decisions.md" value="architecture/decisions.md">
        </div>
        <div class="field">
          <label>Markdown Content (automatically split by headings & code blocks) *</label>
          <textarea id="note-content" required style="min-height:180px" placeholder="# Caching Strategy\\n\\nUse Redis for session state..."></textarea>
        </div>
        <div class="modal-actions">
          <button type="button" class="ripple-btn" onclick="closeModal()">Cancel</button>
          <button type="submit" class="shimmer-btn"><span>📥 Index into Knowledge Base</span></button>
        </div>
      </form>
    </div>\`;
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
  document.body.appendChild(overlay);
}

async function submitCustomNote(e) {
  e.preventDefault();
  const pid = selectedProject || 'default';
  const source = document.getElementById('note-source').value.trim();
  const content = document.getElementById('note-content').value;
  try {
    await api('/api/context-mode/index', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: pid, source, content })
    });
    toast('Indexed ' + source + ' into Context-Mode KB');
    closeModal();
    renderContextModeStudio();
    updateBentoTelemetry();
  } catch {}
}

// ── Prompt Studio Modal ───────────────────────────────────────────
async function showPromptStudioModal() {
  const existing = document.getElementById('modal-overlay');
  if (existing) existing.remove();
  const res = await api('/api/prompts').catch(() => ({ prompts: [] }));
  cachedPrompts = res.prompts || [];
  const first = cachedPrompts[0] || { name: 'developer', content: '' };

  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.id = 'modal-overlay';
  overlay.innerHTML = \`
    <div class="modal" style="max-width:820px" onclick="event.stopPropagation()">
      <h2>📝 Agent Prompt Studio (prompts/*.md)</h2>
      <div class="field">
        <label>Select Agent Prompt Template</label>
        <select id="prompt-modal-select" class="project-select" style="width:100%" onchange="onPromptModalSelect(this.value)">
          \${cachedPrompts.map(p => \`<option value="\${esc(p.name)}">\${esc(p.file)} (\${p.size_bytes} bytes)</option>\`).join('')}
        </select>
      </div>
      <div class="field">
        <label>Markdown Instructions</label>
        <textarea id="prompt-modal-content" style="min-height:320px;font-family:'JetBrains Mono',monospace;font-size:0.8rem">\${esc(first.content)}</textarea>
      </div>
      <div class="modal-actions">
        <button type="button" class="ripple-btn" onclick="closeModal()">Close</button>
        <button type="button" class="shimmer-btn" onclick="savePromptFromModal()"><span>💾 Save Prompt Template</span></button>
      </div>
    </div>\`;
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
  document.body.appendChild(overlay);
}

function onPromptModalSelect(name) {
  const found = cachedPrompts.find(p => p.name === name);
  const area = document.getElementById('prompt-modal-content');
  if (found && area) area.value = found.content;
}

async function savePromptFromModal() {
  const name = document.getElementById('prompt-modal-select')?.value;
  const content = document.getElementById('prompt-modal-content')?.value || '';
  if (!name) return;
  try {
    await api('/api/prompts/' + encodeURIComponent(name), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    toast('Updated prompts/' + name + '.md');
    closeModal();
  } catch {}
}

// ── Shared Project & Agent Actions ────────────────────────────────
async function runAgent(projectId, agent) {
  const pid = projectId || selectedProject || 'default';
  try {
    await api('/api/projects/' + encodeURIComponent(pid) + '/run-agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent })
    });
    toast('Launched ' + agentIcon(agent) + ' ' + agentLabel(agent) + ' (' + pid + ')');
    updateBentoTelemetry();
  } catch {}
}

async function toggleAgentPause(projectId, agent, refreshInspector = false) {
  const pid = projectId || selectedProject || 'default';
  try {
    const res = await api('/api/projects/' + encodeURIComponent(pid) + '/agents/' + encodeURIComponent(agent) + '/toggle-pause', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    toast('Agent "' + agentLabel(agent) + '" ' + res.status);
    if (refreshInspector) openAgentInspector(agent);
    render();
  } catch {}
}

async function toggleProjectPause(projectId) {
  const pid = projectId || selectedProject || 'default';
  try {
    const st = await api('/api/projects/' + encodeURIComponent(pid) + '/pause-status');
    if (st.paused) {
      await api('/api/projects/' + encodeURIComponent(pid) + '/resume', { method: 'POST' });
      toast('Project resumed');
    } else {
      await api('/api/projects/' + encodeURIComponent(pid) + '/pause', { method: 'POST' });
      toast('Project paused');
    }
    render();
  } catch {}
}

async function rerunSetup(projectId) {
  try {
    await api('/api/projects/' + encodeURIComponent(projectId) + '/rerun-setup', { method: 'POST' });
    toast('Setup re-started for ' + projectId);
    render();
  } catch {}
}

async function deleteProject(id) {
  if (!confirm('Remove project "' + id + '" from registry?')) return;
  try {
    await api('/api/projects/' + encodeURIComponent(id), { method: 'DELETE' });
    toast('Project removed');
    if (selectedProject === id) selectedProject = 'default';
    currentDetailProject = null;
    render();
  } catch {}
}

// ── Add / Edit Project Modals (Zero Personal Info, All 14 Agents + Topology) ──
function closeModal() {
  const o = document.getElementById('modal-overlay');
  if (o) o.remove();
}

function showAddModal() {
  closeModal();
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.id = 'modal-overlay';
  overlay.innerHTML = \`
  <div class="modal" onclick="event.stopPropagation()">
    <h2>🚀 Register New Swarm Project</h2>
    <form onsubmit="submitProject(event)">
      <div class="field-row">
        <div class="field">
          <label>Project Name *</label>
          <input type="text" id="f-name" required placeholder="My SaaS Platform" oninput="autoSlug()">
        </div>
        <div class="field">
          <label>Project ID *</label>
          <input type="text" id="f-id" required placeholder="my-saas-platform">
        </div>
      </div>

      <div class="field-row">
        <div class="field">
          <label>Local Project Path *</label>
          <input type="text" id="f-path" placeholder="/opt/projects/my-app" value="/opt/projects/my-app">
        </div>
        <div class="field">
          <label>GitHub Repository (optional)</label>
          <input type="text" id="f-repo" placeholder="org/my-saas-platform">
        </div>
      </div>

      <div class="field">
        <label>Folder Auto-Discovery</label>
        <div style="display:flex;gap:8px">
          <input type="text" id="f-scan-dir" placeholder="Directory to scan (e.g. /opt/projects)" style="flex:1">
          <button type="button" class="ripple-btn" onclick="discoverFolders()">🔍 Scan Folders</button>
        </div>
        <div id="folder-picker"></div>
      </div>

      <div class="field">
        <label>Description & Architecture Context *</label>
        <textarea id="f-desc" required placeholder="Describe what your application does, its tech stack, and primary goals..."></textarea>
      </div>

      <div class="field-row-3">
        <div class="field">
          <label>Docker Compose File</label>
          <input type="text" id="f-compose" placeholder="/opt/projects/my-app/docker-compose.yml">
        </div>
        <div class="field">
          <label>Health Check URL <button type="button" class="ripple-btn" style="padding:1px 6px;font-size:0.68rem" onclick="autoPort()">🎲 Port</button></label>
          <input type="text" id="f-health" value="http://localhost:8080/">
        </div>
        <div class="field">
          <label>Orchestration Topology</label>
          <select id="f-topology">
            <option value="adaptive-swarm">🧠 Adaptive Utility Swarm</option>
            <option value="cyclic-pipeline">🔄 Cyclic Delivery Pipeline</option>
            <option value="star-hub">⭐ Star Hub Fan-Out</option>
            <option value="dag-mesh">🕸️ 5-Stage DAG Mesh</option>
            <option value="self-healing-ring">🛡️ Self-Healing Ring</option>
          </select>
        </div>
      </div>

      <div class="field">
        <label>Container Names (optional — synced to both top-level & nested docker config)</label>
        <div class="field-row-3">
          <input type="text" id="f-c-api" placeholder="my-app-api">
          <input type="text" id="f-c-web" placeholder="my-app-web">
          <input type="text" id="f-c-db" placeholder="my-app-db">
        </div>
      </div>

      <div class="field">
        <label>Enabled Swarm Agents (All 14 Specialists)</label>
        <div class="checks">
          \${Object.entries(AGENT_META).map(([id, m]) => \`
            <label><input type="checkbox" name="agents" value="\${id}" checked> \${m.icon} \${m.name}</label>
          \`).join('')}
        </div>
      </div>

      <div class="modal-actions">
        <button type="button" class="ripple-btn" onclick="closeModal()">Cancel</button>
        <button type="submit" class="shimmer-btn" id="createBtn"><span>🚀 Create Project</span></button>
      </div>
    </form>
  </div>\`;
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
  document.body.appendChild(overlay);
}

function autoSlug() {
  const name = document.getElementById('f-name')?.value || '';
  const idEl = document.getElementById('f-id');
  if (idEl) idEl.value = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

async function autoPort() {
  try {
    const data = await api('/api/next-port');
    const hf = document.getElementById('f-health');
    if (hf) hf.value = 'http://localhost:' + data.port + '/';
    toast('Assigned available port ' + data.port);
  } catch {}
}

async function discoverFolders() {
  const picker = document.getElementById('folder-picker');
  if (!picker) return;
  const dir = document.getElementById('f-scan-dir')?.value.trim() || '';
  const qs = dir ? ('?dir=' + encodeURIComponent(dir)) : '';
  picker.innerHTML = '<div style="padding:8px;font-size:0.8rem;color:var(--muted)">Scanning directories…</div>';
  try {
    const data = await api('/api/discover-folders' + qs);
    const folders = data.folders || [];
    if (!folders.length) {
      picker.innerHTML = '<div style="padding:8px;font-size:0.8rem;color:var(--muted)">No subdirectories found.</div>';
      return;
    }
    picker.innerHTML = '<div style="max-height:150px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;margin-top:6px;background:#050814">' +
      folders.map(f => \`
        <div style="padding:6px 10px;border-bottom:1px solid var(--border);font-size:0.8rem;cursor:pointer;display:flex;justify-content:space-between" onclick="selectFolder('\${esc(f.path)}','\${esc(f.name)}')">
          <span>📂 <strong>\${esc(f.name)}</strong></span>
          <span style="color:var(--muted)">\${(f.tech || []).join(', ')}</span>
        </div>
      \`).join('') + '</div>';
  } catch {}
}

function selectFolder(folderPath, folderName) {
  const pf = document.getElementById('f-path');
  if (pf) pf.value = folderPath;
  const nf = document.getElementById('f-name');
  if (nf && !nf.value) {
    nf.value = folderName.replace(/[-_]/g, ' ').replace(/\\b\\w/g, c => c.toUpperCase());
    autoSlug();
  }
}

async function submitProject(e) {
  e.preventDefault();
  const containers = {};
  const cApi = document.getElementById('f-c-api')?.value.trim();
  const cWeb = document.getElementById('f-c-web')?.value.trim();
  const cDb = document.getElementById('f-c-db')?.value.trim();
  if (cApi) containers.api = cApi;
  if (cWeb) containers.web = cWeb;
  if (cDb) containers.db = cDb;

  const agents = Array.from(document.querySelectorAll('input[name=agents]:checked')).map(el => el.value);
  const body = {
    id: document.getElementById('f-id').value.trim(),
    name: document.getElementById('f-name').value.trim(),
    path: document.getElementById('f-path').value.trim(),
    github_repo: document.getElementById('f-repo').value.trim(),
    description: document.getElementById('f-desc').value.trim(),
    compose_file: document.getElementById('f-compose').value.trim(),
    health_url: document.getElementById('f-health').value.trim() || 'http://localhost:8080/',
    topology: document.getElementById('f-topology').value,
    containers,
    agents
  };

  try {
    await api('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    toast('Project "' + body.name + '" created with synchronized Docker schema!');
    closeModal();
    selectedProject = body.id;
    render();
  } catch {}
}

async function showEditModal(projectId) {
  closeModal();
  let p;
  try { p = await api('/api/projects/' + encodeURIComponent(projectId)); } catch { return; }
  const containers = p.containers || (p.docker && p.docker.containers) || {};
  const enabledAgents = p.agents || Object.keys(AGENT_META);

  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.id = 'modal-overlay';
  overlay.innerHTML = \`
  <div class="modal" onclick="event.stopPropagation()">
    <h2>✏️ Edit Project — \${esc(p.name)}</h2>
    <form onsubmit="submitEdit(event,'\${esc(projectId)}')">
      <div class="field-row">
        <div class="field"><label>Project Name</label><input type="text" id="e-name" required value="\${esc(p.name || '')}"></div>
        <div class="field"><label>Local Path</label><input type="text" id="e-path" value="\${esc(p.path || '')}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>GitHub Repo</label><input type="text" id="e-repo" value="\${esc(p.github_repo || '')}"></div>
        <div class="field">
          <label>Topology</label>
          <select id="e-topology">
            \${['adaptive-swarm','cyclic-pipeline','star-hub','dag-mesh','self-healing-ring'].map(t => \`<option value="\${t}" \${p.topology === t ? 'selected' : ''}>\${t}</option>\`).join('')}
          </select>
        </div>
      </div>
      <div class="field"><label>Description</label><textarea id="e-desc">\${esc(p.description || '')}</textarea></div>
      <div class="field-row">
        <div class="field"><label>Compose File</label><input type="text" id="e-compose" value="\${esc(p.compose_file || '')}"></div>
        <div class="field"><label>Health Check URL</label><input type="text" id="e-health" value="\${esc(p.health_url || '')}"></div>
      </div>
      <div class="field">
        <label>Container Names (API / Web / DB)</label>
        <div class="field-row-3">
          <input type="text" id="e-c-api" value="\${esc(containers.api || '')}" placeholder="api">
          <input type="text" id="e-c-web" value="\${esc(containers.web || '')}" placeholder="web">
          <input type="text" id="e-c-db" value="\${esc(containers.db || '')}" placeholder="db">
        </div>
      </div>
      <div class="field">
        <label>Enabled Agents</label>
        <div class="checks">
          \${Object.entries(AGENT_META).map(([id, m]) => \`
            <label><input type="checkbox" name="eagents" value="\${id}" \${enabledAgents.includes(id) ? 'checked' : ''}> \${m.icon} \${m.name}</label>
          \`).join('')}
        </div>
      </div>
      <div class="modal-actions">
        <button type="button" class="ripple-btn" onclick="closeModal()">Cancel</button>
        <button type="submit" class="shimmer-btn"><span>💾 Save Changes</span></button>
      </div>
    </form>
  </div>\`;
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
  document.body.appendChild(overlay);
}

async function submitEdit(e, projectId) {
  e.preventDefault();
  const containers = {};
  const cApi = document.getElementById('e-c-api')?.value.trim();
  const cWeb = document.getElementById('e-c-web')?.value.trim();
  const cDb = document.getElementById('e-c-db')?.value.trim();
  if (cApi) containers.api = cApi;
  if (cWeb) containers.web = cWeb;
  if (cDb) containers.db = cDb;
  const agents = Array.from(document.querySelectorAll('input[name=eagents]:checked')).map(el => el.value);

  const body = {
    name: document.getElementById('e-name').value.trim(),
    path: document.getElementById('e-path').value.trim(),
    github_repo: document.getElementById('e-repo').value.trim(),
    topology: document.getElementById('e-topology').value,
    description: document.getElementById('e-desc').value.trim(),
    compose_file: document.getElementById('e-compose').value.trim(),
    health_url: document.getElementById('e-health').value.trim(),
    containers,
    agents
  };
  try {
    await api('/api/projects/' + encodeURIComponent(projectId), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    toast('Project configuration updated');
    closeModal();
    render();
  } catch {}
}

// ── Boot ──────────────────────────────────────────────────────────
render();
setTimeout(() => scrambleHyperText(document.getElementById('hyper-title')), 250);
setInterval(updateBentoTelemetry, 12000);
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Backend Domain Helpers (Agents, Topologies, Ideas, Research, Prompts)
// ---------------------------------------------------------------------------

function buildProjectAgentsPayload(projectId) {
  const pid = projectId || 'default';
  const cfg = pid !== 'default' ? readProjectConfig(pid) : null;
  const enabledAgents = cfg && Array.isArray(cfg.agents) && cfg.agents.length > 0 ? cfg.agents : ALL_AGENTS;
  const projectPaused = isProjectPaused(pid);

  let agentData = {};
  const statusCandidates = [];
  if (pid !== 'default') {
    statusCandidates.push(path.join(PROJECTS_DIR, pid, 'ideas', 'agent_status.json'));
  }
  statusCandidates.push(path.join(HIVE_DIR, 'ideas', 'agent_status.json'));
  statusCandidates.push(path.join(HIVE_DIR, 'ideas', 'agent_status.example.json'));

  for (const sf of statusCandidates) {
    try {
      const raw = JSON.parse(fs.readFileSync(sf, 'utf8'));
      if (raw && raw.agents && Object.keys(raw.agents).length > 0) {
        agentData = { ...raw.agents, ...agentData };
        break;
      }
    } catch {}
  }

  // Live process detection across all 14 agents
  try {
    const ps = execSync('ps aux', { encoding: 'utf8', timeout: 3000 });
    for (const agent of ALL_AGENTS) {
      const escapedId = pid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const patternProject = new RegExp('copilot-' + agent + '.*--project[=\\s]+' + escapedId);
      const patternDefault = new RegExp('copilot-' + agent + '\\.sh');
      if ((pid !== 'default' && patternProject.test(ps)) || (pid === 'default' && patternDefault.test(ps))) {
        if (!agentData[agent]) agentData[agent] = {};
        agentData[agent].status = 'running';
        agentData[agent].detected_via = 'process';
      }
    }
  } catch {}

  // Enrich with Smart Utility Scores from hive-engine
  const engine = getHiveEngine();
  let swarmIntel = null;
  try {
    if (engine && typeof engine.evaluateSwarmIntelligence === 'function') {
      swarmIntel = engine.evaluateSwarmIntelligence(pid, {
        topology: cfg ? cfg.topology : undefined
      });
    }
  } catch {}

  const catalog = (engine && engine.AGENTS_CATALOG) ? engine.AGENTS_CATALOG : DEFAULT_AGENT_META;
  const result = {};

  for (const agent of ALL_AGENTS) {
    const meta = catalog[agent] || DEFAULT_AGENT_META[agent] || { id: agent, name: agent, icon: '🤖', category: 'pipeline', role: 'Swarm Agent', color: '#3b82f6' };
    const rawInfo = agentData[agent] || {};
    const scoreObj = swarmIntel && swarmIntel.agentScores ? swarmIntel.agentScores[agent] : null;
    const paused = isAgentPaused(pid, agent);
    const status = paused ? 'paused' : (rawInfo.status || 'idle');

    result[agent] = {
      id: agent,
      name: meta.name || agent,
      icon: meta.icon || '🤖',
      category: meta.category || 'pipeline',
      role: meta.role || '',
      color: meta.color || '#3b82f6',
      ring: DEFAULT_AGENT_META[agent] ? DEFAULT_AGENT_META[agent].ring : 2,
      promptFile: DEFAULT_AGENT_META[agent] ? DEFAULT_AGENT_META[agent].promptFile : `${agent}.md`,
      enabled: enabledAgents.includes(agent),
      status,
      paused,
      project_paused: projectPaused,
      last_exit_code: rawInfo.last_exit_code !== undefined ? rawInfo.last_exit_code : 0,
      started_at: rawInfo.started_at || null,
      finished_at: rawInfo.finished_at || null,
      current_step: rawInfo.current_step || (paused ? 'Paused by operator' : 'Ready for dispatch'),
      detected_via: rawInfo.detected_via || 'status_file',
      utility_score: scoreObj ? scoreObj.score : 65,
      utility_reason: scoreObj ? scoreObj.reason : meta.role
    };
  }

  return {
    project_id: pid,
    project_paused: projectPaused,
    topology: (cfg && cfg.topology) || (swarmIntel && swarmIntel.topology) || 'adaptive-swarm',
    recommended_next: (swarmIntel && swarmIntel.recommendedAgent) || 'improve',
    recommended_cohort: (swarmIntel && swarmIntel.recommendedCohort) || ['improve'],
    recommendation_reason: (swarmIntel && swarmIntel.reason) || 'Utility evaluation complete',
    health_score: (swarmIntel && swarmIntel.healthScore) || 95,
    agents: result
  };
}

function readAgentLogs(projectId, agentName, maxLines = 200) {
  const pid = projectId || 'default';
  const agent = (agentName || 'setup').replace(/[^a-zA-Z0-9_-]/g, '');
  const candidates = [];

  if (agent === 'setup') {
    if (pid !== 'default') candidates.push(path.join(PROJECTS_DIR, pid, 'setup.log'));
    candidates.push(path.join(HIVE_DIR, 'setup.log'));
  } else {
    if (pid !== 'default') {
      candidates.push(path.join(PROJECTS_DIR, pid, 'logs', `copilot-${agent}_${pid}.log`));
      candidates.push(path.join(PROJECTS_DIR, pid, 'logs', `copilot-${agent}.log`));
      candidates.push(path.join(PROJECTS_DIR, pid, `copilot-${agent}.log`));
    }
    candidates.push(path.join(HIVE_DIR, `copilot-${agent}_${pid}.log`));
    candidates.push(path.join(HIVE_DIR, `copilot-${agent}.log`));
    candidates.push(path.join(HIVE_DIR, 'logs', `copilot-${agent}.log`));
  }

  for (const logPath of candidates) {
    if (fs.existsSync(logPath)) {
      try {
        const content = fs.readFileSync(logPath, 'utf8');
        const allLines = content.split(/\r?\n/);
        const tail = allLines.slice(-Math.max(10, Math.min(2000, Number(maxLines) || 200))).join('\n');
        return {
          project: pid,
          agent,
          log_file: path.relative(HIVE_DIR, logPath),
          total_lines: allLines.length,
          logs: tail
        };
      } catch {}
    }
  }

  // Fallback synthetic status trace if agent hasn't written a log file yet
  const agentPayload = buildProjectAgentsPayload(pid);
  const info = agentPayload.agents[agent];
  const fallbackLines = [
    `[COPILOT-HIVE] Stream initialized for agent "${agent}" (project: ${pid})`,
    info ? `[STATUS] state=${info.status.toUpperCase()} | utility_score=${info.utility_score}/100 | last_exit=${info.last_exit_code}` : `[STATUS] Standby`,
    info ? `[ROLE] ${info.icon} ${info.name} — ${info.role}` : '',
    info ? `[REASON] ${info.utility_reason}` : '',
    `[INFO] No log file on disk yet. Click "▶ Launch Agent" to stream live execution output.`
  ].filter(Boolean).join('\n');

  return {
    project: pid,
    agent,
    log_file: null,
    total_lines: 5,
    logs: fallbackLines
  };
}

function getAdminIdeasFile(projectId) {
  const ideasDir = resolveProjectIdeasDir(projectId);
  const target = path.join(ideasDir, 'admin_ideas.json');
  if (!fs.existsSync(target)) {
    const example = path.join(HIVE_DIR, 'ideas', 'admin_ideas.example.json');
    if (fs.existsSync(example)) {
      try {
        fs.copyFileSync(example, target);
      } catch {
        fs.writeFileSync(target, JSON.stringify({ ideas: [] }, null, 2), 'utf8');
      }
    } else {
      fs.writeFileSync(target, JSON.stringify({ ideas: [] }, null, 2), 'utf8');
    }
  }
  return target;
}

function readProjectIdeas(projectId) {
  const ideasDir = resolveProjectIdeasDir(projectId);
  const file = getAdminIdeasFile(projectId);
  const engine = getHiveEngine();
  const scoreFn = (engine && typeof engine.scoreIdeaICE === 'function')
    ? engine.scoreIdeaICE
    : (idea) => {
        const impact = Number(idea.impact) || (idea.urgent ? 9.5 : 7.5);
        const confidence = Number(idea.confidence) || 8.0;
        const ease = Number(idea.ease) || 7.5;
        const rawIce = Number((impact * confidence * ease).toFixed(1));
        return { ...idea, impact, confidence, ease, rawIce, iceScore: Number(Math.min(100, rawIce / 10).toFixed(1)) };
      };

  let rawIdeas = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    rawIdeas = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.ideas) ? parsed.ideas : []);
  } catch {
    rawIdeas = [];
  }

  const enrichedIdeas = rawIdeas.map(item => {
    const scored = scoreFn(item);
    return {
      ...item,
      id: item.id || scored.id,
      title: item.title || scored.title,
      description: item.description || '',
      type: item.type || (item.urgent ? 'bug' : 'idea'),
      urgent: Boolean(item.urgent),
      status: item.status || 'pending',
      impact: scored.impact,
      confidence: scored.confidence,
      ease: scored.ease,
      iceScore: scored.iceScore,
      submitted_at: item.submitted_at || new Date().toISOString(),
      submitted_by: item.submitted_by || 'admin'
    };
  });

  enrichedIdeas.sort((a, b) => {
    if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
    return (b.iceScore || 0) - (a.iceScore || 0);
  });

  // Read implemented.log
  const implCandidates = [
    path.join(ideasDir, 'implemented.log'),
    path.join(HIVE_DIR, 'ideas', 'implemented.log')
  ];
  let implementedLog = [];
  for (const ic of implCandidates) {
    if (fs.existsSync(ic)) {
      try {
        implementedLog = fs.readFileSync(ic, 'utf8')
          .split(/\r?\n/)
          .map(l => l.trim())
          .filter(Boolean)
          .reverse()
          .slice(0, 100);
        break;
      } catch {}
    }
  }

  return {
    project: projectId || 'default',
    ideas: enrichedIdeas,
    implemented: implementedLog,
    stats: {
      total: enrichedIdeas.length,
      urgent: enrichedIdeas.filter(i => i.urgent && i.status !== 'implemented').length,
      pending: enrichedIdeas.filter(i => i.status === 'pending').length,
      in_progress: enrichedIdeas.filter(i => i.status === 'in_progress').length,
      implemented: enrichedIdeas.filter(i => i.status === 'implemented').length + implementedLog.length
    }
  };
}

function writeProjectIdeas(projectId, ideasArray) {
  const file = getAdminIdeasFile(projectId);
  fs.writeFileSync(file, JSON.stringify({ ideas: ideasArray }, null, 2), 'utf8');
  try {
    const cm = getContextMode();
    if (cm && typeof cm.indexContent === 'function') {
      cm.indexContent({ path: file, source: 'ideas/admin_ideas.json', projectId, force: true });
    }
  } catch {}
}

function readProjectResearch(projectId) {
  const ideasDir = resolveProjectIdeasDir(projectId);
  const rootDir = resolveProjectRoot(projectId);
  const researchSpecs = [
    { file: 'radical_latest.md', agent: 'radical', title: 'Radical Visionary — 10x Feature Research', icon: '🔥' },
    { file: 'api_architect_latest.md', agent: 'architect-api', title: 'Systems & API Architect — Backend Specs', icon: '⚙️' },
    { file: 'website_designer_latest.md', agent: 'designer-web', title: 'Web UI/UX Designer — Landing & Motion Specs', icon: '🎨' },
    { file: 'portal_designer_latest.md', agent: 'designer-portal', title: 'Portal Designer — Dashboard & Workflow Specs', icon: '🖥️' },
    { file: 'lawyer_latest.md', agent: 'lawyer', title: 'Legal & IP Counsel — Policy & Terms Review', icon: '⚖️' },
    { file: 'audit_latest.md', agent: 'audit', title: 'Code & Security Auditor — OWASP & Logic Report', icon: '🔍' },
    { file: 'gitguardian_latest.md', agent: 'gitguardian', title: 'GitGuardian — Repository Hygiene & Secret Scan', icon: '🛡️' },
    { file: 'compliance_checklist.json', agent: 'compliance', title: 'Compliance Officer — SOC2 / GDPR / OWASP Matrix', icon: '📋' }
  ];

  const documents = [];
  for (const spec of researchSpecs) {
    const candidates = [
      path.join(ideasDir, spec.file),
      path.join(HIVE_DIR, 'ideas', spec.file)
    ];
    let foundPath = candidates.find(p => fs.existsSync(p));
    if (foundPath) {
      try {
        const stat = fs.statSync(foundPath);
        const raw = fs.readFileSync(foundPath, 'utf8');
        documents.push({
          file: spec.file,
          agent: spec.agent,
          title: spec.title,
          icon: spec.icon,
          exists: true,
          size_bytes: stat.size,
          updated_at: stat.mtime.toISOString(),
          format: spec.file.endsWith('.json') ? 'json' : 'markdown',
          content: raw
        });
      } catch {}
    } else {
      documents.push({
        file: spec.file,
        agent: spec.agent,
        title: spec.title,
        icon: spec.icon,
        exists: false,
        size_bytes: 0,
        updated_at: null,
        format: spec.file.endsWith('.json') ? 'json' : 'markdown',
        content: `# ${spec.title}\n\n_No research artifact generated yet for \`${spec.file}\`. Launch the **${spec.agent}** agent to populate this report._`
      });
    }
  }

  // Read recent changelogs
  const changelogDirs = [
    path.join(rootDir, 'changelogs'),
    path.join(HIVE_DIR, 'changelogs')
  ];
  const changelogs = [];
  for (const cDir of changelogDirs) {
    if (fs.existsSync(cDir)) {
      try {
        const files = fs.readdirSync(cDir)
          .filter(f => f.endsWith('.md') || f.endsWith('.txt'))
          .sort()
          .reverse()
          .slice(0, 15);
        for (const f of files) {
          const fp = path.join(cDir, f);
          const st = fs.statSync(fp);
          changelogs.push({
            file: f,
            updated_at: st.mtime.toISOString(),
            size_bytes: st.size,
            content: fs.readFileSync(fp, 'utf8').slice(0, 12000)
          });
        }
        if (changelogs.length > 0) break;
      } catch {}
    }
  }

  // Also include root CHANGELOG.md if no per-run changelogs yet
  if (changelogs.length === 0 && fs.existsSync(path.join(HIVE_DIR, 'CHANGELOG.md'))) {
    try {
      const fp = path.join(HIVE_DIR, 'CHANGELOG.md');
      const st = fs.statSync(fp);
      changelogs.push({
        file: 'CHANGELOG.md',
        updated_at: st.mtime.toISOString(),
        size_bytes: st.size,
        content: fs.readFileSync(fp, 'utf8').slice(0, 15000)
      });
    } catch {}
  }

  return {
    project: projectId || 'default',
    documents,
    changelogs
  };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

async function handleRequest(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  const method = req.method;

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  // ── GET / ── serve SPA ───────────────────────────────────────────
  if (method === 'GET' && pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(getHTML());
  }

  // ── GET /api/discover-folders ─────────────────────────────────────
  if (method === 'GET' && pathname === '/api/discover-folders') {
    const scanDir = url.searchParams.get('dir') || process.env.DISCOVER_DIR || path.dirname(HIVE_DIR);
    try {
      const entries = fs.readdirSync(scanDir, { withFileTypes: true });
      const registry = readRegistry();
      const folders = entries
        .filter(e => e.isDirectory() && !e.name.startsWith('.'))
        .map(e => {
          const fullPath = path.join(scanDir, e.name);
          const isGit = fs.existsSync(path.join(fullPath, '.git'));
          const hasPkg = fs.existsSync(path.join(fullPath, 'package.json'));
          const hasReqs = fs.existsSync(path.join(fullPath, 'requirements.txt'));
          const hasCargo = fs.existsSync(path.join(fullPath, 'Cargo.toml'));
          const hasGoMod = fs.existsSync(path.join(fullPath, 'go.mod'));
          const hasDockerfile = fs.existsSync(path.join(fullPath, 'Dockerfile'));
          const hasCompose = fs.existsSync(path.join(fullPath, 'docker-compose.yml')) || fs.existsSync(path.join(fullPath, 'docker-compose.yaml'));
          const tech = [];
          if (hasPkg) tech.push('Node.js');
          if (hasReqs) tech.push('Python');
          if (hasCargo) tech.push('Rust');
          if (hasGoMod) tech.push('Go');
          if (hasDockerfile) tech.push('Docker');
          if (hasCompose) tech.push('Compose');
          const registered = registry.some(r => r.path === fullPath);
          return { name: e.name, path: fullPath, is_git: isGit, tech, has_dockerfile: hasDockerfile, has_compose: hasCompose, registered };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      return json(res, 200, { parent: scanDir, folders });
    } catch (err) {
      return json(res, 500, { error: 'Cannot read directory: ' + scanDir, message: err.message });
    }
  }

  // ── GET /api/next-port ──────────────────────────────────────────
  if (method === 'GET' && pathname === '/api/next-port') {
    const findPort = () => new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.listen(0, '0.0.0.0', () => {
        const port = srv.address().port;
        srv.close(() => resolve(port));
      });
      srv.on('error', reject);
    });
    try {
      const port = await findPort();
      return json(res, 200, { port });
    } catch {
      const port = 10000 + Math.floor(Math.random() * 50000);
      return json(res, 200, { port, fallback: true });
    }
  }

  // ── GET /api/topologies ─────────────────────────────────────────
  if (method === 'GET' && pathname === '/api/topologies') {
    const projectId = url.searchParams.get('project') || 'default';
    const requestedTopo = url.searchParams.get('topology') || undefined;
    const cfg = projectId !== 'default' ? readProjectConfig(projectId) : null;
    const activeTopo = requestedTopo || (cfg && cfg.topology) || 'adaptive-swarm';
    const engine = getHiveEngine();

    if (engine && typeof engine.evaluateSwarmIntelligence === 'function') {
      try {
        const intel = engine.evaluateSwarmIntelligence(projectId, { topology: activeTopo });
        const topologies = {};
        for (const [k, t] of Object.entries(engine.TOPOLOGIES || {})) {
          topologies[k] = {
            id: t.id,
            name: t.name,
            tagline: t.tagline,
            description: t.description,
            algorithm: t.algorithm,
            nodes: t.nodes,
            edges: t.edges
          };
        }
        return json(res, 200, {
          project: projectId,
          activeTopology: intel.topology,
          topologyName: intel.topologyName,
          recommendedAgent: intel.recommendedAgent,
          recommendedCohort: intel.recommendedCohort,
          reason: intel.reason,
          healthScore: intel.healthScore,
          agentScores: intel.agentScores,
          prioritizedIdeas: intel.prioritizedIdeas,
          pipelineState: intel.pipelineState,
          contextStats: intel.contextStats,
          topologyGraph: intel.topologyGraph,
          topologies
        });
      } catch (err) {
        return json(res, 500, { error: 'Failed to evaluate swarm intelligence', message: err.message });
      }
    }

    return json(res, 200, {
      project: projectId,
      activeTopology: activeTopo,
      topologyName: 'Adaptive Utility-Scored Swarm',
      recommendedAgent: 'improve',
      recommendedCohort: ['improve', 'deployer', 'regressiontest'],
      reason: 'Fallback topology router ready',
      healthScore: 95,
      agentScores: {},
      prioritizedIdeas: [],
      topologies: {}
    });
  }

  // ── Context-Mode Studio Endpoints (/api/context-mode/*) ─────────
  if (method === 'GET' && pathname === '/api/context-mode/stats') {
    const projectId = url.searchParams.get('project') || 'default';
    const cm = getContextMode();
    if (cm) {
      try {
        const stats = cm.getContextStats(projectId);
        if (stats.totalChunks === 0) {
          cm.syncProjectKnowledge(projectId);
          return json(res, 200, cm.getContextStats(projectId));
        }
        return json(res, 200, stats);
      } catch (err) {
        return json(res, 500, { error: err.message });
      }
    }
    return json(res, 200, {
      totalChunks: 0, codeChunks: 0, proseChunks: 0, sources: [],
      totalSearches: 0, sandboxRuns: 0, rawBytesIndexed: 0,
      rawBytesAvoided: 0, bytesReturned: 0, estimatedTokensSaved: 0, savingsRatioPercent: 0
    });
  }

  if (method === 'POST' && pathname === '/api/context-mode/search') {
    const body = await parseBody(req);
    const projectId = body.project || url.searchParams.get('project') || 'default';
    const queries = body.queries || body.query || ['architecture overview'];
    const cm = getContextMode();
    if (!cm) return json(res, 503, { error: 'context-mode engine unavailable' });
    try {
      const result = cm.searchKnowledge({
        queries,
        source: body.source || undefined,
        contentType: body.contentType || undefined,
        limit: Number(body.limit) || 6,
        sort: body.sort || 'relevance',
        projectId
      });
      return json(res, 200, result);
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  if (method === 'POST' && pathname === '/api/context-mode/index') {
    const body = await parseBody(req);
    const projectId = body.project || url.searchParams.get('project') || 'default';
    const cm = getContextMode();
    if (!cm) return json(res, 503, { error: 'context-mode engine unavailable' });
    try {
      if (body.content) {
        const indexed = cm.indexContent({
          source: body.source || body.title || 'custom-architecture-note.md',
          content: body.content,
          projectId,
          tags: body.tags || ['custom', 'note'],
          force: true
        });
        return json(res, 200, { status: 'indexed', ...indexed, stats: cm.getContextStats(projectId) });
      }
      const synced = cm.syncProjectKnowledge(projectId);
      return json(res, 200, { status: 'synced', ...synced });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  if (method === 'POST' && pathname === '/api/context-mode/execute') {
    const body = await parseBody(req);
    const projectId = body.project || url.searchParams.get('project') || 'default';
    const cm = getContextMode();
    if (!cm) return json(res, 503, { error: 'context-mode sandbox unavailable' });
    try {
      const result = cm.executeSandbox({
        language: body.language || 'javascript',
        code: body.code || 'console.log("Ready")',
        filePath: body.filePath || undefined,
        intent: body.intent || undefined,
        projectId,
        cwd: HIVE_DIR
      });
      return json(res, 200, result);
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  // ── Prompts Studio Endpoints (/api/prompts & /api/prompts/:name) ─
  if (method === 'GET' && pathname === '/api/prompts') {
    try {
      if (!fs.existsSync(PROMPTS_DIR)) fs.mkdirSync(PROMPTS_DIR, { recursive: true });
      const files = fs.readdirSync(PROMPTS_DIR).filter(f => f.endsWith('.md')).sort();
      const prompts = files.map(f => {
        const fp = path.join(PROMPTS_DIR, f);
        const st = fs.statSync(fp);
        const content = fs.readFileSync(fp, 'utf8');
        const name = f.replace(/\.md$/, '');
        return {
          name,
          file: f,
          size_bytes: st.size,
          updated_at: st.mtime.toISOString(),
          content
        };
      });
      return json(res, 200, { prompts });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  const promptMatch = pathname.match(/^\/api\/prompts\/([a-zA-Z0-9_-]+?)(\.md)?$/);
  if (promptMatch && method === 'PUT') {
    const name = promptMatch[1];
    const body = await parseBody(req);
    if (typeof body.content !== 'string') {
      return json(res, 400, { error: 'content (string) is required' });
    }
    if (!fs.existsSync(PROMPTS_DIR)) fs.mkdirSync(PROMPTS_DIR, { recursive: true });
    const fp = path.join(PROMPTS_DIR, `${name}.md`);
    fs.writeFileSync(fp, body.content, 'utf8');
    return json(res, 200, { status: 'saved', name, file: `${name}.md`, size_bytes: Buffer.byteLength(body.content, 'utf8') });
  }

  // ── GET /api/projects ────────────────────────────────────────────
  if (method === 'GET' && pathname === '/api/projects') {
    const registry = readRegistry();
    const projects = registry.map(entry => {
      const cfg = readProjectConfig(entry.id);
      const merged = cfg ? { ...entry, ...cfg } : normalizeProjectConfig({ ...entry });
      merged.paused = isProjectPaused(entry.id);
      return merged;
    });
    return json(res, 200, projects);
  }

  // ── POST /api/projects ───────────────────────────────────────────
  if (method === 'POST' && pathname === '/api/projects') {
    const body = await parseBody(req);
    const id = slugify(body.id || body.name);
    if (!id || !body.name) return json(res, 400, { error: 'id and name are required' });

    const existingRegistry = readRegistry();
    if (existingRegistry.some(e => e.id === id)) {
      return json(res, 409, { error: 'Project "' + id + '" already exists' });
    }

    const projectDir = path.join(PROJECTS_DIR, id);
    const ideasDir = path.join(projectDir, 'ideas');
    const logsDir = path.join(projectDir, 'logs');
    const changelogsDir = path.join(projectDir, 'changelogs');

    fs.mkdirSync(ideasDir, { recursive: true });
    fs.mkdirSync(logsDir, { recursive: true });
    fs.mkdirSync(changelogsDir, { recursive: true });

    const compose_file = body.compose_file || (body.docker && body.docker.compose_file) || '';
    const containers = body.containers || (body.docker && body.docker.containers) || {};
    const health_url = body.health_url || (body.docker && body.docker.health_url) || 'http://localhost:8080/';
    const version_url = body.version_url || (body.docker && body.docker.version_url) || '';
    const topology = body.topology || 'adaptive-swarm';

    const projectConfig = normalizeProjectConfig({
      id,
      name: body.name,
      path: body.path || '',
      github_repo: body.github_repo || '',
      description: body.description || '',
      tech_stack: body.tech_stack || '',
      target_market: body.target_market || '',
      compose_file,
      containers,
      health_url,
      version_url,
      topology,
      docker: {
        compose_file,
        containers,
        health_url,
        version_url
      },
      agents: Array.isArray(body.agents) && body.agents.length > 0 ? body.agents : ALL_AGENTS,
      setup_status: 'running',
      created_at: new Date().toISOString(),
      competitors: Array.isArray(body.competitors) ? body.competitors : []
    });
    writeProjectConfig(id, projectConfig);

    const registry = readRegistry();
    if (!registry.find(e => e.id === id)) {
      registry.push({ id, name: body.name, path: body.path || '', description: body.description || '' });
      writeRegistry(registry);
    }

    const setupScript = path.join(HIVE_DIR, 'setup-project.sh');
    const logFile = path.join(projectDir, 'setup.log');
    if (fs.existsSync(setupScript)) {
      const logFd = fs.openSync(logFile, 'w');
      const child = spawn(setupScript, [id], {
        cwd: HIVE_DIR,
        detached: true,
        stdio: ['ignore', logFd, logFd]
      });
      child.unref();
      child.on('exit', (code) => {
        try { fs.closeSync(logFd); } catch {}
        try {
          const cfg = readProjectConfig(id);
          if (cfg) {
            cfg.setup_status = code === 0 ? 'complete' : 'error';
            writeProjectConfig(id, cfg);
          }
        } catch {}
      });
    } else {
      fs.writeFileSync(logFile, 'setup-project.sh not found — skipping setup.\n');
      projectConfig.setup_status = 'complete';
      writeProjectConfig(id, projectConfig);
    }

    return json(res, 201, { status: 'created', setup: 'running', project: projectConfig });
  }

  // ── Route matching for /api/projects/:id/* ───────────────────────
  const projectMatch = pathname.match(/^\/api\/projects\/([a-z0-9][a-z0-9-]*[a-z0-9]|[a-z0-9])(\/.*)?$/);
  if (projectMatch) {
    const id = projectMatch[1];
    const sub = projectMatch[2] || '';
    const isDefault = id === 'default';

    if (sub && sub !== '' && method === 'GET' && !isDefault) {
      const _reg = readRegistry();
      if (!_reg.some(e => e.id === id)) return json(res, 404, { error: 'Project not found' });
    }

    // GET /api/projects/:id
    if (method === 'GET' && sub === '') {
      if (isDefault) {
        return json(res, 200, normalizeProjectConfig({
          id: 'default',
          name: 'Copilot Hive Workspace',
          path: '/opt/projects/my-app',
          description: 'Default multi-agent swarm workspace',
          setup_status: 'complete',
          topology: 'adaptive-swarm',
          agents: ALL_AGENTS
        }));
      }
      const cfg = readProjectConfig(id);
      const registry = readRegistry();
      const inRegistry = registry.some(e => e.id === id);
      if (!cfg || !inRegistry) return json(res, 404, { error: 'Project not found' });
      return json(res, 200, { ...cfg, paused: isProjectPaused(id) });
    }

    // GET /api/projects/:id/status
    if (method === 'GET' && sub === '/status') {
      if (isDefault) return json(res, 200, { setup_status: 'complete' });
      const cfg = readProjectConfig(id);
      if (!cfg) return json(res, 404, { error: 'Project not found' });
      return json(res, 200, { setup_status: cfg.setup_status || 'pending' });
    }

    // GET /api/projects/:id/logs
    if (method === 'GET' && sub === '/logs') {
      const logData = readAgentLogs(id, 'setup', 200);
      return json(res, 200, { logs: logData.logs });
    }

    // GET /api/projects/:id/agent-logs?agent=<name>&lines=200
    if (method === 'GET' && sub === '/agent-logs') {
      const agent = url.searchParams.get('agent') || 'setup';
      const lines = Number(url.searchParams.get('lines')) || 200;
      return json(res, 200, readAgentLogs(id, agent, lines));
    }

    // PUT /api/projects/:id — update project config (both top-level & nested docker)
    if (method === 'PUT' && sub === '') {
      const body = await parseBody(req);
      const cfg = readProjectConfig(id);
      if (!cfg) return json(res, 404, { error: 'Project not found' });

      const updatable = ['name', 'path', 'github_repo', 'description', 'tech_stack', 'target_market', 'compose_file', 'containers', 'health_url', 'version_url', 'topology', 'agents', 'competitors', 'legal_sites'];
      for (const key of updatable) {
        if (body[key] !== undefined) cfg[key] = body[key];
      }
      if (body.docker && typeof body.docker === 'object') {
        if (body.docker.compose_file !== undefined) cfg.compose_file = body.docker.compose_file;
        if (body.docker.containers !== undefined) cfg.containers = body.docker.containers;
        if (body.docker.health_url !== undefined) cfg.health_url = body.docker.health_url;
        if (body.docker.version_url !== undefined) cfg.version_url = body.docker.version_url;
      }
      cfg.updated_at = new Date().toISOString();
      const saved = writeProjectConfig(id, cfg);

      const registry = readRegistry();
      const entry = registry.find(e => e.id === id);
      if (entry) {
        if (body.name) entry.name = body.name;
        if (body.path) entry.path = body.path;
        if (body.description !== undefined) entry.description = body.description;
        writeRegistry(registry);
      }

      return json(res, 200, saved);
    }

    // DELETE /api/projects/:id
    if (method === 'DELETE' && sub === '') {
      let registry = readRegistry();
      registry = registry.filter(e => e.id !== id);
      writeRegistry(registry);
      return json(res, 200, { status: 'removed' });
    }

    // POST /api/projects/:id/run-agent
    if (method === 'POST' && sub === '/run-agent') {
      const body = await parseBody(req);
      const agent = body.agent;
      if (!agent) return json(res, 400, { error: 'agent is required' });

      if (!isDefault) {
        const registry = readRegistry();
        if (!registry.some(e => e.id === id)) return json(res, 404, { error: 'Project not found' });
      }

      const agentScript = path.join(HIVE_DIR, 'run-agent.sh');
      if (!fs.existsSync(agentScript)) {
        return json(res, 500, { error: 'run-agent.sh not found' });
      }
      const args = isDefault ? [agent] : [agent, '--project', id];
      const child = spawn(agentScript, args, {
        cwd: HIVE_DIR,
        detached: true,
        stdio: 'ignore'
      });
      child.unref();
      return json(res, 200, { status: 'launched', agent, project: id });
    }

    // GET /api/projects/:id/agents — All 14 agents with pause + smart utility scores
    if (method === 'GET' && sub === '/agents') {
      if (!isDefault) {
        const registry = readRegistry();
        if (!registry.some(e => e.id === id)) return json(res, 404, { error: 'Project not found' });
      }
      return json(res, 200, buildProjectAgentsPayload(id));
    }

    // POST /api/projects/:id/agents/:agent/toggle-pause
    const agentPauseMatch = sub.match(/^\/agents\/([a-zA-Z0-9_-]+)\/toggle-pause$/);
    if (method === 'POST' && agentPauseMatch) {
      const agent = agentPauseMatch[1];
      if (!ALL_AGENTS.includes(agent)) {
        return json(res, 400, { error: `Unknown agent: ${agent}` });
      }
      const body = await parseBody(req);
      const rootDir = resolveProjectRoot(id);
      if (!fs.existsSync(rootDir)) fs.mkdirSync(rootDir, { recursive: true });
      const pauseFile = path.join(rootDir, `.agent-paused-${agent}`);
      const currentlyPaused = fs.existsSync(pauseFile);
      const targetPaused = typeof body.paused === 'boolean' ? body.paused : !currentlyPaused;

      if (targetPaused) {
        fs.writeFileSync(pauseFile, new Date().toISOString(), 'utf8');
      } else {
        try { fs.unlinkSync(pauseFile); } catch {}
      }

      return json(res, 200, {
        status: targetPaused ? 'paused' : 'resumed',
        paused: targetPaused,
        agent,
        project: id
      });
    }

    // POST /api/projects/:id/topology — Set active topology & optionally dispatch
    if (method === 'POST' && sub === '/topology') {
      const body = await parseBody(req);
      const topology = body.topology || 'adaptive-swarm';
      const validTopologies = ['cyclic-pipeline', 'star-hub', 'dag-mesh', 'adaptive-swarm', 'self-healing-ring'];
      if (!validTopologies.includes(topology)) {
        return json(res, 400, { error: `Invalid topology: ${topology}` });
      }

      if (!isDefault) {
        const cfg = readProjectConfig(id);
        if (!cfg) return json(res, 404, { error: 'Project not found' });
        cfg.topology = topology;
        cfg.updated_at = new Date().toISOString();
        writeProjectConfig(id, cfg);
      }

      const engine = getHiveEngine();
      let intel = null;
      if (engine && typeof engine.evaluateSwarmIntelligence === 'function') {
        try {
          intel = engine.evaluateSwarmIntelligence(id, { topology });
        } catch {}
      }

      let dispatchedAgent = null;
      if (body.dispatch || body.trigger) {
        dispatchedAgent = body.agent || (intel && intel.recommendedAgent) || 'dispatcher';
        const agentScript = path.join(HIVE_DIR, 'run-agent.sh');
        if (fs.existsSync(agentScript)) {
          const args = isDefault ? [dispatchedAgent] : [dispatchedAgent, '--project', id];
          const child = spawn(agentScript, args, {
            cwd: HIVE_DIR,
            detached: true,
            stdio: 'ignore'
          });
          child.unref();
        }
      }

      return json(res, 200, {
        status: 'updated',
        project: id,
        topology,
        dispatched: Boolean(dispatchedAgent),
        dispatched_agent: dispatchedAgent,
        recommended_agent: intel ? intel.recommendedAgent : 'improve',
        recommended_cohort: intel ? intel.recommendedCohort : ['improve'],
        reason: intel ? intel.reason : 'Topology updated'
      });
    }

    // Ideas CRUD: GET / POST / PUT / DELETE /api/projects/:id/ideas(/:ideaId)
    if (method === 'GET' && sub === '/ideas') {
      return json(res, 200, readProjectIdeas(id));
    }

    if (method === 'POST' && sub === '/ideas') {
      const body = await parseBody(req);
      if (!body.title) return json(res, 400, { error: 'title is required' });
      const file = getAdminIdeasFile(id);
      let current = [];
      try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        current = Array.isArray(parsed) ? parsed : (parsed.ideas || []);
      } catch {}

      const newIdea = {
        id: body.id || `${slugify(body.title).slice(0, 32) || 'idea'}-${Date.now().toString(36)}`,
        title: String(body.title).trim(),
        description: String(body.description || '').trim(),
        type: body.type || (body.urgent ? 'bug' : 'idea'),
        urgent: Boolean(body.urgent),
        status: body.status || 'pending',
        impact: Number(body.impact) || (body.urgent ? 9.5 : 8.0),
        confidence: Number(body.confidence) || 8.0,
        ease: Number(body.ease) || 7.5,
        submitted_at: new Date().toISOString(),
        submitted_by: body.submitted_by || 'admin'
      };
      current.unshift(newIdea);
      writeProjectIdeas(id, current);
      return json(res, 201, { status: 'created', idea: newIdea, ...readProjectIdeas(id) });
    }

    const ideaItemMatch = sub.match(/^\/ideas\/([^/]+)$/);
    if (ideaItemMatch && (method === 'PUT' || method === 'DELETE')) {
      const ideaId = decodeURIComponent(ideaItemMatch[1]);
      const file = getAdminIdeasFile(id);
      let current = [];
      try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        current = Array.isArray(parsed) ? parsed : (parsed.ideas || []);
      } catch {}

      if (method === 'DELETE') {
        const filtered = current.filter(i => i.id !== ideaId);
        writeProjectIdeas(id, filtered);
        return json(res, 200, { status: 'deleted', id: ideaId, ...readProjectIdeas(id) });
      }

      const body = await parseBody(req);
      const idx = current.findIndex(i => i.id === ideaId);
      if (idx === -1) return json(res, 404, { error: 'Idea not found' });

      const prevStatus = current[idx].status;
      const fields = ['title', 'description', 'urgent', 'status', 'type', 'impact', 'confidence', 'ease'];
      for (const f of fields) {
        if (body[f] !== undefined) current[idx][f] = body[f];
      }
      current[idx].updated_at = new Date().toISOString();
      writeProjectIdeas(id, current);

      if (body.status === 'implemented' && prevStatus !== 'implemented') {
        const ideasDir = resolveProjectIdeasDir(id);
        const implLog = path.join(ideasDir, 'implemented.log');
        const entryLine = `${new Date().toISOString()} | [ADMIN-IDEA] ${current[idx].title} (${current[idx].id})\n`;
        try { fs.appendFileSync(implLog, entryLine, 'utf8'); } catch {}
      }

      return json(res, 200, { status: 'updated', idea: current[idx], ...readProjectIdeas(id) });
    }

    // GET /api/projects/:id/research — Research vault & changelogs
    if (method === 'GET' && sub === '/research') {
      return json(res, 200, readProjectResearch(id));
    }

    // POST /api/projects/:id/rerun-setup
    if (method === 'POST' && sub === '/rerun-setup') {
      const cfg = readProjectConfig(id);
      if (!cfg) return json(res, 404, { error: 'Project not found' });
      cfg.setup_status = 'running';
      cfg.setup_step = 'Re-running setup';
      writeProjectConfig(id, cfg);
      const setupScript = path.join(HIVE_DIR, 'setup-project.sh');
      if (fs.existsSync(setupScript)) {
        const logFile = path.join(PROJECTS_DIR, id, 'setup.log');
        const logFd = fs.openSync(logFile, 'w');
        const child = spawn(setupScript, [id], { cwd: HIVE_DIR, detached: true, stdio: ['ignore', logFd, logFd] });
        child.unref();
        child.on('exit', (code) => {
          try { fs.closeSync(logFd); } catch {}
          try {
            const c = readProjectConfig(id);
            if (c) { c.setup_status = code === 0 ? 'complete' : 'error'; writeProjectConfig(id, c); }
          } catch {}
        });
      }
      return json(res, 200, { status: 'setup_restarted' });
    }

    // POST /api/projects/:id/pause
    if (method === 'POST' && sub === '/pause') {
      const rootDir = resolveProjectRoot(id);
      if (!fs.existsSync(rootDir)) fs.mkdirSync(rootDir, { recursive: true });
      const pauseFile = path.join(rootDir, '.agents-paused');
      fs.writeFileSync(pauseFile, new Date().toISOString(), 'utf8');
      return json(res, 200, { status: 'paused', paused: true, project: id });
    }

    // POST /api/projects/:id/resume
    if (method === 'POST' && sub === '/resume') {
      const rootDir = resolveProjectRoot(id);
      const pauseFile = path.join(rootDir, '.agents-paused');
      try { fs.unlinkSync(pauseFile); } catch {}
      return json(res, 200, { status: 'resumed', paused: false, project: id });
    }

    // GET /api/projects/:id/pause-status
    if (method === 'GET' && sub === '/pause-status') {
      return json(res, 200, { paused: isProjectPaused(id), project: id });
    }
  }

  // ── 404 ──────────────────────────────────────────────────────────
  json(res, 404, { error: 'Not found' });
}

// ---------------------------------------------------------------------------
// Server & Module Exports
// ---------------------------------------------------------------------------

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch(err => {
    console.error('Request error:', err);
    json(res, 500, { error: 'Internal server error' });
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`🐝 Copilot Hive v2.0 Magic UI Dashboard running at http://localhost:${PORT}`);
  });
}

module.exports = {
  server,
  handleRequest,
  getHTML,
  ALL_AGENTS,
  normalizeProjectConfig
};
