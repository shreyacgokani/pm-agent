/** Build nested tree structure from flat file paths. */

export function sortFilePaths(paths) {
  return [...paths].sort((a, b) => {
    const aParts = a.split('/');
    const bParts = b.split('/');
    for (let i = 0; i < Math.min(aParts.length, bParts.length); i++) {
      if (aParts[i] !== bParts[i]) {
        const aIsFile = i === aParts.length - 1;
        const bIsFile = i === bParts.length - 1;
        if (!aIsFile && bIsFile) return -1;
        if (aIsFile && !bIsFile) return 1;
        return aParts[i].localeCompare(bParts[i]);
      }
    }
    return aParts.length - bParts.length;
  });
}

export function buildNestedTree(paths) {
  const root = { name: '', path: '', type: 'folder', children: [] };
  const folderMap = new Map([['', root]]);

  for (const filePath of sortFilePaths(paths)) {
    const parts = filePath.split('/');
    let parentPath = '';

    for (let i = 0; i < parts.length - 1; i++) {
      const folderName = parts[i];
      const folderPath = parentPath ? `${parentPath}/${folderName}` : folderName;
      if (!folderMap.has(folderPath)) {
        const folder = { name: folderName, path: folderPath, type: 'folder', children: [] };
        folderMap.get(parentPath).children.push(folder);
        folderMap.set(folderPath, folder);
      }
      parentPath = folderPath;
    }

    const fileName = parts[parts.length - 1];
    folderMap.get(parentPath).children.push({
      name: fileName,
      path: filePath,
      type: 'file',
    });
  }

  return root;
}

export function fileLabel(path) {
  return path.split('/').pop() || path;
}

export function collectFolderPaths(tree, expanded = new Set()) {
  const paths = [];
  function walk(node) {
    if (node.type === 'folder' && node.path) paths.push(node.path);
    if (node.children) node.children.forEach(walk);
  }
  walk(tree);
  return paths;
}

export function defaultExpandedFolders(paths) {
  const expanded = new Set(['src', 'src/app', 'src/app/components', 'src/app/pages', 'src/styles']);
  for (const p of paths) {
    const parts = p.split('/');
    let acc = '';
    for (let i = 0; i < parts.length - 1; i++) {
      acc = acc ? `${acc}/${parts[i]}` : parts[i];
      expanded.add(acc);
    }
  }
  return expanded;
}
