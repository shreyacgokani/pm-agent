const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does',
  'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'this', 'that',
  'these', 'those', 'i', 'you', 'we', 'they', 'it', 'my', 'your', 'our', 'their',
  'what', 'which', 'who', 'when', 'where', 'how', 'about', 'just', 'like', 'want',
  'need', 'also', 'some', 'any', 'all', 'from', 'into', 'then', 'than', 'so', 'if',
  'not', 'no', 'yes', 'okay', 'ok', 'yeah', 'sure', 'please', 'thanks', 'thank',
  'sarah', 'ticket', 'tickets', 'jira', 'story', 'stories', 'epic', 'create', 'make',
  'build', 'add', 'update', 'change', 'work', 'flow', 'feature', 'area',
]);

const IMPORT_RE = /(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g;
const EXPORT_RE = /export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+(\w+)|export\s*\{\s*([^}]+)\}/g;

export function classifyFile(path) {
  const lower = path.toLowerCase();
  if (/\/(pages?|views?|screens?)\//.test(lower) || /Page\.(tsx|jsx)$/.test(path)) return 'page';
  if (/\/routes?\//.test(lower) || /router\.(js|ts)$/.test(path)) return 'route';
  if (/\/(api|controllers?|handlers?)\//.test(lower)) return 'api';
  if (/\/(components?|ui)\//.test(lower)) return 'component';
  if (/\/(services?|lib|utils?|hooks?)\//.test(lower)) return 'service';
  if (/\/(models?|schemas?|types?)\//.test(lower)) return 'model';
  if (/design|figma|mock|spec|wireframe/i.test(lower)) return 'design';
  if (/\.(test|spec)\./.test(lower)) return 'test';
  if (/readme|\.md$/i.test(lower)) return 'doc';
  return 'other';
}

export function extractImports(content) {
  const imports = new Set();
  if (!content) return [];
  let match;
  while ((match = IMPORT_RE.exec(content)) !== null) {
    const p = match[1] || match[2];
    if (p && !p.startsWith('node:')) imports.add(p);
  }
  return [...imports];
}

export function extractExports(content) {
  const exports = new Set();
  if (!content) return [];
  let match;
  while ((match = EXPORT_RE.exec(content)) !== null) {
    if (match[1]) exports.add(match[1]);
    if (match[2]) {
      match[2].split(',').forEach((part) => {
        const name = part.trim().split(/\s+as\s+/)[0].trim();
        if (name) exports.add(name);
      });
    }
  }
  return [...exports];
}

function pathTokens(path) {
  return path
    .replace(/\.[^.]+$/, '')
    .split(/[/_.-]+/)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 2);
}

export function resolveLocalImport(importPath, fromPath, pathSet) {
  if (!importPath.startsWith('.')) return null;

  const dir = fromPath.split('/').slice(0, -1);
  for (const part of importPath.split('/')) {
    if (part === '.' || !part) continue;
    if (part === '..') dir.pop();
    else dir.push(part);
  }

  const base = dir.join('/');
  const candidates = [
    base,
    `${base}.tsx`, `${base}.ts`, `${base}.jsx`, `${base}.js`,
    `${base}/index.tsx`, `${base}/index.ts`, `${base}/index.jsx`, `${base}/index.js`,
  ];

  return candidates.find((c) => pathSet.has(c)) || null;
}

export function buildCatalogFromZipEntries(entries) {
  const pathSet = new Set(entries.map((e) => e.path));
  const catalog = [];
  const graph = new Map();

  for (const { path, snippet } of entries) {
    const imports = extractImports(snippet);
    const exports = extractExports(snippet);
    const resolved = imports
      .map((imp) => resolveLocalImport(imp, path, pathSet))
      .filter(Boolean);

    graph.set(path, new Set(resolved));

    catalog.push({
      path,
      kind: classifyFile(path),
      tokens: pathTokens(path),
      imports: resolved,
      exports,
      preview: snippet.slice(0, 400).replace(/\s+/g, ' ').trim(),
    });
  }

  return { catalog, graph, pathSet };
}

export function tokenizeConversation(messages) {
  const text = messages
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join(' ')
    .toLowerCase();

  const terms = new Set();
  for (const word of text.split(/[^a-z0-9]+/)) {
    if (word.length > 2 && !STOPWORDS.has(word)) terms.add(word);
  }

  for (const bigram of text.match(/[a-z]{3,}\s+[a-z]{3,}/g) || []) {
    terms.add(bigram.replace(/\s+/g, ' '));
    terms.add(bigram.replace(/\s+/g, ''));
  }

  return [...terms];
}

export function scoreCatalogEntry(entry, terms) {
  let score = 0;
  const pathLower = entry.path.toLowerCase();
  const previewLower = entry.preview.toLowerCase();

  for (const term of terms) {
    if (pathLower.includes(term)) score += 12;
    if (entry.tokens.some((t) => t.includes(term) || term.includes(t))) score += 6;
    if (entry.exports.some((e) => e.toLowerCase().includes(term))) score += 8;
    if (previewLower.includes(term)) score += 3;
  }

  const kindBoost = { page: 4, route: 4, api: 3, component: 2, design: 5, service: 2, model: 2, doc: 1 };
  score += kindBoost[entry.kind] || 0;

  if (/readme/i.test(entry.path)) score += 2;

  return score;
}

export function rankCatalog(catalog, terms, limit = 80) {
  return catalog
    .map((entry) => ({ ...entry, score: scoreCatalogEntry(entry, terms) }))
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function expandByImportGraph(seedPaths, graph, pathSet, maxHops = 2, maxFiles = 50) {
  const selected = new Set(seedPaths.filter((p) => pathSet.has(p)));
  let frontier = [...selected];

  for (let hop = 0; hop < maxHops && selected.size < maxFiles; hop++) {
    const next = [];
    for (const path of frontier) {
      const deps = graph.get(path);
      if (!deps) continue;
      for (const dep of deps) {
        if (!selected.has(dep) && selected.size < maxFiles) {
          selected.add(dep);
          next.push(dep);
        }
      }
    }
    frontier = next;
  }

  return [...selected];
}

export function buildIndexSummary(repoIndex) {
  const byKind = {};
  for (const entry of repoIndex.catalog) {
    if (!byKind[entry.kind]) byKind[entry.kind] = [];
    if (byKind[entry.kind].length < 12) byKind[entry.kind].push(entry.path);
  }

  const lines = [`Indexed ${repoIndex.totalFiles} files (structure only — full code loaded per feature scope).`];

  for (const [kind, paths] of Object.entries(byKind)) {
    if (paths.length) lines.push(`${kind}: ${paths.join(', ')}`);
  }

  return lines.join('\n');
}

export function formatCatalogForPicker(ranked) {
  return ranked
    .map((e) => `${e.path} [${e.kind}] exports:${e.exports.slice(0, 4).join(',') || '-'} score:${e.score}`)
    .join('\n');
}
