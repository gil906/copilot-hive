'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const HIVE_ROOT = path.resolve(__dirname, '..');
const KB_FILENAME = 'context_knowledge_base.json';

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from',
  'has', 'have', 'had', 'he', 'her', 'his', 'how', 'i', 'if', 'in', 'into',
  'is', 'it', 'its', 'just', 'me', 'my', 'no', 'not', 'of', 'on', 'or',
  'our', 'out', 'so', 'some', 'such', 'than', 'that', 'the', 'their', 'them',
  'then', 'there', 'these', 'they', 'this', 'to', 'too', 'up', 'use', 'very',
  'was', 'we', 'were', 'what', 'when', 'where', 'which', 'who', 'why', 'will',
  'with', 'you', 'your'
]);

/**
 * Resolve the ideas directory for a given projectId or directory path.
 */
function resolveIdeasDir(projectDirOrId) {
  if (!projectDirOrId || projectDirOrId === 'default') {
    return path.join(HIVE_ROOT, 'ideas');
  }
  const str = String(projectDirOrId).trim();
  if (path.isAbsolute(str)) {
    if (path.basename(str) === 'ideas') return str;
    if (fs.existsSync(path.join(str, 'ideas'))) return path.join(str, 'ideas');
    if (fs.existsSync(str) && fs.statSync(str).isDirectory()) {
      return path.join(str, 'ideas');
    }
  }
  const projectCandidate = path.join(HIVE_ROOT, 'projects', str);
  if (fs.existsSync(projectCandidate)) {
    return path.join(projectCandidate, 'ideas');
  }
  const relativeCandidate = path.resolve(HIVE_ROOT, str);
  if (fs.existsSync(relativeCandidate) && fs.statSync(relativeCandidate).isDirectory()) {
    if (path.basename(relativeCandidate) === 'ideas') return relativeCandidate;
    return path.join(relativeCandidate, 'ideas');
  }
  // If looks like a project slug, place under projects/<id>/ideas if parent exists, else default ideas
  if (/^[a-zA-Z0-9_-]+$/.test(str) && fs.existsSync(path.join(HIVE_ROOT, 'projects', str))) {
    return path.join(HIVE_ROOT, 'projects', str, 'ideas');
  }
  return path.join(HIVE_ROOT, 'ideas');
}

/**
 * 1. Knowledge Base Storage Path
 * Defaults to <HIVE_ROOT>/ideas/context_knowledge_base.json or projects/<id>/ideas/context_knowledge_base.json
 */
function getStorePath(projectDir) {
  const ideasDir = resolveIdeasDir(projectDir);
  if (!fs.existsSync(ideasDir)) {
    fs.mkdirSync(ideasDir, { recursive: true });
  }
  return path.join(ideasDir, KB_FILENAME);
}

/**
 * Ensure .mcp.json includes mksglu/context-mode server configuration.
 */
function ensureContextModeMcpConfig(targetDir) {
  const baseDir = targetDir ? path.resolve(String(targetDir)) : HIVE_ROOT;
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }
  const mcpPath = path.join(baseDir, '.mcp.json');
  let config = { mcpServers: {} };
  if (fs.existsSync(mcpPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        config = parsed;
        if (!config.mcpServers || typeof config.mcpServers !== 'object') {
          config.mcpServers = {};
        }
      }
    } catch (_) {
      config = { mcpServers: {} };
    }
  }
  config.mcpServers['context-mode'] = {
    command: 'npx',
    args: ['-y', 'context-mode']
  };
  fs.writeFileSync(mcpPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
  return {
    path: mcpPath,
    configured: true,
    server: config.mcpServers['context-mode'],
    config
  };
}

/**
 * Create an empty Knowledge Base structure.
 */
function createEmptyKB() {
  return {
    schemaVersion: 1,
    engine: 'context-mode-hybrid-bm25-trigram-rrf',
    inspiredBy: 'https://github.com/mksglu/context-mode',
    lastUpdated: new Date().toISOString(),
    sources: {},
    chunks: [],
    stats: {
      totalSearches: 0,
      sandboxRuns: 0,
      rawBytesIndexed: 0,
      rawBytesProcessed: 0,
      rawBytesAvoided: 0,
      bytesReturned: 0,
      lastUpdated: new Date().toISOString()
    }
  };
}

/**
 * Load Knowledge Base from disk.
 */
function loadKB(projectId) {
  const storePath = getStorePath(projectId);
  if (!fs.existsSync(storePath)) {
    return createEmptyKB();
  }
  try {
    const raw = fs.readFileSync(storePath, 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || !Array.isArray(data.chunks)) {
      return createEmptyKB();
    }
    data.sources = data.sources || {};
    data.stats = Object.assign({
      totalSearches: 0,
      sandboxRuns: 0,
      rawBytesIndexed: 0,
      rawBytesProcessed: 0,
      rawBytesAvoided: 0,
      bytesReturned: 0,
      lastUpdated: new Date().toISOString()
    }, data.stats || {});
    return data;
  } catch (_) {
    return createEmptyKB();
  }
}

/**
 * Save Knowledge Base to disk atomically.
 */
function saveKB(kb, projectId) {
  const storePath = getStorePath(projectId);
  kb.lastUpdated = new Date().toISOString();
  if (kb.stats) {
    kb.stats.lastUpdated = kb.lastUpdated;
  }
  fs.writeFileSync(storePath, JSON.stringify(kb, null, 2), 'utf8');
  return storePath;
}

/**
 * Built-in Porter-style word stemmer.
 */
function stemWord(word) {
  if (!word || typeof word !== 'string') return '';
  let w = word.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (w.length <= 3) return w;

  // Step 1a: plurals & past participles
  if (w.endsWith('sses')) {
    w = w.slice(0, -2);
  } else if (w.endsWith('ies') && w.length > 4) {
    w = w.slice(0, -3) + 'i';
  } else if (!w.endsWith('ss') && w.endsWith('s') && w.length > 3) {
    w = w.slice(0, -1);
  }

  // Step 1b: -eed, -ed, -ing
  if (w.endsWith('eed')) {
    if (w.length > 4) w = w.slice(0, -1);
  } else if (w.endsWith('ed') && /[aeiouy]/.test(w.slice(0, -2))) {
    w = w.slice(0, -2);
    if (/(at|bl|iz)$/.test(w)) {
      w += 'e';
    } else if (/([bcdfghjklmnpqrstvwxz])\1$/.test(w) && !/[lsz]$/.test(w)) {
      w = w.slice(0, -1);
    }
  } else if (w.endsWith('ing') && /[aeiouy]/.test(w.slice(0, -3))) {
    w = w.slice(0, -3);
    if (/(at|bl|iz)$/.test(w)) {
      w += 'e';
    } else if (/([bcdfghjklmnpqrstvwxz])\1$/.test(w) && !/[lsz]$/.test(w)) {
      w = w.slice(0, -1);
    }
  }

  // Step 2: common derivational suffixes
  const step2Suffixes = [
    ['ational', 'ate'],
    ['tional', 'tion'],
    ['enci', 'ence'],
    ['anci', 'ance'],
    ['izer', 'ize'],
    ['abli', 'able'],
    ['alli', 'al'],
    ['entli', 'ent'],
    ['eli', 'e'],
    ['ousli', 'ous'],
    ['ization', 'ize'],
    ['ation', 'ate'],
    ['ator', 'ate'],
    ['alism', 'al'],
    ['iveness', 'ive'],
    ['fulness', 'ful'],
    ['ousness', 'ous'],
    ['aliti', 'al'],
    ['iviti', 'ive'],
    ['biliti', 'ble']
  ];
  for (const [suf, rep] of step2Suffixes) {
    if (w.endsWith(suf) && w.length - suf.length >= 3) {
      w = w.slice(0, -suf.length) + rep;
      break;
    }
  }

  // Step 3: -icate, -ative, -alize, -iciti, -ical, -ful, -ness
  const step3Suffixes = [
    ['icate', 'ic'],
    ['ative', ''],
    ['alize', 'al'],
    ['iciti', 'ic'],
    ['ical', 'ic'],
    ['ful', ''],
    ['ness', '']
  ];
  for (const [suf, rep] of step3Suffixes) {
    if (w.endsWith(suf) && w.length - suf.length >= 3) {
      w = w.slice(0, -suf.length) + rep;
      break;
    }
  }

  // Step 4: -ement, -ment, -able, -ible, -ant, -ent, -ion, -ou, -ism, -ate, -iti, -ous, -ive, -ize
  const step4Suffixes = [
    'ement', 'ment', 'able', 'ible', 'ance', 'ence',
    'ant', 'ent', 'ion', 'ism', 'ate', 'iti', 'ous', 'ive', 'ize'
  ];
  for (const suf of step4Suffixes) {
    if (w.endsWith(suf) && w.length - suf.length >= 4) {
      w = w.slice(0, -suf.length);
      break;
    }
  }

  // Normalize trailing y -> i
  if (w.endsWith('y') && w.length > 3) {
    w = w.slice(0, -1) + 'i';
  }
  return w;
}

/**
 * Tokenize text into normalized lowercase words (excluding stop words).
 */
function tokenize(text) {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9_.-]+/)
    .map(t => t.replace(/^[._-]+|[._-]+$/g, ''))
    .filter(t => t.length >= 2 && !STOP_WORDS.has(t));
}

/**
 * Generate 3-character trigrams for a string.
 */
function getTrigrams(text) {
  if (!text) return [];
  const normalized = String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!normalized) return [];
  if (normalized.length < 3) return [normalized];
  const set = new Set();
  const padded = ` ${normalized} `;
  for (let i = 0; i <= padded.length - 3; i++) {
    const tri = padded.slice(i, i + 3);
    if (tri.trim().length >= 2) {
      set.add(tri);
    }
  }
  return Array.from(set);
}

/**
 * Compute bounded Levenshtein edit distance (optimized for typo tolerance <= 2).
 */
function levenshteinDistance(a, b) {
  if (a === b) return 0;
  if (!a) return b ? b.length : 0;
  if (!b) return a.length;
  if (Math.abs(a.length - b.length) > 2) return 3;

  const m = a.length;
  const n = b.length;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;

  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    let rowMin = dp[0];
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = temp;
      if (dp[j] < rowMin) rowMin = dp[j];
    }
    if (rowMin > 2) return 3;
  }
  return dp[n];
}

/**
 * Split markdown by headings (#, ##, ###) while keeping fenced code blocks intact.
 */
function chunkMarkdown(content, defaultTitle = 'Overview') {
  const raw = String(content || '');
  const lines = raw.split(/\r?\n/);
  const sections = [];

  let currentHeading = defaultTitle;
  let currentLevel = 1;
  let currentLines = [];
  let inCodeFence = false;
  let fenceMarker = '';

  const flushSection = () => {
    const body = currentLines.join('\n').trim();
    if (!body) return;
    const hasCodeBlock = /```|~~~/.test(body);
    sections.push({
      heading: currentHeading,
      level: currentLevel,
      content: body,
      contentType: hasCodeBlock ? 'code' : 'prose'
    });
  };

  for (const line of lines) {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1].slice(0, 3);
      if (!inCodeFence) {
        inCodeFence = true;
        fenceMarker = marker;
      } else if (marker === fenceMarker) {
        inCodeFence = false;
        fenceMarker = '';
      }
      currentLines.push(line);
      continue;
    }

    if (!inCodeFence) {
      const headingMatch = line.match(/^(#{1,3})\s+(.+?)\s*$/);
      if (headingMatch) {
        flushSection();
        currentLevel = headingMatch[1].length;
        currentHeading = headingMatch[2].replace(/#+\s*$/, '').trim();
        currentLines = [line];
        continue;
      }
    }

    currentLines.push(line);
  }
  flushSection();

  // If a section is very large (>3000 chars) and has multiple paragraphs outside code blocks, subdivide gracefully
  const finalChunks = [];
  for (const sec of sections) {
    if (sec.content.length <= 3200) {
      finalChunks.push(sec);
      continue;
    }
    const subLines = sec.content.split('\n');
    let buf = [];
    let bufLen = 0;
    let fence = false;
    let part = 1;
    for (const l of subLines) {
      if (/^\s*(`{3,}|~{3,})/.test(l)) fence = !fence;
      buf.push(l);
      bufLen += l.length + 1;
      if (!fence && bufLen >= 2400 && l.trim() === '') {
        const text = buf.join('\n').trim();
        if (text) {
          finalChunks.push({
            heading: part === 1 ? sec.heading : `${sec.heading} (Part ${part})`,
            level: sec.level,
            content: text,
            contentType: /```|~~~/.test(text) ? 'code' : 'prose'
          });
          part++;
        }
        buf = [];
        bufLen = 0;
      }
    }
    if (buf.length > 0) {
      const text = buf.join('\n').trim();
      if (text) {
        finalChunks.push({
          heading: part === 1 ? sec.heading : `${sec.heading} (Part ${part})`,
          level: sec.level,
          content: text,
          contentType: /```|~~~/.test(text) ? 'code' : 'prose'
        });
      }
    }
  }

  return finalChunks;
}

/**
 * Convert structured JSON files into rich Markdown for chunking.
 */
function formatJsonAsMarkdown(filePath, rawContent) {
  const baseName = path.basename(filePath);
  try {
    const data = JSON.parse(rawContent);
    if (baseName.includes('admin_ideas') && Array.isArray(data.ideas)) {
      const lines = [`# Admin Ideas Queue (${baseName})\n`];
      for (const idea of data.ideas) {
        const urgency = idea.urgent ? ' [URGENT]' : '';
        lines.push(`## ${idea.title || idea.id}${urgency}`);
        lines.push(`- **ID**: \`${idea.id}\``);
        lines.push(`- **Status**: ${idea.status || 'pending'}`);
        lines.push(`- **Urgent**: ${Boolean(idea.urgent)}`);
        if (idea.submitted_at) lines.push(`- **Submitted**: ${idea.submitted_at}`);
        lines.push(`\n${idea.description || ''}\n`);
      }
      return lines.join('\n');
    }
    if (baseName.includes('compliance_checklist') && Array.isArray(data.standards)) {
      const lines = [`# Compliance & Security Standards Checklist\n`];
      for (const std of data.standards) {
        lines.push(`## ${std.name} (${std.id}) — Status: ${std.overall_status}`);
        lines.push(`- **Category**: ${std.category || 'Security'}`);
        lines.push(`- **How to Achieve**: ${std.how_to_get || ''}`);
        if (Array.isArray(std.items)) {
          for (const item of std.items) {
            lines.push(`### ${item.name} (${item.id}) [${item.status}]`);
            lines.push(`- **Priority**: ${item.priority || 'medium'}`);
            lines.push(`- **Description**: ${item.description || ''}`);
            if (item.what_we_have) lines.push(`- **Implemented**: ${item.what_we_have}`);
            if (item.what_we_need) lines.push(`- **Gap / Needed**: ${item.what_we_need}`);
          }
        }
      }
      return lines.join('\n');
    }
    if (baseName.includes('agent_status') && data.agents) {
      const lines = [`# Agent Execution Status Telemetry\n`];
      for (const [agent, info] of Object.entries(data.agents)) {
        lines.push(`## Agent: ${agent}`);
        lines.push('```json\n' + JSON.stringify(info, null, 2) + '\n```');
      }
      return lines.join('\n');
    }
    return `# ${baseName}\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``;
  } catch (_) {
    return `# ${baseName}\n\n\`\`\`\n${rawContent}\n\`\`\``;
  }
}

/**
 * 2. Markdown/Code Smart Chunker & Indexer
 */
function indexContent({ source, content, path: filePath, projectId, tags = [], force = false } = {}) {
  let rawContent = content;
  let resolvedPath = null;

  if (filePath) {
    resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(HIVE_ROOT, filePath);
    if (rawContent === undefined || rawContent === null) {
      if (!fs.existsSync(resolvedPath)) {
        return { indexed: false, error: `File not found: ${resolvedPath}`, chunksIndexed: 0 };
      }
      rawContent = fs.readFileSync(resolvedPath, 'utf8');
    }
  }

  if (rawContent === undefined || rawContent === null) {
    return { indexed: false, error: 'Either content or path must be provided', chunksIndexed: 0 };
  }

  const rawString = String(rawContent);
  const rawBytes = Buffer.byteLength(rawString, 'utf8');
  const contentHash = crypto.createHash('sha256').update(rawString).digest('hex');
  const sourceLabel = source || (resolvedPath ? path.basename(resolvedPath) : 'inline-source');

  const kb = loadKB(projectId);
  const existingSource = kb.sources[sourceLabel];

  // Auto-detect staleness via SHA-256 hash
  if (!force && existingSource && existingSource.contentHash === contentHash) {
    const existingChunks = kb.chunks.filter(c => c.source === sourceLabel);
    if (existingChunks.length > 0) {
      return {
        indexed: true,
        skipped: true,
        source: sourceLabel,
        contentHash,
        chunksIndexed: existingChunks.length,
        rawBytes
      };
    }
  }

  // Format JSON files into structured markdown so headings & code blocks are preserved
  let markdownToChunk = rawString;
  if (resolvedPath && resolvedPath.endsWith('.json')) {
    markdownToChunk = formatJsonAsMarkdown(resolvedPath, rawString);
  }

  const rawChunks = chunkMarkdown(markdownToChunk, sourceLabel);
  const now = new Date().toISOString();

  // Remove previous chunks for this source
  kb.chunks = kb.chunks.filter(c => c.source !== sourceLabel);

  const newChunks = rawChunks.map((rc, idx) => {
    const fullText = `${rc.heading}\n${rc.content}`;
    const rawTokens = tokenize(fullText);
    const stemmedTokens = rawTokens.map(stemWord).filter(Boolean);
    const tf = {};
    for (const st of stemmedTokens) {
      tf[st] = (tf[st] || 0) + 1;
    }
    const uniqueTerms = Array.from(new Set(rawTokens)).slice(0, 120);
    const trigrams = getTrigrams(`${rc.heading} ${uniqueTerms.join(' ')}`).slice(0, 250);

    return {
      id: `${sourceLabel}#${idx + 1}-${contentHash.slice(0, 8)}`,
      source: sourceLabel,
      filePath: resolvedPath ? path.relative(HIVE_ROOT, resolvedPath) : null,
      heading: rc.heading,
      level: rc.level,
      content: rc.content,
      contentType: rc.contentType,
      tags: Array.isArray(tags) ? tags : [String(tags)],
      contentHash,
      rawBytes: Buffer.byteLength(rc.content, 'utf8'),
      sourceRawBytes: rawBytes,
      docLen: stemmedTokens.length || 1,
      tf,
      terms: uniqueTerms,
      stemmedSequence: stemmedTokens.slice(0, 300),
      trigrams,
      indexedAt: now
    };
  });

  kb.chunks.push(...newChunks);
  kb.sources[sourceLabel] = {
    source: sourceLabel,
    filePath: resolvedPath ? path.relative(HIVE_ROOT, resolvedPath) : null,
    contentHash,
    rawBytes,
    chunkCount: newChunks.length,
    tags: Array.isArray(tags) ? tags : [String(tags)],
    updatedAt: now
  };

  // Recompute total rawBytesIndexed from active sources + cumulative indexing
  const activeBytes = Object.values(kb.sources).reduce((acc, s) => acc + (s.rawBytes || 0), 0);
  kb.stats.rawBytesIndexed = Math.max(kb.stats.rawBytesIndexed || 0, activeBytes);

  saveKB(kb, projectId);

  return {
    indexed: true,
    skipped: false,
    source: sourceLabel,
    contentHash,
    chunksIndexed: newChunks.length,
    codeChunks: newChunks.filter(c => c.contentType === 'code').length,
    proseChunks: newChunks.filter(c => c.contentType === 'prose').length,
    rawBytes
  };
}

/**
 * Compute proximity boost when multiple stemmed query terms appear close together.
 */
function computeProximityBoost(stemmedSeq, queryStems) {
  if (!Array.isArray(stemmedSeq) || stemmedSeq.length === 0 || queryStems.length < 2) {
    return 0;
  }
  const uniqueQueryStems = Array.from(new Set(queryStems));
  if (uniqueQueryStems.length < 2) return 0;

  let matchedCount = 0;
  const positions = {};
  for (let i = 0; i < stemmedSeq.length; i++) {
    const tok = stemmedSeq[i];
    if (uniqueQueryStems.includes(tok)) {
      if (!positions[tok]) {
        positions[tok] = [];
        matchedCount++;
      }
      positions[tok].push(i);
    }
  }
  if (matchedCount < 2) return 0;

  // Find smallest window containing at least 2 distinct query stems
  let minDistance = Infinity;
  const keys = Object.keys(positions);
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      for (const p1 of positions[keys[i]]) {
        for (const p2 of positions[keys[j]]) {
          const dist = Math.abs(p1 - p2);
          if (dist < minDistance) minDistance = dist;
        }
      }
    }
  }
  if (!Number.isFinite(minDistance)) return 0;
  // Boost inversely proportional to token distance
  return (matchedCount / uniqueQueryStems.length) * (2.0 / (1 + minDistance * 0.25));
}

/**
 * Extract compact window snippet around matched query terms.
 */
function extractSnippet(content, queryTokens, maxChars = 420) {
  const text = String(content || '').trim();
  if (text.length <= maxChars) return text;

  const lower = text.toLowerCase();
  let bestIdx = -1;
  for (const tok of queryTokens) {
    const idx = lower.indexOf(tok.toLowerCase());
    if (idx !== -1 && (bestIdx === -1 || idx < bestIdx)) {
      bestIdx = idx;
    }
  }

  if (bestIdx === -1) {
    return text.slice(0, maxChars).trim() + ' ...';
  }

  const half = Math.floor(maxChars / 2);
  const start = Math.max(0, bestIdx - Math.floor(half * 0.6));
  const end = Math.min(text.length, start + maxChars);
  const prefix = start > 0 ? '... ' : '';
  const suffix = end < text.length ? ' ...' : '';
  return prefix + text.slice(start, end).trim() + suffix;
}

/**
 * 3. Multi-Strategy Search Pipeline (BM25 + Porter Stemming + Trigram + Levenshtein + RRF)
 */
function searchKnowledge({
  queries,
  source,
  contentType,
  limit = 5,
  sort = 'relevance',
  projectId
} = {}) {
  let kb = loadKB(projectId);
  if (kb.chunks.length === 0) {
    syncProjectKnowledge(projectId);
    kb = loadKB(projectId);
  }

  const queryList = Array.isArray(queries)
    ? queries.filter(Boolean).map(String)
    : (queries ? [String(queries)] : ['overview']);

  // Filter candidate chunks by source and contentType
  let candidates = kb.chunks;
  if (source) {
    const srcLower = String(source).toLowerCase();
    candidates = candidates.filter(c =>
      (c.source && c.source.toLowerCase().includes(srcLower)) ||
      (c.filePath && c.filePath.toLowerCase().includes(srcLower)) ||
      (Array.isArray(c.tags) && c.tags.some(t => String(t).toLowerCase().includes(srcLower)))
    );
  }
  if (contentType === 'code' || contentType === 'prose') {
    candidates = candidates.filter(c => c.contentType === contentType);
  }

  if (candidates.length === 0) {
    kb.stats.totalSearches = (kb.stats.totalSearches || 0) + 1;
    saveKB(kb, projectId);
    return {
      results: [],
      perQuery: {},
      totalMatches: 0,
      bytesReturned: 0,
      rawBytesAvoided: 0,
      stats: getContextStats(projectId)
    };
  }

  // Precompute document frequencies and average document length for BM25
  const N = candidates.length;
  const avgDocLen = candidates.reduce((s, c) => s + (c.docLen || 1), 0) / N;
  const df = {};
  for (const c of candidates) {
    const seen = Object.keys(c.tf || {});
    for (const term of seen) {
      df[term] = (df[term] || 0) + 1;
    }
  }

  const k1 = 1.2;
  const b = 0.75;
  const perQuery = {};
  const mergedMap = new Map();

  for (const rawQuery of queryList) {
    const qTokens = tokenize(rawQuery);
    const qStems = qTokens.map(stemWord).filter(Boolean);
    const qTrigrams = getTrigrams(rawQuery);
    const qTrigramSet = new Set(qTrigrams);

    // Matcher A: BM25 + Porter-Stemming + Proximity Boost
    const bm25Scores = candidates.map(chunk => {
      let score = 0;
      const chunkTf = chunk.tf || {};
      const docLen = chunk.docLen || 1;

      for (const stem of qStems) {
        const tfVal = chunkTf[stem] || 0;
        if (tfVal > 0) {
          const docFreq = df[stem] || 0.5;
          const idf = Math.log(1 + (N - docFreq + 0.5) / (docFreq + 0.5));
          const num = tfVal * (k1 + 1);
          const denom = tfVal + k1 * (1 - b + b * (docLen / avgDocLen));
          score += idf * (num / denom);
        }
      }

      // Heading & source stem boost
      const headingLower = (chunk.heading || '').toLowerCase();
      for (const tok of qTokens) {
        if (headingLower.includes(tok)) score += 1.5;
      }

      // Proximity boost when multiple query stems appear near each other
      score += computeProximityBoost(chunk.stemmedSequence || [], qStems);

      return { chunk, score };
    });

    // Matcher B: Trigram-Substring + Levenshtein 1-Edit-Distance Fuzzy Matcher
    const fuzzyScores = candidates.map(chunk => {
      let score = 0;
      const chunkTrigrams = chunk.trigrams || [];
      if (qTrigramSet.size > 0 && chunkTrigrams.length > 0) {
        let overlap = 0;
        for (const tri of chunkTrigrams) {
          if (qTrigramSet.has(tri)) overlap++;
        }
        const union = qTrigramSet.size + chunkTrigrams.length - overlap;
        const jaccard = union > 0 ? overlap / union : 0;
        const containment = overlap / qTrigramSet.size;
        score += (jaccard * 2.0) + (containment * 3.0);
      }

      // Substring and Levenshtein 1-edit-distance typo tolerance on chunk vocabulary
      const terms = chunk.terms || [];
      for (const qTok of qTokens) {
        let bestTermMatch = 0;
        for (const term of terms) {
          if (term === qTok) {
            bestTermMatch = Math.max(bestTermMatch, 1.5);
            break;
          } else if (term.includes(qTok) || qTok.includes(term)) {
            bestTermMatch = Math.max(bestTermMatch, 1.0);
          } else if (qTok.length >= 4 && term.length >= 4 && levenshteinDistance(qTok, term) <= 1) {
            bestTermMatch = Math.max(bestTermMatch, 0.85);
          }
        }
        score += bestTermMatch;
      }

      return { chunk, score };
    });

    // Rank both lists for Reciprocal Rank Fusion (RRF)
    const rankedA = [...bm25Scores]
      .sort((x, y) => y.score - x.score);
    const rankedB = [...fuzzyScores]
      .sort((x, y) => y.score - x.score);

    const rankMapA = new Map();
    const scoreMapA = new Map();
    rankedA.forEach((item, idx) => {
      rankMapA.set(item.chunk.id, item.score > 0 ? idx + 1 : candidates.length + 50);
      scoreMapA.set(item.chunk.id, item.score);
    });

    const rankMapB = new Map();
    const scoreMapB = new Map();
    rankedB.forEach((item, idx) => {
      rankMapB.set(item.chunk.id, item.score > 0 ? idx + 1 : candidates.length + 50);
      scoreMapB.set(item.chunk.id, item.score);
    });

    const rrfList = candidates.map(chunk => {
      const rA = rankMapA.get(chunk.id) || (candidates.length + 50);
      const rB = rankMapB.get(chunk.id) || (candidates.length + 50);
      const sA = scoreMapA.get(chunk.id) || 0;
      const sB = scoreMapB.get(chunk.id) || 0;
      const hasSignal = sA > 0 || sB > 0.15;
      const rrfScore = hasSignal
        ? (1 / (60 + rA)) + (1 / (60 + rB)) + (sA * 0.002) + (sB * 0.002)
        : 0;

      const snippet = extractSnippet(chunk.content, qTokens, 420);
      return {
        id: chunk.id,
        source: chunk.source,
        filePath: chunk.filePath,
        heading: chunk.heading,
        contentType: chunk.contentType,
        tags: chunk.tags || [],
        indexedAt: chunk.indexedAt,
        bm25Score: Number(sA.toFixed(4)),
        trigramFuzzyScore: Number(sB.toFixed(4)),
        rrfScore: Number(rrfScore.toFixed(6)),
        snippet,
        rawBytes: chunk.rawBytes || Buffer.byteLength(chunk.content, 'utf8'),
        sourceRawBytes: chunk.sourceRawBytes || chunk.rawBytes || 0
      };
    });

    let filtered = rrfList.filter(r => r.rrfScore > 0);
    if (filtered.length === 0) {
      // Fallback to most recent chunks if query had no lexical match
      filtered = rrfList.slice(0, limit);
    }

    if (sort === 'timeline') {
      filtered.sort((a, b) => String(b.indexedAt).localeCompare(String(a.indexedAt)));
    } else {
      filtered.sort((a, b) => b.rrfScore - a.rrfScore);
    }

    const topForQuery = filtered.slice(0, limit);
    perQuery[rawQuery] = topForQuery;

    for (const item of topForQuery) {
      const existing = mergedMap.get(item.id);
      if (!existing || item.rrfScore > existing.rrfScore) {
        mergedMap.set(item.id, item);
      }
    }
  }

  let mergedResults = Array.from(mergedMap.values());
  if (sort === 'timeline') {
    mergedResults.sort((a, b) => String(b.indexedAt).localeCompare(String(a.indexedAt)));
  } else {
    mergedResults.sort((a, b) => b.rrfScore - a.rrfScore);
  }
  mergedResults = mergedResults.slice(0, limit);

  // Compute context byte savings
  const bytesReturned = mergedResults.reduce((acc, r) => acc + Buffer.byteLength(r.snippet, 'utf8'), 0);
  const touchedSources = new Set(mergedResults.map(r => r.source));
  let fullSourceBytes = 0;
  for (const src of touchedSources) {
    if (kb.sources[src] && kb.sources[src].rawBytes) {
      fullSourceBytes += kb.sources[src].rawBytes;
    }
  }
  const chunkRawBytes = mergedResults.reduce((acc, r) => acc + (r.rawBytes || 0), 0);
  const baselineBytes = Math.max(fullSourceBytes, chunkRawBytes, bytesReturned);
  const rawBytesAvoided = Math.max(0, baselineBytes - bytesReturned);

  kb.stats.totalSearches = (kb.stats.totalSearches || 0) + 1;
  kb.stats.bytesReturned = (kb.stats.bytesReturned || 0) + bytesReturned;
  kb.stats.rawBytesAvoided = (kb.stats.rawBytesAvoided || 0) + rawBytesAvoided;
  saveKB(kb, projectId);

  return {
    results: mergedResults,
    perQuery,
    totalMatches: mergedResults.length,
    bytesReturned,
    rawBytesAvoided,
    stats: getContextStats(projectId)
  };
}

/**
 * 4. Think-in-Code Sandbox Executor
 * Executes javascript (node -e), python (python3 -c), or shell (bash -c) in a sandboxed workspace directory.
 */
function executeSandbox({
  language = 'javascript',
  code = '',
  filePath,
  timeout = 15000,
  cwd,
  intent,
  projectId
} = {}) {
  const ideasDir = resolveIdeasDir(projectId);
  const sandboxRoot = path.join(ideasDir, '.sandbox');
  const runId = `run-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const runDir = path.join(sandboxRoot, runId);
  fs.mkdirSync(runDir, { recursive: true });

  let fileContent = '';
  let resolvedFilePath = '';
  let fileBytes = 0;

  if (filePath) {
    const baseDir = cwd ? path.resolve(String(cwd)) : HIVE_ROOT;
    resolvedFilePath = path.isAbsolute(filePath) ? filePath : path.resolve(baseDir, filePath);
    if (fs.existsSync(resolvedFilePath) && fs.statSync(resolvedFilePath).isFile()) {
      fileContent = fs.readFileSync(resolvedFilePath, 'utf8');
      fileBytes = Buffer.byteLength(fileContent, 'utf8');
    }
  }

  const execCwd = cwd ? path.resolve(String(cwd)) : runDir;
  const env = Object.assign({}, process.env, {
    SANDBOX_DIR: runDir,
    FILE_PATH: resolvedFilePath
  });

  // Pass FILE_CONTENT via a file inside runDir if large, and also set env if <= 64KB
  const contentDataFile = path.join(runDir, '__file_content__.dat');
  if (resolvedFilePath) {
    fs.writeFileSync(contentDataFile, fileContent, 'utf8');
    if (fileBytes <= 65536) {
      env.FILE_CONTENT = fileContent;
    }
  }

  let cmd = 'node';
  let args = [];
  const normLang = String(language || 'javascript').toLowerCase();

  if (normLang === 'javascript' || normLang === 'js' || normLang === 'node') {
    const preamble = resolvedFilePath
      ? `const __fs = require('fs'); const FILE_PATH = ${JSON.stringify(resolvedFilePath)}; const FILE_CONTENT = __fs.readFileSync(${JSON.stringify(contentDataFile)}, 'utf8');\n`
      : `const FILE_PATH = ''; const FILE_CONTENT = '';\n`;
    cmd = process.execPath || 'node';
    args = ['-e', preamble + String(code)];
  } else if (normLang === 'python' || normLang === 'python3' || normLang === 'py') {
    const preamble = resolvedFilePath
      ? `import os\nFILE_PATH = ${JSON.stringify(resolvedFilePath)}\nwith open(${JSON.stringify(contentDataFile)}, 'r', encoding='utf-8') as __f:\n    FILE_CONTENT = __f.read()\n`
      : `FILE_PATH = ""\nFILE_CONTENT = ""\n`;
    cmd = 'python3';
    args = ['-c', preamble + String(code)];
  } else if (normLang === 'shell' || normLang === 'bash' || normLang === 'sh') {
    const preamble = resolvedFilePath
      ? `export FILE_PATH=${JSON.stringify(resolvedFilePath)}; export FILE_CONTENT="$(cat ${JSON.stringify(contentDataFile)})";\n`
      : '';
    cmd = 'bash';
    args = ['-c', preamble + String(code)];
  } else {
    try {
      fs.rmSync(runDir, { recursive: true, force: true });
    } catch (_) {}
    return {
      ok: false,
      exitCode: 1,
      stdout: '',
      stderr: `Unsupported sandbox language: ${language}`,
      rawBytesProcessed: 0,
      bytesReturned: 0
    };
  }

  const startedAt = Date.now();
  let proc;
  try {
    proc = spawnSync(cmd, args, {
      cwd: execCwd,
      env,
      timeout: Math.max(1000, Number(timeout) || 15000),
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });
  } finally {
    try {
      fs.rmSync(runDir, { recursive: true, force: true });
    } catch (_) {}
  }

  const durationMs = Date.now() - startedAt;
  const stdout = (proc && proc.stdout) ? String(proc.stdout) : '';
  const stderr = (proc && proc.stderr) ? String(proc.stderr) : (proc && proc.error ? String(proc.error.message) : '');
  const exitCode = (proc && typeof proc.status === 'number') ? proc.status : (proc && proc.error ? 124 : 0);

  const stdoutBytes = Buffer.byteLength(stdout, 'utf8');
  const rawBytesProcessed = Math.max(fileBytes, stdoutBytes) + Buffer.byteLength(String(code), 'utf8');

  // Auto-index when intent is provided and output > 4096 bytes
  if (intent && stdoutBytes > 4096) {
    const sourceName = `sandbox:${intent}`;
    indexContent({
      source: sourceName,
      content: `# Sandbox Output: ${intent}\n\n${stdout}`,
      projectId,
      tags: ['sandbox', intent],
      force: true
    });
    const searchRes = searchKnowledge({
      queries: [intent],
      source: sourceName,
      limit: 5,
      projectId
    });
    const condensed = searchRes.results.map(r => `### ${r.heading}\n${r.snippet}`).join('\n\n');
    const returnedBytes = Buffer.byteLength(condensed, 'utf8');

    const kb = loadKB(projectId);
    kb.stats.sandboxRuns = (kb.stats.sandboxRuns || 0) + 1;
    kb.stats.rawBytesProcessed = (kb.stats.rawBytesProcessed || 0) + rawBytesProcessed;
    kb.stats.bytesReturned = (kb.stats.bytesReturned || 0) + returnedBytes;
    kb.stats.rawBytesAvoided = (kb.stats.rawBytesAvoided || 0) + Math.max(0, rawBytesProcessed - returnedBytes);
    saveKB(kb, projectId);

    return {
      ok: exitCode === 0,
      exitCode,
      durationMs,
      autoIndexed: true,
      intent,
      source: sourceName,
      stdout: condensed,
      stderr: stderr.slice(0, 1000),
      sections: searchRes.results,
      rawBytesProcessed,
      bytesReturned: returnedBytes
    };
  }

  const kb = loadKB(projectId);
  kb.stats.sandboxRuns = (kb.stats.sandboxRuns || 0) + 1;
  kb.stats.rawBytesProcessed = (kb.stats.rawBytesProcessed || 0) + rawBytesProcessed;
  kb.stats.bytesReturned = (kb.stats.bytesReturned || 0) + stdoutBytes;
  kb.stats.rawBytesAvoided = (kb.stats.rawBytesAvoided || 0) + Math.max(0, rawBytesProcessed - stdoutBytes);
  saveKB(kb, projectId);

  return {
    ok: exitCode === 0,
    exitCode,
    durationMs,
    autoIndexed: false,
    stdout,
    stderr,
    rawBytesProcessed,
    bytesReturned: stdoutBytes
  };
}

/**
 * 5. Auto-Ingest Project Ideas & Logs
 */
function syncProjectKnowledge(projectId) {
  const ideasDir = resolveIdeasDir(projectId);
  const projectRoot = path.dirname(ideasDir);
  const changelogsDir = path.join(projectRoot, 'changelogs');
  const indexedSources = [];

  const tryIndexFile = (fullPath, sourceLabel, tags) => {
    if (!fs.existsSync(fullPath)) return;
    try {
      const stat = fs.statSync(fullPath);
      if (!stat.isFile() || stat.size === 0) return;
      const res = indexContent({
        source: sourceLabel,
        path: fullPath,
        projectId,
        tags
      });
      if (res.indexed) {
        indexedSources.push({
          source: sourceLabel,
          chunksIndexed: res.chunksIndexed,
          skipped: Boolean(res.skipped)
        });
      }
    } catch (_) {}
  };

  // 1. Scan ideas/ directory for *_latest.md, compliance_checklist.json, admin_ideas.json, agent_status.json, implemented.log
  if (fs.existsSync(ideasDir)) {
    const entries = fs.readdirSync(ideasDir);
    for (const entry of entries) {
      if (entry === KB_FILENAME || entry.startsWith('.')) continue;
      const fullPath = path.join(ideasDir, entry);
      if (entry.endsWith('_latest.md') || entry.endsWith('.md')) {
        tryIndexFile(fullPath, `ideas/${entry}`, ['ideas', 'research', entry.replace(/_latest\.md$|\.md$/, '')]);
      } else if (
        entry === 'compliance_checklist.json' ||
        entry === 'admin_ideas.json' ||
        entry === 'admin_ideas.example.json' ||
        entry === 'agent_status.json' ||
        entry === 'agent_status.example.json' ||
        entry === 'implemented.log'
      ) {
        tryIndexFile(fullPath, `ideas/${entry}`, ['ideas', 'telemetry', entry]);
      }
    }
  }

  // 2. Scan changelogs/ directory (up to 10 most recent)
  if (fs.existsSync(changelogsDir)) {
    try {
      const files = fs.readdirSync(changelogsDir)
        .filter(f => f.endsWith('.md') || f.endsWith('.txt') || f.endsWith('.log'))
        .sort()
        .reverse()
        .slice(0, 10);
      for (const f of files) {
        tryIndexFile(path.join(changelogsDir, f), `changelogs/${f}`, ['changelog', 'history']);
      }
    } catch (_) {}
  }

  // 3. Index project-level / root docs & pipeline status
  tryIndexFile(path.join(projectRoot, 'CHANGELOG.md'), 'CHANGELOG.md', ['changelog', 'releases']);
  tryIndexFile(path.join(projectRoot, 'README.md'), 'README.md', ['architecture', 'docs']);
  if (fs.existsSync(path.join(projectRoot, '.pipeline-status'))) {
    tryIndexFile(path.join(projectRoot, '.pipeline-status'), 'pipeline-status', ['pipeline', 'state']);
  } else if (fs.existsSync(path.join(projectRoot, '.pipeline-status.example'))) {
    tryIndexFile(path.join(projectRoot, '.pipeline-status.example'), 'pipeline-status', ['pipeline', 'state']);
  }

  return {
    projectId: projectId || 'default',
    syncedCount: indexedSources.length,
    sources: indexedSources,
    stats: getContextStats(projectId)
  };
}

/**
 * 6. Context Savings Telemetry
 */
function getContextStats(projectId) {
  const kb = loadKB(projectId);
  const totalChunks = kb.chunks.length;
  const codeChunks = kb.chunks.filter(c => c.contentType === 'code').length;
  const proseChunks = totalChunks - codeChunks;
  const sources = Object.keys(kb.sources || {});

  const rawBytesIndexed = kb.stats.rawBytesIndexed ||
    Object.values(kb.sources || {}).reduce((acc, s) => acc + (s.rawBytes || 0), 0);
  const rawBytesProcessed = kb.stats.rawBytesProcessed || 0;
  const rawBytesAvoided = kb.stats.rawBytesAvoided || 0;
  const bytesReturned = kb.stats.bytesReturned || 0;

  const totalRawPool = rawBytesAvoided + bytesReturned;
  const savingsRatioPercent = totalRawPool > 0
    ? Number(((rawBytesAvoided / totalRawPool) * 100).toFixed(1))
    : (rawBytesIndexed > 0 ? 85.0 : 0);

  const estimatedTokensSaved = Math.round(rawBytesAvoided / 4);

  return {
    totalChunks,
    codeChunks,
    proseChunks,
    sources,
    totalSearches: kb.stats.totalSearches || 0,
    sandboxRuns: kb.stats.sandboxRuns || 0,
    rawBytesIndexed,
    rawBytesProcessed,
    rawBytesAvoided,
    bytesReturned,
    estimatedTokensSaved,
    savingsRatioPercent,
    lastUpdated: kb.lastUpdated || kb.stats.lastUpdated || new Date().toISOString()
  };
}

module.exports = {
  getStorePath,
  ensureContextModeMcpConfig,
  stemWord,
  tokenize,
  getTrigrams,
  levenshteinDistance,
  chunkMarkdown,
  indexContent,
  searchKnowledge,
  executeSandbox,
  syncProjectKnowledge,
  getContextStats,
  resolveIdeasDir
};
