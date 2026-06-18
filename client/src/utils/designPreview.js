const FENCE_RE = /^```(?:jsx|javascript|js|tsx|react|html)?\s*\n?([\s\S]*?)```\s*$/im;

export function stripCodeFences(source) {
  if (!source) return '';
  let code = source.trim();
  const match = code.match(FENCE_RE);
  if (match) code = match[1].trim();
  code = code.replace(/^```(?:jsx|javascript|js|tsx|react|html)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
  return code.trim();
}

/** Remove imports/exports so code runs in a single Babel script block (no ES modules). */
export function prepareReactCode(raw) {
  let code = raw;

  code = code.replace(/import\s+(?:type\s+)?[\s\S]*?from\s*['"][^'"]+['"]\s*;?/g, '');
  code = code.replace(/import\s*['"][^'"]+['"]\s*;?/g, '');
  code = code.replace(/^\s*import\s+.+$/gm, '');
  code = code.replace(/import\s*\([^)]*\)/g, '');

  code = code.replace(/export\s+default\s+function\s+App/g, 'function App');
  code = code.replace(/export\s+default\s+const\s+App\s*=/g, 'const App =');
  code = code.replace(/export\s+default\s+/g, '');
  code = code.replace(/^export\s+(function|const|class)\s+/gm, '$1 ');
  code = code.replace(/^export\s+\{[\s\S]*?\}\s*;?$/gm, '');

  return code.replace(/\n{3,}/g, '\n\n').trim();
}

import { prepareFilesForPreview, previewSourceFiles, isPreviewableFile } from './designPreviewFiles.js';

function stripImportsExports(code) {
  let out = code || '';
  out = out.replace(/import\s+(?:type\s+)?[\s\S]*?from\s*['"][^'"]+['"]\s*;?/g, '');
  out = out.replace(/import\s*['"][^'"]+['"]\s*;?/g, '');
  out = out.replace(/^\s*import\s+.+$/gm, '');
  out = out.replace(/export\s+default\s+/g, '');
  out = out.replace(/^export\s+(function|const|class)\s+/gm, '$1 ');
  out = out.replace(/^export\s+\{[\s\S]*?\}\s*;?$/gm, '');
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

/** Bundle multi-file project into a single Babel iframe preview (fallback when Sandpack fails). */
export function buildMultiFilePreviewDocument(files) {
  if (!files || typeof files !== 'object') return '';

  const prepared = prepareFilesForPreview(files);
  const paths = Object.keys(prepared).filter(isPreviewableFile);
  const jsxPaths = paths.filter((p) => /\.(jsx|js)$/.test(p));
  if (!jsxPaths.length) return '';

  const appPath = jsxPaths.find((p) => p.endsWith('App.jsx')) || jsxPaths[0];
  const css = paths
    .filter((p) => p.endsWith('.css'))
    .map((p) => prepared[p])
    .join('\n');

  const ordered = [
    ...jsxPaths.filter((p) => p !== appPath),
    appPath,
  ];

  const bundled = ordered.map((p) => stripImportsExports(prepared[p])).join('\n\n');
  const html = buildPreviewDocument(bundled);
  if (!css || !html) return html;
  return html.replace('</style>', `${css}\n  </style>`);
}

function scriptSrc(file) {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/api/design/runtime/${file}`;
  }
  const cdn = {
    'react.js': 'https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js',
    'react-dom.js': 'https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.production.min.js',
    'babel.js': 'https://cdn.jsdelivr.net/npm/@babel/standalone@7.26.0/babel.min.js',
  };
  return cdn[file] || '';
}

export function buildPreviewDocument(reactSource) {
  const code = prepareReactCode(stripCodeFences(reactSource));
  if (!code) return '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #fff; }
    #root { min-height: 100vh; }
    #boot-error {
      display: none;
      padding: 20px 24px;
      margin: 16px;
      border-radius: 8px;
      background: #ffebe6;
      color: #bf2600;
      font: 13px/1.5 ui-monospace, monospace;
      white-space: pre-wrap;
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <div id="boot-error"></div>
  <script crossorigin src="${scriptSrc('react.js')}"></script>
  <script crossorigin src="${scriptSrc('react-dom.js')}"></script>
  <script src="${scriptSrc('babel.js')}"></script>
  <script>
    window.__showPreviewError = function(msg) {
      var el = document.getElementById('boot-error');
      el.style.display = 'block';
      el.textContent = msg;
    };
    window.onerror = function(msg, _url, _line, _col, err) {
      window.__showPreviewError('Preview error: ' + (err && err.message ? err.message : msg));
    };
  </script>
  <script type="text/babel" data-presets="react,env">
    const { useState, useEffect, useRef, useMemo, useCallback, useReducer, Fragment } = React;

    ${code}

    (function mountApp() {
      try {
        var Component = typeof App !== 'undefined'
          ? App
          : function Fallback() {
              return React.createElement('div', {
                style: { padding: 40, color: '#5e6c84', textAlign: 'center' }
              }, 'Waiting for App component…');
            };
        var rootEl = document.getElementById('root');
        var root = ReactDOM.createRoot(rootEl);
        root.render(React.createElement(Component));
      } catch (e) {
        window.__showPreviewError('Mount error: ' + (e && e.message ? e.message : String(e)));
      }
    })();
  </script>
</body>
</html>`;
}

export function applyPreviewToIframe(iframe, html) {
  if (!iframe || !html) return false;
  iframe.removeAttribute('src');
  iframe.srcdoc = html;
  return true;
}
