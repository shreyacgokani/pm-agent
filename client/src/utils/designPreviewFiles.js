/** Normalize generated project files so Sandpack and Babel preview can resolve imports. */

const PREVIEW_SKIP = new Set([
  'package.json',
  'vite.config.js',
  'index.html',
  'src/main.jsx',
]);

const IMPORT_RE = /import\s+(?:[\s\S]*?from\s*)?['"]([^'"]+)['"]\s*;?/g;

function dirname(filePath) {
  const parts = filePath.split('/');
  parts.pop();
  return parts;
}

function resolveRelativePath(fromPath, importPath) {
  if (!importPath.startsWith('.')) return null;
  const stack = dirname(fromPath);
  for (const part of importPath.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}

function stubForPath(path) {
  if (path.endsWith('.css')) {
    return '/* auto-generated — referenced import was missing */\n';
  }
  if (path.endsWith('.jsx') || path.endsWith('.js')) {
    const name = path.split('/').pop().replace(/\.(jsx|js)$/, '');
    return `export default function ${name}() { return null; }\n`;
  }
  return '';
}

function collectImports(files) {
  const refs = [];
  for (const [filePath, content] of Object.entries(files)) {
    if (!/\.(jsx|js)$/.test(filePath) || typeof content !== 'string') continue;
    let match;
    IMPORT_RE.lastIndex = 0;
    while ((match = IMPORT_RE.exec(content)) !== null) {
      const target = resolveRelativePath(filePath, match[1]);
      if (target) refs.push({ from: filePath, target });
    }
  }
  return refs;
}

function ensureDefaultStyles(files) {
  const out = { ...files };
  const tokens = out['src/styles/tokens.css'];
  if (!out['src/styles/global.css']) {
    out['src/styles/global.css'] = tokens
      ? `@import './tokens.css';\n`
      : '/* global styles */\n';
  }
  if (!out['src/styles/tokens.css']) {
    out['src/styles/tokens.css'] = `:root {
  --bg: #f8fafc;
  --surface: #fff;
  --text: #0f172a;
  --muted: #64748b;
  --accent: #6366f1;
}\n`;
  }
  if (!out['src/index.css']) {
    out['src/index.css'] = '*, *::before, *::after { box-sizing: border-box; }\nbody { margin: 0; }\n';
  }
  return out;
}

function inlineCssImports(files) {
  const out = { ...files };
  for (const path of Object.keys(out)) {
    if (!path.endsWith('.css') || typeof out[path] !== 'string') continue;
    out[path] = out[path].replace(
      /@import\s+['"]([^'"]+)['"]\s*;?/g,
      (_, rel) => {
        const imported = resolveRelativePath(path, rel.startsWith('.') ? rel : `./${rel}`);
        if (imported && out[imported]) {
          return `/* inlined from ${imported} */\n${out[imported]}\n`;
        }
        return '';
      }
    );
  }
  return out;
}

/** Add stub files for any missing local import; ensure common style paths exist. */
export function prepareFilesForPreview(files) {
  if (!files || typeof files !== 'object') return {};

  let out = ensureDefaultStyles({ ...files });

  for (let pass = 0; pass < 8; pass++) {
    let added = false;
    for (const { target } of collectImports(out)) {
      if (out[target] !== undefined) continue;
      out[target] = stubForPath(target);
      added = true;
    }
    if (!added) break;
  }

  return inlineCssImports(out);
}

export function previewSourceFiles(files) {
  const prepared = prepareFilesForPreview(files);
  const out = {};
  for (const [path, content] of Object.entries(prepared)) {
    if (PREVIEW_SKIP.has(path)) continue;
    if (/\.(jsx|js|css)$/.test(path) && (path.startsWith('src/') || path === 'src/app/App.jsx')) {
      out[path] = content;
    }
  }
  return out;
}

export function isPreviewableFile(path) {
  if (PREVIEW_SKIP.has(path)) return false;
  if (!/\.(jsx|js|css)$/.test(path)) return false;
  return path.startsWith('src/app/') || path.startsWith('src/styles/') || path === 'src/index.css';
}
