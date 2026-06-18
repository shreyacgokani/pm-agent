const PAGE_SUFFIXES = ['Page', 'View', 'Screen', 'Panel', 'Tab'];
const NAV_NAMES = ['Sidebar', 'Nav', 'Navbar', 'Topbar', 'Header', 'Footer', 'Layout'];

function isPageComponent(name) {
  return PAGE_SUFFIXES.some((s) => name.endsWith(s));
}

function isNavComponent(name) {
  return NAV_NAMES.some((n) => name === n || name.startsWith(n));
}

function findComponentBounds(lines, startLine) {
  let braceDepth = 0;
  let started = false;

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];
    for (const char of line) {
      if (char === '{') {
        braceDepth++;
        started = true;
      }
      if (char === '}') {
        braceDepth--;
        if (started && braceDepth === 0) return i;
      }
    }
  }
  return lines.length - 1;
}

function extractComponents(code) {
  const lines = code.split('\n');
  const components = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const funcMatch = line.match(/^function\s+([A-Z][A-Za-z0-9]*)\s*\(/);
    if (funcMatch) {
      const endLine = findComponentBounds(lines, i);
      components.push({
        name: funcMatch[1],
        startLine: i,
        endLine,
        lines: endLine - i + 1,
        code: lines.slice(i, endLine + 1).join('\n'),
      });
      continue;
    }

    const arrowMatch = line.match(/^const\s+([A-Z][A-Za-z0-9]*)\s*=/);
    if (arrowMatch) {
      const endLine = findComponentBounds(lines, i);
      components.push({
        name: arrowMatch[1],
        startLine: i,
        endLine,
        lines: endLine - i + 1,
        code: lines.slice(i, endLine + 1).join('\n'),
      });
    }
  }

  return components;
}

export function parseIntoFileTree(singleFileCode) {
  const styleMatch = singleFileCode.match(/<style[^>]*>([\s\S]*?)<\/style>/);
  const styleBlock = styleMatch ? styleMatch[0] : '';

  const components = extractComponents(singleFileCode);

  if (components.length < 4) {
    return { 'src/App.jsx': singleFileCode };
  }

  const files = {};
  const appComp = components.find((c) => c.name === 'App');
  const pageComps = components.filter((c) => isPageComponent(c.name));
  const navComps = components.filter((c) => isNavComponent(c.name));
  const uiComps = components.filter(
    (c) => c.name !== 'App' && !isPageComponent(c.name) && !isNavComponent(c.name)
  );

  for (const comp of uiComps) {
    files[`src/components/${comp.name}.jsx`] = comp.code;
  }

  for (const comp of navComps) {
    files[`src/components/${comp.name}.jsx`] = comp.code;
  }

  for (const comp of pageComps) {
    files[`src/pages/${comp.name}.jsx`] = comp.code;
  }

  if (appComp) {
    files['src/App.jsx'] = [styleBlock ? '// Design tokens and global styles\n' : '', appComp.code].join('\n');
  }

  if (Object.keys(files).length <= 1) {
    return { 'src/App.jsx': singleFileCode };
  }

  return files;
}

export function fileLabel(filePath) {
  return filePath.split('/').pop();
}

export function sortFilePaths(paths) {
  const order = (p) => {
    if (p === 'src/App.jsx') return 0;
    if (p.includes('/pages/')) return 1;
    if (p.includes('/components/')) return 2;
    return 3;
  };
  return [...paths].sort((a, b) => order(a) - order(b) || a.localeCompare(b));
}
