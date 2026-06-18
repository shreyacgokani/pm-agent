import { useState, useMemo } from 'react';
import { buildNestedTree, defaultExpandedFolders } from '../utils/designFileTree.js';

function TreeNode({ node, depth, activeFile, expanded, onToggle, onSelect }) {
  if (node.type === 'file') {
    const isActive = activeFile === node.path;
    return (
      <button
        type="button"
        className={`design-tree-file ${isActive ? 'active' : ''}`}
        style={{ paddingLeft: `${12 + depth * 14}px` }}
        onClick={() => onSelect(node.path)}
        title={node.path}
      >
        <span className="design-tree-icon">📄</span>
        <span className="design-tree-label">{node.name}</span>
      </button>
    );
  }

  const isOpen = expanded.has(node.path);
  const hasChildren = node.children?.length > 0;
  if (!hasChildren && node.path) return null;

  return (
    <div className="design-tree-folder-group">
      {node.path && (
        <button
          type="button"
          className="design-tree-folder"
          style={{ paddingLeft: `${12 + depth * 14}px` }}
          onClick={() => onToggle(node.path)}
        >
          <span className="design-tree-caret">{isOpen ? '▾' : '▸'}</span>
          <span className="design-tree-icon">📁</span>
          <span className="design-tree-label">{node.name}</span>
        </button>
      )}
      {isOpen && node.children?.map((child) => (
        <TreeNode
          key={child.path || child.name}
          node={child}
          depth={node.path ? depth + 1 : depth}
          activeFile={activeFile}
          expanded={expanded}
          onToggle={onToggle}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

export default function DesignFileTree({ files, activeFile, onSelectFile }) {
  const paths = useMemo(() => Object.keys(files || {}), [files]);
  const tree = useMemo(() => buildNestedTree(paths), [paths]);
  const [expanded, setExpanded] = useState(() => defaultExpandedFolders(paths));

  const toggleFolder = (folderPath) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) next.delete(folderPath);
      else next.add(folderPath);
      return next;
    });
  };

  if (!paths.length) {
    return <div className="design-tree-empty">No files</div>;
  }

  return (
    <nav className="design-file-tree" aria-label="Project files">
      <TreeNode
        node={tree}
        depth={0}
        activeFile={activeFile}
        expanded={expanded}
        onToggle={toggleFolder}
        onSelect={onSelectFile}
      />
    </nav>
  );
}
