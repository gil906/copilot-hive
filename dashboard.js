#!/usr/bin/env node
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { spawn, execSync } = require('child_process');
const net = require('net');

const PORT = 9096;
const HIVE_DIR = __dirname;
const PROJECTS_DIR = path.join(HIVE_DIR, 'projects');
const REGISTRY_FILE = path.join(PROJECTS_DIR, 'registry.json');

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
    // Support both array format and {projects:[]} format
    if (Array.isArray(raw)) return raw;
    if (raw && Array.isArray(raw.projects)) return raw.projects;
    return [];
  } catch { return []; }
}

function writeRegistry(data) {
  ensureProjectsDir();
  // Preserve the wrapper object format if registry already uses it
  let existing;
  try { existing = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8')); } catch { existing = null; }
  if (existing && !Array.isArray(existing) && 'projects' in existing) {
    existing.projects = data;
    fs.writeFileSync(REGISTRY_FILE, JSON.stringify(existing, null, 2), 'utf8');
  } else {
    fs.writeFileSync(REGISTRY_FILE, JSON.stringify(data, null, 2), 'utf8');
  }
}

function readProjectConfig(id) {
  const p = path.join(PROJECTS_DIR, id, 'project.json');
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function writeProjectConfig(id, data) {
  const dir = path.join(PROJECTS_DIR, id);
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(data, null, 2), 'utf8');
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
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// ---------------------------------------------------------------------------
// HTML SPA
// ---------------------------------------------------------------------------

function getHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Copilot Hive — Project Manager</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0a0e1a;--card:#1a1f35;--card-hover:#222845;
  --accent:#00d4ff;--purple:#7c3aed;
  --success:#22c55e;--warning:#f59e0b;--error:#ef4444;
  --text:#e2e8f0;--muted:#94a3b8;--border:#2d3555;
  --radius:12px;
}
body{font-family:system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);min-height:100vh}
a{color:var(--accent);text-decoration:none}
button{cursor:pointer;font-family:inherit}

/* Header */
.header{display:flex;align-items:center;justify-content:space-between;padding:20px 32px;border-bottom:1px solid var(--border);background:linear-gradient(135deg,#0d1225 0%,#131836 100%)}
.header h1{font-size:1.5rem;font-weight:700;display:flex;align-items:center;gap:10px}
.header h1 span.bee{font-size:1.8rem}
.header h1 .sub{color:var(--muted);font-weight:400;font-size:.95rem;margin-left:4px}
.btn{padding:10px 20px;border:none;border-radius:8px;font-weight:600;font-size:.9rem;transition:all .2s}
.btn-primary{background:linear-gradient(135deg,var(--accent),var(--purple));color:#fff}
.btn-primary:hover{opacity:.9;transform:translateY(-1px)}
.btn-sm{padding:6px 14px;font-size:.8rem;border-radius:6px}
.btn-outline{background:transparent;border:1px solid var(--border);color:var(--text)}
.btn-outline:hover{border-color:var(--accent);color:var(--accent)}
.btn-danger{background:var(--error);color:#fff}
.btn-danger:hover{opacity:.85}
.btn-success{background:var(--success);color:#fff}

/* Grid */
.container{max-width:1400px;margin:0 auto;padding:28px 32px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:20px;margin-top:8px}

/* Cards */
.card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:22px;transition:all .25s;position:relative;overflow:hidden}
.card:hover{border-color:var(--accent);background:var(--card-hover);transform:translateY(-2px);box-shadow:0 8px 30px rgba(0,212,255,.08)}
.card-title{font-size:1.1rem;font-weight:700;display:flex;align-items:center;gap:8px;margin-bottom:4px}
.card-path{font-size:.8rem;color:var(--muted);font-family:monospace;margin-bottom:12px;word-break:break-all}
.card-desc{font-size:.85rem;color:var(--muted);margin-bottom:14px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.badge{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:.75rem;font-weight:600}
.badge-active{background:rgba(34,197,94,.15);color:var(--success)}
.badge-setup{background:rgba(245,158,11,.15);color:var(--warning)}
.badge-error{background:rgba(239,68,68,.15);color:var(--error)}
.badge-idle{background:rgba(148,163,184,.12);color:var(--muted)}
.card-meta{display:flex;gap:10px;align-items:center;margin-bottom:16px;flex-wrap:wrap}
.card-actions{display:flex;gap:8px;flex-wrap:wrap}
.agent-count{font-size:.8rem;color:var(--muted)}

/* Modal */
.overlay{position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:100;display:flex;align-items:flex-start;justify-content:center;padding:40px 20px;overflow-y:auto;backdrop-filter:blur(4px)}
.modal{background:var(--card);border:1px solid var(--border);border-radius:16px;width:100%;max-width:680px;padding:32px;animation:slideIn .25s ease}
@keyframes slideIn{from{opacity:0;transform:translateY(-20px)}to{opacity:1;transform:translateY(0)}}
.modal h2{font-size:1.3rem;margin-bottom:24px;display:flex;align-items:center;gap:10px}
.modal label{display:block;font-size:.85rem;font-weight:600;margin-bottom:6px;color:var(--muted)}
.modal input[type=text],.modal textarea{width:100%;padding:10px 14px;border:1px solid var(--border);border-radius:8px;background:#0d1225;color:var(--text);font-size:.9rem;font-family:inherit;transition:border-color .2s}
.modal input[type=text]:focus,.modal textarea:focus{outline:none;border-color:var(--accent)}
.modal textarea{min-height:90px;resize:vertical}
.field{margin-bottom:18px}
.field-row{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.field-row-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px}
.radio-group{display:flex;gap:16px;margin-bottom:10px}
.radio-group label{display:flex;align-items:center;gap:6px;cursor:pointer;color:var(--text);font-weight:400}
.radio-group input{accent-color:var(--accent)}
.checks{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.checks label{display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:400;color:var(--text);font-size:.85rem}
.checks input{accent-color:var(--accent);width:16px;height:16px}
.modal-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:24px;padding-top:18px;border-top:1px solid var(--border)}

/* Detail View */
.detail{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:28px;margin-top:8px}
.detail h2{font-size:1.3rem;margin-bottom:6px;display:flex;align-items:center;gap:10px}
.detail-path{font-family:monospace;font-size:.85rem;color:var(--muted);margin-bottom:16px}
.detail-section{margin-bottom:22px}
.detail-section h3{font-size:.95rem;font-weight:700;margin-bottom:10px;color:var(--accent);text-transform:uppercase;letter-spacing:.5px;font-size:.8rem}
.detail-grid{display:grid;grid-template-columns:140px 1fr;gap:6px 14px;font-size:.88rem}
.detail-grid dt{color:var(--muted);font-weight:600}
.detail-grid dd{word-break:break-all}
.log-box{background:#050810;border:1px solid var(--border);border-radius:8px;padding:16px;font-family:'Cascadia Code','Fira Code',monospace;font-size:.78rem;color:#8be9fd;max-height:350px;overflow-y:auto;white-space:pre-wrap;line-height:1.6}
.competitors-list{list-style:none;padding:0}
.competitors-list li{padding:8px 12px;border-bottom:1px solid var(--border);font-size:.88rem;display:flex;align-items:center;gap:8px}
.competitors-list li:last-child{border:none}
.agent-chips{display:flex;flex-wrap:wrap;gap:8px}
.agent-chip{padding:5px 12px;border-radius:6px;font-size:.8rem;font-weight:600;background:rgba(124,58,237,.15);color:var(--purple);cursor:pointer;border:1px solid transparent;transition:all .2s}
.agent-chip:hover{border-color:var(--purple);background:rgba(124,58,237,.25)}
.agent-chip.running{background:rgba(245,158,11,.15);color:var(--warning);border-color:var(--warning)}

.back-link{display:inline-flex;align-items:center;gap:6px;color:var(--muted);font-size:.9rem;margin-bottom:16px;cursor:pointer;transition:color .2s}
.back-link:hover{color:var(--accent)}

.empty{text-align:center;padding:80px 20px;color:var(--muted)}
.empty .icon{font-size:3rem;margin-bottom:16px}
.empty p{font-size:1rem;margin-bottom:24px}

.spinner{display:inline-block;width:16px;height:16px;border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .6s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}

.toast-container{position:fixed;top:20px;right:20px;z-index:200;display:flex;flex-direction:column;gap:8px}
.toast{padding:12px 20px;border-radius:8px;font-size:.88rem;font-weight:600;animation:slideIn .3s ease;box-shadow:0 4px 20px rgba(0,0,0,.4)}
.toast-success{background:var(--success);color:#fff}
.toast-error{background:var(--error);color:#fff}

.dropdown{position:relative;display:inline-block}
.dropdown-menu{position:absolute;right:0;top:100%;margin-top:4px;background:var(--card);border:1px solid var(--border);border-radius:8px;min-width:180px;z-index:50;box-shadow:0 8px 30px rgba(0,0,0,.4);overflow:hidden}
.dropdown-menu button{display:block;width:100%;text-align:left;padding:10px 16px;background:none;border:none;color:var(--text);font-size:.85rem;transition:background .15s}
.dropdown-menu button:hover{background:var(--card-hover)}

/* Project Selector */
.project-select{padding:8px 14px;border:1px solid var(--border);border-radius:8px;background:#0d1225;color:var(--text);font-size:.88rem;font-family:inherit;min-width:180px;cursor:pointer;transition:border-color .2s}
.project-select:focus{outline:none;border-color:var(--accent)}
.project-select option{background:var(--card);color:var(--text)}

/* Agent Status Panel */
.agent-status-panel{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:22px;margin-bottom:24px}
.agent-status-panel h3{font-size:.95rem;font-weight:700;margin-bottom:14px;display:flex;align-items:center;gap:8px}
.agent-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}
.agent-card{background:rgba(13,18,37,.6);border:1px solid var(--border);border-radius:10px;padding:14px;transition:all .25s}
.agent-card:hover{border-color:var(--accent);background:rgba(13,18,37,.9)}
.agent-card-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}
.agent-card-name{font-size:.85rem;font-weight:700}
.agent-status-dot{width:10px;height:10px;border-radius:50%;display:inline-block}
.agent-status-dot.running{background:var(--warning);box-shadow:0 0 8px var(--warning);animation:pulse 1.5s infinite}
.agent-status-dot.idle{background:var(--success)}
.agent-status-dot.error{background:var(--error)}
.agent-status-dot.unknown{background:var(--muted)}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.agent-card-step{font-size:.72rem;color:var(--muted);margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.agent-card-time{font-size:.7rem;color:var(--muted);margin-top:2px}
.agent-card-actions{margin-top:8px}
.agent-card-actions button{padding:4px 10px;font-size:.72rem;border-radius:4px;background:rgba(124,58,237,.15);color:var(--purple);border:1px solid transparent;cursor:pointer;transition:all .2s}
.agent-card-actions button:hover{border-color:var(--purple);background:rgba(124,58,237,.25)}
.stats-bar{background:linear-gradient(90deg,rgba(0,212,255,.06),rgba(124,58,237,.06));border-bottom:1px solid var(--border);padding:10px 32px;display:flex;gap:24px;align-items:center;font-size:.82rem;color:var(--muted)}
.stat-item{display:flex;align-items:center;gap:6px}
.stat-value{color:var(--text);font-weight:700}

/* Folder Picker */
.folder-picker{max-height:200px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;margin-top:6px;background:#050810}
.folder-item{display:flex;align-items:center;gap:10px;padding:8px 12px;cursor:pointer;border-bottom:1px solid rgba(45,53,85,.4);font-size:.84rem;transition:background .15s}
.folder-item:hover{background:rgba(0,212,255,.08)}
.folder-item.registered{opacity:.45;cursor:default}
.folder-item .folder-icon{font-size:1rem}
.folder-item .folder-name{font-weight:600;flex:1}
.folder-item .folder-tech{display:flex;gap:4px}
.folder-item .tech-tag{padding:1px 6px;border-radius:4px;font-size:.68rem;font-weight:600;background:rgba(124,58,237,.15);color:var(--purple)}
.folder-item .tech-tag.git{background:rgba(239,68,68,.12);color:var(--error)}
.folder-item .registered-tag{font-size:.7rem;color:var(--muted);font-style:italic}
.discover-btn{display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border:1px dashed var(--border);border-radius:8px;background:transparent;color:var(--accent);font-size:.82rem;cursor:pointer;transition:all .2s;margin-top:6px}
.discover-btn:hover{border-color:var(--accent);background:rgba(0,212,255,.06)}
.auto-port-btn{padding:4px 10px;border:1px solid var(--border);border-radius:6px;background:transparent;color:var(--accent);font-size:.75rem;cursor:pointer;transition:all .2s;margin-left:6px}
.auto-port-btn:hover{border-color:var(--accent);background:rgba(0,212,255,.08)}
</style>
</head>
<body>

<header class="header">
  <h1><span class="bee">🐝</span> Copilot Hive <span class="sub">— Project Manager</span></h1>
  <div style="display:flex;align-items:center;gap:12px">
    <select id="project-selector" class="project-select" onchange="onProjectSelect(this.value)">
      <option value="">All Projects</option>
    </select>
    <button class="btn btn-primary" onclick="showAddModal()">+ Add Project</button>
  </div>
</header>

<div id="stats-bar" class="stats-bar"></div>

<div class="container" id="app"></div>
<div class="toast-container" id="toasts"></div>

<script>
const API = '';
let currentView = 'list';
let currentProject = null;
let pollTimer = null;

// ── Toast ──────────────────────────────────────────────────────────
function toast(msg, type='success') {
  const el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ── API helpers ────────────────────────────────────────────────────
async function api(path, opts) {
  try {
    const r = await fetch(API + path, opts);
    if (!r.ok) { const e = await r.json().catch(()=>({})); throw new Error(e.error || r.statusText); }
    return r.json();
  } catch(e) { toast(e.message, 'error'); throw e; }
}

// ── Rendering ──────────────────────────────────────────────────────
function render() {
  populateProjectSelector();
  updateStatsBar();
  if (currentView === 'list') renderList();
  else if (currentView === 'detail') renderDetail();
}

async function renderList() {
  stopPolling();
  const app = document.getElementById('app');
  app.innerHTML = '<div style="text-align:center;padding:40px"><div class="spinner"></div></div>';
  let projects = [];
  try { projects = await api('/api/projects'); } catch { projects = []; }
  if (!projects.length) {
    app.innerHTML = \`<div class="empty"><div class="icon">📦</div><p>No projects yet. Add your first project to get started.</p><button class="btn btn-primary" onclick="showAddModal()">+ Add Project</button></div>\`;
    return;
  }
  let html = '<div class="grid">';
  for (const p of projects) {
    const st = statusBadge(p.setup_status);
    const agentCount = (p.agents||[]).length;
    html += \`
    <div class="card">
      <div class="card-title">📦 \${esc(p.name)}</div>
      <div class="card-path">\${esc(p.path||'')}</div>
      <div class="card-desc">\${esc(p.description||'')}</div>
      <div class="card-meta">
        \${st}
        <span class="agent-count">\${agentCount} agent\${agentCount!==1?'s':''}</span>
      </div>
      <div class="card-actions">
        <button class="btn btn-sm btn-outline" onclick="viewProject('\${esc(p.id)}')">View</button>
        \${p.setup_status==='running'?'<button class="btn btn-sm btn-outline" onclick="viewLogs(\\''+esc(p.id)+'\\')">Logs</button>':''}
        \${p.setup_status==='complete'?\`<div class="dropdown">
          <button class="btn btn-sm btn-outline" onclick="toggleDropdown(this)">Run Agent ▾</button>
          <div class="dropdown-menu" style="display:none">\${(p.agents||[]).map(a=>'<button onclick="runAgent(\\''+esc(p.id)+'\\',\\''+a+'\\')">'+agentLabel(a)+'</button>').join('')}</div>
        </div>\`:''}
        <button class="btn btn-sm btn-danger" onclick="deleteProject('\${esc(p.id)}')">✕</button>
      </div>
    </div>\`;
  }
  html += '</div>';
  app.innerHTML = html;
}

async function renderDetail() {
  const app = document.getElementById('app');
  app.innerHTML = '<div style="text-align:center;padding:40px"><div class="spinner"></div></div>';
  let p;
  try { p = await api('/api/projects/' + currentProject); } catch { currentView='list'; render(); return; }
  let logs = '';
  try { const l = await api('/api/projects/' + currentProject + '/logs'); logs = l.logs || ''; } catch {}

  const st = statusBadge(p.setup_status);
  const competitors = p.competitors || [];
  const containers = p.containers || {};
  const agents = p.agents || [];

  let html = \`
  <div class="back-link" onclick="currentView='list';render()">← Back to projects</div>
  <div class="detail">
    <h2>📦 \${esc(p.name)} \${st}</h2>
    <div class="detail-path">\${esc(p.path||'')}</div>

    <div class="detail-section">
      <h3>Configuration</h3>
      <dl class="detail-grid">
        <dt>ID</dt><dd>\${esc(p.id)}</dd>
        <dt>GitHub</dt><dd>\${esc(p.github_repo||'—')}</dd>
        <dt>Description</dt><dd>\${esc(p.description||'—')}</dd>
        <dt>Compose File</dt><dd>\${esc(p.compose_file||'—')}</dd>
        <dt>Health URL</dt><dd>\${esc(p.health_url||'—')}</dd>
        <dt>Containers</dt><dd>\${Object.entries(containers).map(([k,v])=>esc(k)+': '+esc(v)).join(', ')||'—'}</dd>
      </dl>
    </div>

    <div class="detail-section" id="detail-agents-section">
      <h3>Agents</h3>
      <div class="agent-chips">
        \${agents.map(a=>'<span class="agent-chip" onclick="runAgent(\\''+esc(p.id)+'\\',\\''+a+'\\')" title="Click to run">▶ '+agentLabel(a)+'</span>').join('')}
      </div>
    </div>

    \${competitors.length ? \`<div class="detail-section"><h3>Discovered Competitors</h3><ul class="competitors-list">\${competitors.map(c=>'<li>🔍 '+esc(typeof c==='string'?c:c.name||JSON.stringify(c))+'</li>').join('')}</ul></div>\` : ''}

    <div class="detail-section">
      <h3>Setup Log</h3>
      <div class="log-box" id="logbox">\${esc(logs)||'No log output yet.'}</div>
    </div>

    <div class="detail-section" style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn btn-sm btn-outline" onclick="showEditModal('\${esc(p.id)}')">✏️ Edit Project</button>
      <button class="btn btn-sm btn-outline" onclick="rerunSetup('\${esc(p.id)}')">🔄 Re-run Setup</button>
      <button class="btn btn-sm btn-outline" onclick="togglePause('\${esc(p.id)}')">⏸ Pause/Resume</button>
      <button class="btn btn-sm btn-danger" onclick="deleteProject('\${esc(p.id)}')">Delete Project</button>
    </div>
  </div>\`;
  app.innerHTML = html;

  // Fetch and display agent status in detail view
  (async () => {
    try {
      const data = await fetch(API + '/api/projects/' + currentProject + '/agents').then(r=>r.json());
      const agentsSection = document.getElementById('detail-agents-section');
      if (agentsSection && data.agents) {
        let statusHtml = '<h3>Agents</h3><div class="agent-grid">';
        for (const [name, info] of Object.entries(data.agents)) {
          const status = info.status || 'unknown';
          const dotClass = status === 'running' ? 'running' : status === 'idle' ? 'idle' : 'unknown';
          const statusLabel = status === 'running' ? '🔄 Running' : status === 'idle' ? '✅ Idle' : '⏳ Unknown';
          const step = info.current_step || '';
          const lastTime = info.status === 'running' ? info.started_at : info.finished_at;
          statusHtml += '<div class="agent-card">';
          statusHtml += '<div class="agent-card-header"><span class="agent-card-name">' + agentLabel(name) + '</span>';
          statusHtml += '<span class="agent-status-dot ' + dotClass + '"></span></div>';
          statusHtml += '<div style="font-size:.78rem;color:' + (status==='running'?'var(--warning)':'var(--success)') + '">' + statusLabel + '</div>';
          if (step) statusHtml += '<div class="agent-card-step">' + esc(step) + '</div>';
          if (lastTime) statusHtml += '<div class="agent-card-time">' + (status==='running'?'Started ':'Finished ') + timeAgo(lastTime) + '</div>';
          statusHtml += '<div class="agent-card-actions"><button onclick="runAgent(\\''+esc(currentProject)+'\\',\\''+name+'\\')">▶ Run</button></div>';
          statusHtml += '</div>';
        }
        statusHtml += '</div>';
        agentsSection.innerHTML = statusHtml;
      }
    } catch {}
  })();

  if (p.setup_status === 'running') startPolling();
  else stopPolling();
}

// ── Status helpers ─────────────────────────────────────────────────
function statusBadge(s) {
  if (s === 'complete') return '<span class="badge badge-active">✅ Active</span>';
  if (s === 'running') return '<span class="badge badge-setup">🔄 Setting up…</span>';
  if (s === 'error') return '<span class="badge badge-error">❌ Error</span>';
  return '<span class="badge badge-idle">⏳ Pending</span>';
}
const AGENT_LABELS = {improve:'Feature Engineer',audit:'Auditor',radical:'Radical Visionary',lawyer:'Lawyer','compliance':'Compliance Officer','designer-web':'Website Designer','designer-portal':'Portal Designer','architect-api':'API Architect'};
function agentLabel(a) { return AGENT_LABELS[a]||a; }
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

// ── Polling ────────────────────────────────────────────────────────
function startPolling() {
  stopPolling();
  pollTimer = setInterval(async () => {
    if (currentView !== 'detail' || !currentProject) { stopPolling(); return; }
    try {
      const st = await api('/api/projects/' + currentProject + '/status');
      const lb = document.getElementById('logbox');
      if (lb) {
        try { const l = await api('/api/projects/' + currentProject + '/logs'); lb.textContent = l.logs || 'No output yet.'; lb.scrollTop = lb.scrollHeight; } catch {}
      }
      if (st.setup_status !== 'running') { stopPolling(); renderDetail(); }
    } catch {}
  }, 3000);
}
function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

// ── Actions ────────────────────────────────────────────────────────
function viewProject(id) { currentProject = id; currentView = 'detail'; render(); }
function viewLogs(id) { viewProject(id); }

async function deleteProject(id) {
  if (!confirm('Remove project "' + id + '" from registry?')) return;
  try { await api('/api/projects/' + id, { method: 'DELETE' }); toast('Project removed'); currentView = 'list'; render(); } catch {}
}

async function runAgent(projectId, agent) {
  closeDropdowns();
  try { await api('/api/projects/' + projectId + '/run-agent', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({agent}) }); toast('Agent "' + agentLabel(agent) + '" launched'); } catch {}
}

async function rerunSetup(projectId) {
  if (!confirm('Re-run competitor discovery for this project?')) return;
  try { await api('/api/projects/' + projectId + '/rerun-setup', { method:'POST' }); toast('Setup re-started'); render(); } catch {}
}

async function togglePause(projectId) {
  try {
    const st = await api('/api/projects/' + projectId + '/pause-status');
    if (st.paused) {
      await api('/api/projects/' + projectId + '/resume', { method:'POST' });
      toast('Project resumed');
    } else {
      await api('/api/projects/' + projectId + '/pause', { method:'POST' });
      toast('Project paused');
    }
    render();
  } catch {}
}

async function updateStatsBar() {
  const bar = document.getElementById('stats-bar');
  if (!bar) return;
  let projects = [];
  try { projects = await api('/api/projects'); } catch { return; }
  const total = projects.length;
  const active = projects.filter(p => p.setup_status === 'complete').length;
  const setting = projects.filter(p => p.setup_status === 'running').length;
  bar.innerHTML = '<div class="stat-item">📦 <span class="stat-value">' + total + '</span> project' + (total!==1?'s':'') + '</div>'
    + '<div class="stat-item">✅ <span class="stat-value">' + active + '</span> active</div>'
    + (setting ? '<div class="stat-item">🔄 <span class="stat-value">' + setting + '</span> setting up</div>' : '')
    + '<div class="stat-item" style="margin-left:auto;font-size:.75rem;color:var(--muted)">🐝 Copilot Hive v1.7.0</div>';
}

function toggleDropdown(btn) {
  const menu = btn.nextElementSibling;
  const show = menu.style.display === 'none';
  closeDropdowns();
  if (show) menu.style.display = 'block';
}
function closeDropdowns() { document.querySelectorAll('.dropdown-menu').forEach(m => m.style.display = 'none'); }
document.addEventListener('click', e => { if (!e.target.closest('.dropdown')) closeDropdowns(); });

// ── Add Project Modal ──────────────────────────────────────────────
function showAddModal() {
  const existing = document.getElementById('modal-overlay');
  if (existing) existing.remove();

  const agents = [
    {id:'improve',label:'Feature Engineer'},
    {id:'audit',label:'Auditor'},
    {id:'radical',label:'Radical Visionary'},
    {id:'lawyer',label:'Lawyer'},
    {id:'compliance',label:'Compliance Officer'},
    {id:'designer-web',label:'Website Designer'},
    {id:'designer-portal',label:'Portal Designer'},
    {id:'architect-api',label:'API Architect'}
  ];

  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.id = 'modal-overlay';
  overlay.innerHTML = \`
  <div class="modal" onclick="event.stopPropagation()">
    <h2>🚀 Add New Project</h2>
    <form id="addForm" onsubmit="submitProject(event)">
      <div class="field-row">
        <div class="field">
          <label>Project Name *</label>
          <input type="text" id="f-name" required placeholder="My SaaS App" oninput="autoSlug()">
        </div>
        <div class="field">
          <label>Project ID</label>
          <input type="text" id="f-id" required placeholder="my-saas-app" pattern="[a-z0-9][a-z0-9-]*[a-z0-9]">
        </div>
      </div>

      <div class="field">
        <label>Source</label>
        <div class="radio-group">
          <label><input type="radio" name="source" value="local" checked onchange="toggleSource()"> Existing local path</label>
          <label><input type="radio" name="source" value="github" onchange="toggleSource()"> Clone from GitHub</label>
        </div>
      </div>

      <div id="source-local">
        <div class="field">
          <label>Local Path *</label>
          <input type="text" id="f-path" placeholder="/opt/my-saas-app">
          <div style="margin-top:8px">
            <div style="display:flex;gap:8px;align-items:center">
              <input type="text" id="f-scan-dir" placeholder="Directory to scan (e.g. /mnt/media)" style="flex:1;padding:7px 12px;border:1px solid var(--border);border-radius:6px;background:#0d1225;color:var(--text);font-size:.82rem">
              <button type="button" class="discover-btn" onclick="discoverFolders()">🔍 Discover</button>
            </div>
            <div id="folder-picker"></div>
          </div>
        </div>
      </div>
      <div id="source-github" style="display:none">
        <div class="field-row">
          <div class="field">
            <label>GitHub Repo *</label>
            <input type="text" id="f-repo" placeholder="user/my-saas-app">
          </div>
          <div class="field">
            <label>Clone To Path *</label>
            <input type="text" id="f-clone-path" placeholder="/opt/my-saas-app">
          </div>
        </div>
      </div>

      <div class="field">
        <label>Description *</label>
        <textarea id="f-desc" required placeholder="Describe what your project does, how it works, who it's for, what tech stack it uses..."></textarea>
      </div>

      <div class="field-row">
        <div class="field">
          <label>Docker Compose File</label>
          <input type="text" id="f-compose" placeholder="/opt/docker-compose/my-saas.yml">
        </div>
        <div class="field">
          <label>Health Check URL <button type="button" class="auto-port-btn" onclick="autoPort()">🎲 Auto-port</button></label>
          <input type="text" id="f-health" placeholder="http://localhost:8080/" value="http://localhost:8080/">
        </div>
      </div>

      <div class="field">
        <label>Container Names (optional)</label>
        <div class="field-row-3">
          <div><label style="font-size:.75rem">API</label><input type="text" id="f-c-api" placeholder="my-app-api"></div>
          <div><label style="font-size:.75rem">Web</label><input type="text" id="f-c-web" placeholder="my-app-web"></div>
          <div><label style="font-size:.75rem">DB</label><input type="text" id="f-c-db" placeholder="my-app-db"></div>
        </div>
      </div>

      <div class="field">
        <label>Agents</label>
        <div class="checks">
          \${agents.map(a => '<label><input type="checkbox" name="agents" value="'+a.id+'" checked> '+a.label+' ('+a.id+')</label>').join('')}
        </div>
      </div>

      <div class="modal-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary" id="createBtn">Create Project</button>
      </div>
    </form>
  </div>\`;
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
  document.body.appendChild(overlay);
}

function closeModal() { const o = document.getElementById('modal-overlay'); if (o) o.remove(); }

async function showEditModal(projectId) {
  const existing = document.getElementById('modal-overlay');
  if (existing) existing.remove();

  let p;
  try { p = await api('/api/projects/' + projectId); } catch { return; }

  const allAgents = [
    {id:'improve',label:'Feature Engineer'},{id:'audit',label:'Auditor'},
    {id:'radical',label:'Radical Visionary'},{id:'lawyer',label:'Lawyer'},
    {id:'compliance',label:'Compliance Officer'},{id:'designer-web',label:'Website Designer'},
    {id:'designer-portal',label:'Portal Designer'},{id:'architect-api',label:'API Architect'}
  ];
  const enabledAgents = p.agents || [];
  const containers = p.containers || {};

  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.id = 'modal-overlay';
  overlay.innerHTML = \`
  <div class="modal" onclick="event.stopPropagation()">
    <h2>✏️ Edit Project — \${esc(p.name)}</h2>
    <form id="editForm" onsubmit="submitEdit(event, '\${esc(projectId)}')">
      <div class="field">
        <label>Project Name</label>
        <input type="text" id="e-name" required value="\${esc(p.name || '')}">
      </div>
      <div class="field">
        <label>Path</label>
        <input type="text" id="e-path" value="\${esc(p.path || '')}">
      </div>
      <div class="field">
        <label>GitHub Repo</label>
        <input type="text" id="e-repo" value="\${esc(p.github_repo || '')}">
      </div>
      <div class="field">
        <label>Description</label>
        <textarea id="e-desc">\${esc(p.description || '')}</textarea>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Docker Compose File</label>
          <input type="text" id="e-compose" value="\${esc(p.compose_file || '')}">
        </div>
        <div class="field">
          <label>Health Check URL</label>
          <input type="text" id="e-health" value="\${esc(p.health_url || '')}">
        </div>
      </div>
      <div class="field">
        <label>Container Names</label>
        <div class="field-row-3">
          <div><label style="font-size:.75rem">API</label><input type="text" id="e-c-api" value="\${esc(containers.api || '')}"></div>
          <div><label style="font-size:.75rem">Web</label><input type="text" id="e-c-web" value="\${esc(containers.web || '')}"></div>
          <div><label style="font-size:.75rem">DB</label><input type="text" id="e-c-db" value="\${esc(containers.db || '')}"></div>
        </div>
      </div>
      <div class="field">
        <label>Agents</label>
        <div class="checks">
          \${allAgents.map(a => '<label><input type="checkbox" name="eagents" value="'+a.id+'" '+(enabledAgents.includes(a.id)?'checked':'')+'>'+a.label+'</label>').join('')}
        </div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Save Changes</button>
      </div>
    </form>
  </div>\`;
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
  document.body.appendChild(overlay);
}

async function submitEdit(e, projectId) {
  e.preventDefault();
  const containers = {};
  const cApi = document.getElementById('e-c-api').value.trim();
  const cWeb = document.getElementById('e-c-web').value.trim();
  const cDb = document.getElementById('e-c-db').value.trim();
  if (cApi) containers.api = cApi;
  if (cWeb) containers.web = cWeb;
  if (cDb) containers.db = cDb;
  const agentEls = document.querySelectorAll('input[name=eagents]:checked');
  const body = {
    name: document.getElementById('e-name').value.trim(),
    path: document.getElementById('e-path').value.trim(),
    github_repo: document.getElementById('e-repo').value.trim(),
    description: document.getElementById('e-desc').value.trim(),
    compose_file: document.getElementById('e-compose').value.trim(),
    health_url: document.getElementById('e-health').value.trim(),
    containers,
    agents: Array.from(agentEls).map(el => el.value)
  };
  try {
    await api('/api/projects/' + projectId, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
    toast('Project updated');
    closeModal();
    render();
  } catch {}
}

function autoSlug() {
  const name = document.getElementById('f-name').value;
  document.getElementById('f-id').value = name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
}

function toggleSource() {
  const isLocal = document.querySelector('input[name=source]:checked').value === 'local';
  document.getElementById('source-local').style.display = isLocal ? '' : 'none';
  document.getElementById('source-github').style.display = isLocal ? 'none' : '';
}

async function submitProject(e) {
  e.preventDefault();
  const btn = document.getElementById('createBtn');
  btn.disabled = true; btn.textContent = 'Creating…';

  const isLocal = document.querySelector('input[name=source]:checked').value === 'local';
  const agentEls = document.querySelectorAll('input[name=agents]:checked');
  const agents = Array.from(agentEls).map(el => el.value);

  const containers = {};
  const cApi = document.getElementById('f-c-api').value.trim();
  const cWeb = document.getElementById('f-c-web').value.trim();
  const cDb = document.getElementById('f-c-db').value.trim();
  if (cApi) containers.api = cApi;
  if (cWeb) containers.web = cWeb;
  if (cDb) containers.db = cDb;

  const body = {
    id: document.getElementById('f-id').value.trim(),
    name: document.getElementById('f-name').value.trim(),
    path: isLocal ? document.getElementById('f-path').value.trim() : document.getElementById('f-clone-path').value.trim(),
    github_repo: isLocal ? '' : document.getElementById('f-repo').value.trim(),
    description: document.getElementById('f-desc').value.trim(),
    compose_file: document.getElementById('f-compose').value.trim(),
    containers,
    health_url: document.getElementById('f-health').value.trim() || 'http://localhost:8080/',
    agents
  };

  try {
    await api('/api/projects', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    toast('Project created! Setup running in background.');
    closeModal();
    render();
  } catch {
    btn.disabled = false; btn.textContent = 'Create Project';
  }
}

// ── Folder Auto-Discovery ─────────────────────────────────────────
async function discoverFolders() {
  const picker = document.getElementById('folder-picker');
  if (!picker) return;
  const scanInput = document.getElementById('f-scan-dir');
  const scanDir = scanInput ? scanInput.value.trim() : '';
  const qs = scanDir ? '?dir=' + encodeURIComponent(scanDir) : '';
  picker.innerHTML = '<div style="padding:12px;text-align:center"><div class="spinner"></div> Scanning…</div>';
  try {
    const data = await api('/api/discover-folders' + qs);
    if (scanInput && !scanInput.value) scanInput.value = data.parent || '';
    if (!data.folders || !data.folders.length) {
      picker.innerHTML = '<div style="padding:12px;color:var(--muted);font-size:.84rem">No folders found in ' + esc(data.parent) + '</div>';
      return;
    }
    let html = '<div style="max-height:220px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;margin-top:8px;background:#050810">';
    html += '<div style="padding:6px 12px;font-size:.72rem;color:var(--muted);border-bottom:1px solid var(--border)">📁 ' + esc(data.parent) + ' — ' + data.folders.length + ' folders</div>';
    for (const f of data.folders) {
      if (f.registered) {
        html += '<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid rgba(45,53,85,.3);font-size:.84rem;opacity:.4;cursor:default">';
        html += '<span>📁</span><span style="flex:1;font-weight:600">' + esc(f.name) + '</span>';
        html += '<span style="font-size:.7rem;font-style:italic;color:var(--muted)">already added</span></div>';
      } else {
        html += '<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid rgba(45,53,85,.3);font-size:.84rem;cursor:pointer;transition:background .15s" onmouseover="this.style.background=\\'rgba(0,212,255,.08)\\'" onmouseout="this.style.background=\\'\\'" onclick="selectFolder(\\'' + esc(f.path) + '\\',\\'' + esc(f.name) + '\\')">';
        html += '<span>📂</span><span style="flex:1;font-weight:600">' + esc(f.name) + '</span>';
        if (f.is_git) html += '<span style="padding:1px 6px;border-radius:4px;font-size:.68rem;font-weight:600;background:rgba(239,68,68,.12);color:#ef4444">Git</span>';
        for (const t of f.tech) html += '<span style="padding:1px 6px;border-radius:4px;font-size:.68rem;font-weight:600;background:rgba(124,58,237,.15);color:#7c3aed">' + t + '</span>';
        html += '</div>';
      }
    }
    html += '</div>';
    picker.innerHTML = html;
  } catch (e) { picker.innerHTML = '<div style="padding:12px;color:var(--error);font-size:.84rem">Failed: ' + esc(e.message) + '</div>'; }
}

function selectFolder(folderPath, folderName) {
  document.getElementById('f-path').value = folderPath;
  const nameField = document.getElementById('f-name');
  if (!nameField.value) {
    // Auto-fill name from folder (capitalize, replace hyphens)
    nameField.value = folderName.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    autoSlug();
  }
  document.getElementById('folder-picker').style.display = 'none';
}

// ── Auto-Port ─────────────────────────────────────────────────────
async function autoPort() {
  try {
    const data = await api('/api/next-port');
    const healthField = document.getElementById('f-health');
    if (healthField) healthField.value = 'http://localhost:' + data.port + '/';
    toast('Port ' + data.port + ' assigned');
  } catch {}
}

// ── Project Selector ──────────────────────────────────────────────
let selectedProject = '';
let agentPollTimer = null;

async function populateProjectSelector() {
  const sel = document.getElementById('project-selector');
  if (!sel) return;
  let projects = [];
  try { projects = await api('/api/projects'); } catch { return; }
  const current = sel.value;
  sel.innerHTML = '<option value="">All Projects</option>';
  for (const p of projects) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name || p.id;
    if (p.id === current || p.id === selectedProject) opt.selected = true;
    sel.appendChild(opt);
  }
}

function onProjectSelect(projectId) {
  selectedProject = projectId;
  stopAgentPolling();
  if (currentView === 'list') render();
  if (projectId) startAgentPolling();
}

// ── Agent Status Panel ────────────────────────────────────────────
function timeAgo(iso) {
  if (!iso) return '';
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return diff + 's ago';
  if (diff < 3600) return Math.floor(diff/60) + 'm ago';
  if (diff < 86400) return Math.floor(diff/3600) + 'h ago';
  return Math.floor(diff/86400) + 'd ago';
}

function renderAgentStatus(agents, projectId) {
  if (!agents || !Object.keys(agents).length) return '';
  const projectName = document.getElementById('project-selector')?.selectedOptions?.[0]?.textContent || projectId;
  let html = '<div class="agent-status-panel">';
  html += '<h3>🤖 Agent Status — ' + esc(projectName) + '</h3>';
  html += '<div class="agent-grid">';
  for (const [name, info] of Object.entries(agents)) {
    const status = info.status || 'unknown';
    const dotClass = status === 'running' ? 'running' : status === 'idle' ? 'idle' : status === 'error' ? 'error' : 'unknown';
    const statusLabel = status === 'running' ? '🔄 Running' : status === 'idle' ? '✅ Idle' : status === 'error' ? '❌ Error' : '⏳ Unknown';
    const step = info.current_step || '';
    const lastTime = info.status === 'running' ? info.started_at : info.finished_at;
    const exitCode = info.last_exit_code;
    html += '<div class="agent-card">';
    html += '<div class="agent-card-header">';
    html += '<span class="agent-card-name">' + agentLabel(name) + '</span>';
    html += '<span class="agent-status-dot ' + dotClass + '" title="' + status + '"></span>';
    html += '</div>';
    html += '<div style="font-size:.78rem;color:' + (status==='running'?'var(--warning)':status==='idle'?'var(--success)':'var(--muted)') + '">' + statusLabel + '</div>';
    if (step) html += '<div class="agent-card-step" title="' + esc(step) + '">' + esc(step) + '</div>';
    if (lastTime) html += '<div class="agent-card-time">' + (status==='running'?'Started ':'Finished ') + timeAgo(lastTime) + '</div>';
    if (exitCode !== undefined && exitCode !== null && status !== 'running') html += '<div class="agent-card-time">Exit code: ' + exitCode + '</div>';
    html += '<div class="agent-card-actions"><button onclick="runAgent(\\''+esc(projectId)+'\\',\\''+name+'\\')">▶ Run</button></div>';
    html += '</div>';
  }
  html += '</div></div>';
  return html;
}

async function fetchAndRenderAgentStatus() {
  if (!selectedProject) return;
  try {
    const data = await fetch(API + '/api/projects/' + selectedProject + '/agents').then(r => r.json());
    let panel = document.getElementById('agent-status-container');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'agent-status-container';
      const app = document.getElementById('app');
      app.insertBefore(panel, app.firstChild);
    }
    panel.innerHTML = renderAgentStatus(data.agents, selectedProject);
  } catch {}
}

function startAgentPolling() {
  stopAgentPolling();
  fetchAndRenderAgentStatus();
  agentPollTimer = setInterval(fetchAndRenderAgentStatus, 5000);
}

function stopAgentPolling() {
  if (agentPollTimer) { clearInterval(agentPollTimer); agentPollTimer = null; }
  const panel = document.getElementById('agent-status-container');
  if (panel) panel.innerHTML = '';
}

// ── Init ───────────────────────────────────────────────────────────
render();
populateProjectSelector();
</script>
</body>
</html>`;
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
  // Lists directories at a given path for project autodiscovery
  // Query param ?dir=/some/path (defaults to parent of HIVE_DIR)
  if (method === 'GET' && pathname === '/api/discover-folders') {
    const scanDir = url.searchParams.get('dir') || process.env.DISCOVER_DIR || path.dirname(HIVE_DIR);
    try {
      const entries = fs.readdirSync(scanDir, { withFileTypes: true });
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
          let tech = [];
          if (hasPkg) tech.push('Node.js');
          if (hasReqs) tech.push('Python');
          if (hasCargo) tech.push('Rust');
          if (hasGoMod) tech.push('Go');
          if (hasDockerfile) tech.push('Docker');
          if (hasCompose) tech.push('Compose');
          const registry = readRegistry();
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
  // Finds an available TCP port on the server
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
      // Fallback: pick random in 10000-60000 range
      const port = 10000 + Math.floor(Math.random() * 50000);
      return json(res, 200, { port, fallback: true });
    }
  }

  // ── GET /api/projects ────────────────────────────────────────────
  if (method === 'GET' && pathname === '/api/projects') {
    const registry = readRegistry();
    const projects = registry.map(entry => {
      const cfg = readProjectConfig(entry.id);
      return cfg ? { ...entry, ...cfg } : entry;
    });
    return json(res, 200, projects);
  }

  // ── POST /api/projects ───────────────────────────────────────────
  if (method === 'POST' && pathname === '/api/projects') {
    const body = await parseBody(req);
    const id = body.id;
    if (!id || !body.name) return json(res, 400, { error: 'id and name are required' });

    // Check for duplicate project
    const existingRegistry = readRegistry();
    if (existingRegistry.some(e => e.id === id)) {
      return json(res, 409, { error: 'Project "' + id + '" already exists' });
    }

    const projectDir = path.join(PROJECTS_DIR, id);
    const ideasDir = path.join(projectDir, 'ideas');

    // 1. Create directories
    fs.mkdirSync(ideasDir, { recursive: true });

    // 2. Write project.json
    const projectConfig = {
      id: body.id,
      name: body.name,
      path: body.path || '',
      github_repo: body.github_repo || '',
      description: body.description || '',
      compose_file: body.compose_file || '',
      containers: body.containers || {},
      health_url: body.health_url || 'http://localhost:8080/',
      agents: body.agents || [],
      setup_status: 'running',
      created_at: new Date().toISOString(),
      competitors: []
    };
    writeProjectConfig(id, projectConfig);

    // 3. Add to registry
    const registry = readRegistry();
    if (!registry.find(e => e.id === id)) {
      registry.push({ id, name: body.name, path: body.path || '', description: body.description || '' });
      writeRegistry(registry);
    }

    // 4. Launch setup-project.sh in background
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
        fs.closeSync(logFd);
        try {
          const cfg = readProjectConfig(id);
          if (cfg) {
            cfg.setup_status = code === 0 ? 'complete' : 'error';
            writeProjectConfig(id, cfg);
          }
        } catch {}
      });
    } else {
      // No setup script — mark as complete immediately, write a log note
      fs.writeFileSync(logFile, 'setup-project.sh not found — skipping setup.\n');
      projectConfig.setup_status = 'complete';
      writeProjectConfig(id, projectConfig);
    }

    return json(res, 201, { status: 'created', setup: 'running' });
  }

  // ── Route matching for /api/projects/:id/* ───────────────────────
  const projectMatch = pathname.match(/^\/api\/projects\/([a-z0-9][a-z0-9-]*[a-z0-9]|[a-z0-9])(\/.*)?$/);
  if (projectMatch) {
    const id = projectMatch[1];
    const sub = projectMatch[2] || '';

    // For sub-routes (not DELETE or POST create), verify project exists
    if (sub && sub !== '' && method === 'GET') {
      const _reg = readRegistry();
      if (!_reg.some(e => e.id === id)) return json(res, 404, { error: 'Project not found' });
    }

    // GET /api/projects/:id
    if (method === 'GET' && sub === '') {
      const cfg = readProjectConfig(id);
      const registry = readRegistry();
      const inRegistry = registry.some(e => e.id === id);
      if (!cfg || !inRegistry) return json(res, 404, { error: 'Project not found' });
      return json(res, 200, cfg);
    }

    // GET /api/projects/:id/status
    if (method === 'GET' && sub === '/status') {
      const cfg = readProjectConfig(id);
      if (!cfg) return json(res, 404, { error: 'Project not found' });
      return json(res, 200, { setup_status: cfg.setup_status || 'pending' });
    }

    // GET /api/projects/:id/logs
    if (method === 'GET' && sub === '/logs') {
      const logPath = path.join(PROJECTS_DIR, id, 'setup.log');
      let logs = '';
      try { logs = fs.readFileSync(logPath, 'utf8'); } catch {}
      // Tail last 200 lines
      const lines = logs.split('\n');
      const tail = lines.slice(-200).join('\n');
      return json(res, 200, { logs: tail });
    }

    // PUT /api/projects/:id — update project config
    if (method === 'PUT' && sub === '') {
      const body = await parseBody(req);
      const cfg = readProjectConfig(id);
      if (!cfg) return json(res, 404, { error: 'Project not found' });

      // Merge updates
      const updatable = ['name','path','github_repo','description','compose_file','containers','health_url','agents'];
      for (const key of updatable) {
        if (body[key] !== undefined) cfg[key] = body[key];
      }
      cfg.updated_at = new Date().toISOString();
      writeProjectConfig(id, cfg);

      // Update registry entry
      const registry = readRegistry();
      const entry = registry.find(e => e.id === id);
      if (entry) {
        if (body.name) entry.name = body.name;
        if (body.path) entry.path = body.path;
        if (body.description !== undefined) entry.description = body.description;
        writeRegistry(registry);
      }

      return json(res, 200, cfg);
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

      // Verify project exists in registry
      const registry = readRegistry();
      if (!registry.some(e => e.id === id)) return json(res, 404, { error: 'Project not found' });

      const agentScript = path.join(HIVE_DIR, 'run-agent.sh');
      if (!fs.existsSync(agentScript)) {
        return json(res, 500, { error: 'run-agent.sh not found' });
      }
      const child = spawn(agentScript, [agent, '--project', id], {
        cwd: HIVE_DIR,
        detached: true,
        stdio: 'ignore'
      });
      child.unref();
      return json(res, 200, { status: 'launched', agent, project: id });
    }

    // GET /api/projects/:id/agents
    if (method === 'GET' && sub === '/agents') {
      // Verify project exists in registry
      const registry = readRegistry();
      if (!registry.some(e => e.id === id)) return json(res, 404, { error: 'Project not found' });

      let agentData = {};

      const projectStatusFile = path.join(PROJECTS_DIR, id, 'ideas', 'agent_status.json');
      const globalStatusFile = path.join(HIVE_DIR, 'ideas', 'agent_status.json');

      for (const sf of [projectStatusFile, globalStatusFile]) {
        try {
          const raw = JSON.parse(fs.readFileSync(sf, 'utf8'));
          if (raw.agents && Object.keys(raw.agents).length > 0) {
            agentData = raw.agents;
            break;
          }
        } catch {}
      }

      try {
        const { execSync } = require('child_process');
        const ps = execSync('ps aux', { encoding: 'utf8', timeout: 3000 });
        const projectAgents = ['improve', 'audit', 'radical', 'lawyer', 'compliance',
                               'designer-web', 'designer-portal', 'architect-api',
                               'emergencyfixer', 'reporter', 'deployer', 'gitguardian', 'regressiontest'];
        for (const agent of projectAgents) {
          const pattern = new RegExp('copilot-' + agent + '.*--project\\s+' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
          const patternDefault = new RegExp('copilot-' + agent + '\\.sh');
          if (pattern.test(ps) || (!id && patternDefault.test(ps))) {
            if (!agentData[agent]) agentData[agent] = {};
            agentData[agent].status = 'running';
            agentData[agent].detected_via = 'process';
          }
        }
      } catch {}

      const cfg = readProjectConfig(id);
      const enabledAgents = cfg ? (cfg.agents || []) : [];

      const result = {};
      for (const a of enabledAgents) {
        result[a] = agentData[a] || { status: 'idle' };
      }

      return json(res, 200, { agents: result, project_id: id });
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
        child.on('exit', (code) => { fs.closeSync(logFd); try { const c = readProjectConfig(id); if(c){c.setup_status=code===0?'complete':'error';writeProjectConfig(id,c);} } catch{} });
      }
      return json(res, 200, { status: 'setup_restarted' });
    }

    // POST /api/projects/:id/pause
    if (method === 'POST' && sub === '/pause') {
      const pauseFile = path.join(PROJECTS_DIR, id, '.agents-paused');
      fs.writeFileSync(pauseFile, new Date().toISOString(), 'utf8');
      return json(res, 200, { status: 'paused', project: id });
    }

    // POST /api/projects/:id/resume
    if (method === 'POST' && sub === '/resume') {
      const pauseFile = path.join(PROJECTS_DIR, id, '.agents-paused');
      try { fs.unlinkSync(pauseFile); } catch {}
      return json(res, 200, { status: 'resumed', project: id });
    }

    // GET /api/projects/:id/pause-status
    if (method === 'GET' && sub === '/pause-status') {
      const pauseFile = path.join(PROJECTS_DIR, id, '.agents-paused');
      const paused = fs.existsSync(pauseFile);
      return json(res, 200, { paused, project: id });
    }
  }

  // ── 404 ──────────────────────────────────────────────────────────
  json(res, 404, { error: 'Not found' });
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch(err => {
    console.error('Request error:', err);
    json(res, 500, { error: 'Internal server error' });
  });
});

server.listen(PORT, () => {
  console.log(`🐝 Copilot Hive Dashboard running at http://localhost:${PORT}`);
});
