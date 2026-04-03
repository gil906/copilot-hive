#!/usr/bin/env node
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { spawn } = require('child_process');

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
</style>
</head>
<body>

<header class="header">
  <h1><span class="bee">🐝</span> Copilot Hive <span class="sub">— Project Manager</span></h1>
  <button class="btn btn-primary" onclick="showAddModal()">+ Add Project</button>
</header>

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

    <div class="detail-section">
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
      <button class="btn btn-sm btn-danger" onclick="deleteProject('\${esc(p.id)}')">Delete Project</button>
    </div>
  </div>\`;
  app.innerHTML = html;

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
          <label>Health Check URL</label>
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

// ── Init ───────────────────────────────────────────────────────────
render();
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
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  // ── GET / ── serve SPA ───────────────────────────────────────────
  if (method === 'GET' && pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(getHTML());
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

    // GET /api/projects/:id
    if (method === 'GET' && sub === '') {
      const cfg = readProjectConfig(id);
      if (!cfg) return json(res, 404, { error: 'Project not found' });
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
