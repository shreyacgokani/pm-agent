const FENCE_RE = /^```(?:jsx|javascript|js|tsx|react|html)?\s*\n?([\s\S]*?)```\s*$/im;

export function stripCodeFences(source) {
  if (!source) return '';
  let code = source.trim();
  const match = code.match(FENCE_RE);
  if (match) code = match[1].trim();
  code = code.replace(/^```(?:jsx|javascript|js|tsx|react|html)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
  return code.trim();
}

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

export function cleanGeneratedReact(source) {
  return prepareReactCode(stripCodeFences(source));
}
