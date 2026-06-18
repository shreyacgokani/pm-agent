import { useCallback, useEffect, useRef, useState } from 'react';
import { applyPreviewToIframe, buildPreviewDocument, prepareReactCode, stripCodeFences } from '../utils/designPreview.js';
import { parseIntoFileTree, fileLabel, sortFilePaths } from '../utils/designParser.js';

const STORAGE_KEY = 'design-agent-projects';
const SIDEBAR_WIDTH_KEY = 'design-chat-sidebar-width';
const SIDEBAR_MIN = 260;
const SIDEBAR_MAX = 560;
const SIDEBAR_DEFAULT = 360;

const THINKING_STEPS = [
  { key: 'understand', text: 'Understanding your request…' },
  { key: 'plan', text: 'Planning layout and component structure…' },
  { key: 'components', text: 'Writing React components…' },
  { key: 'styles', text: 'Applying styles and visual design…' },
  { key: 'polish', text: 'Polishing interactions and responsive layout…' },
  { key: 'save', text: 'Saving to your project repo on GitHub…' },
];

function relativeTime(ts) {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

function loadLocalProjects() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((p) => ({
      ...p,
      messages: p.messages || [],
      versions: p.versions || [],
      activeVersion: p.activeVersion || p.iterations || 1,
      fileTree: p.fileTree || null,
    }));
  } catch {
    return [];
  }
}

function persistLocalProjects(projects) {
  const toSave = projects.filter((p) => p.code || p.status === 'done' || p.status === 'generating');
  localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
}

function buildThinkingSteps(activePhase) {
  const order = THINKING_STEPS.map((s) => s.key);
  const activeIdx = order.indexOf(activePhase);
  return THINKING_STEPS.map((step, i) => ({
    ...step,
    status: i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'pending',
  }));
}

async function streamDesign(params, handlers) {
  const { prompt, previousCode, projectId, projectName, isNew, createdAt, signal } = params;
  const { onDelta, onStatus, onComplete, onSaved, onVersionInfo, onGithubError, onDone, onError } = handlers;

  try {
    const res = await fetch('/api/design/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        previousCode: previousCode || '',
        projectId,
        projectName,
        isNew,
        createdAt,
      }),
      signal,
    });

    if (!res.ok) throw new Error(`Server error: ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') {
          onDone();
          return;
        }
        try {
          const parsed = JSON.parse(payload);
          if (parsed.type === 'error' || parsed.error) {
            throw new Error(parsed.message || 'Generation failed');
          }
          if (parsed.type === 'status') onStatus(parsed.phase, parsed.text);
          if (parsed.type === 'delta' && parsed.delta) onDelta(parsed.delta);
          if (parsed.type === 'complete') onComplete(parsed);
          if (parsed.type === 'saved') onSaved(parsed);
          if (parsed.type === 'version_info') onVersionInfo?.(parsed);
          if (parsed.type === 'github_error') onGithubError(parsed.message);
        } catch (err) {
          if (err.message && !err.message.includes('JSON')) throw err;
        }
      }
    }
    onDone();
  } catch (err) {
    if (err.name === 'AbortError') return;
    onError(err);
  }
}

function statusDotClass(status) {
  if (status === 'generating') return 'generating';
  if (status === 'done') return 'done';
  if (status === 'error') return 'error';
  return 'idle';
}

function ThinkingBubble({ steps }) {
  return (
    <div className="design-chat-bubble design-chat-assistant design-chat-thinking">
      <div className="design-thinking-title">Working on it</div>
      <ul className="design-thinking-steps">
        {steps.map((step) => (
          <li key={step.key} className={`design-thinking-step design-thinking-${step.status}`}>
            <span className="design-thinking-icon">
              {step.status === 'done' ? '✓' : step.status === 'active' ? '●' : '○'}
            </span>
            <span>{step.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProjectTile({ project, onClick }) {
  const previewHtml = project.previewHtml || (project.code ? buildPreviewDocument(project.code) : '');

  return (
    <button type="button" className="design-tile" onClick={() => onClick(project)}>
      <div className="design-tile-preview">
        {previewHtml ? (
          <iframe
            title={`Preview ${project.name}`}
            sandbox="allow-scripts"
            srcDoc={previewHtml}
            tabIndex={-1}
          />
        ) : (
          <div className="design-tile-placeholder">
            <span>◈</span>
          </div>
        )}
        {project.status === 'generating' && (
          <div className="design-tile-generating">
            <div className="design-generating-spinner" />
          </div>
        )}
      </div>
      <div className="design-tile-info">
        <div className="design-tile-name">{project.name}</div>
        <div className="design-tile-meta">
          <span className={`design-status-dot ${statusDotClass(project.status)}`} />
          <span>{relativeTime(project.createdAt)}</span>
        </div>
      </div>
    </button>
  );
}

export default function DesignAgent() {
  const [view, setView] = useState('landing');
  const [projects, setProjects] = useState(loadLocalProjects);
  const [activeProject, setActiveProject] = useState(null);
  const [promptValue, setPromptValue] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [copied, setCopied] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [githubConnected, setGithubConnected] = useState(false);
  const [thinkingSteps, setThinkingSteps] = useState(null);
  const [previewHtml, setPreviewHtml] = useState('');
  const [fileTree, setFileTree] = useState(null);
  const [activeFile, setActiveFile] = useState('src/App.jsx');
  const [showVersionMenu, setShowVersionMenu] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const saved = parseInt(localStorage.getItem(SIDEBAR_WIDTH_KEY), 10);
      if (saved >= SIDEBAR_MIN && saved <= SIDEBAR_MAX) return saved;
    } catch { /* ignore */ }
    return SIDEBAR_DEFAULT;
  });
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [, setTick] = useState(0);

  const streamBufferRef = useRef('');
  const rafRef = useRef(null);
  const iframeRef = useRef(null);
  const chatEndRef = useRef(null);
  const abortRef = useRef(null);
  const versionMenuRef = useRef(null);
  const workspaceRef = useRef(null);
  const isResizingRef = useRef(false);
  const sidebarWidthRef = useRef(SIDEBAR_DEFAULT);

  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth;
  }, [sidebarWidth]);

  useEffect(() => {
    persistLocalProjects(projects);
  }, [projects]);

  useEffect(() => {
    const onMove = (e) => {
      if (!isResizingRef.current || !workspaceRef.current) return;
      const left = workspaceRef.current.getBoundingClientRect().left;
      const next = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, e.clientX - left));
      sidebarWidthRef.current = next;
      setSidebarWidth(next);
    };

    const onUp = () => {
      if (!isResizingRef.current) return;
      isResizingRef.current = false;
      setIsResizingSidebar(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidthRef.current));
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const startSidebarResize = useCallback((e) => {
    e.preventDefault();
    isResizingRef.current = true;
    setIsResizingSidebar(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    fetch('/api/design/projects')
      .then((r) => r.json())
      .then((data) => {
        setGithubConnected(data.githubConnected);
        if (data.projects?.length) {
          setProjects((prev) => {
            const merged = new Map(prev.map((p) => [p.id, p]));
            for (const gp of data.projects) {
              if (!merged.has(gp.id)) {
                merged.set(gp.id, {
                  ...gp,
                  code: '',
                  previewHtml: '',
                  messages: [],
                  versions: [],
                  activeVersion: gp.latestVersion || 1,
                  iterations: gp.latestVersion || 0,
                });
              }
            }
            return [...merged.values()].sort((a, b) => b.updatedAt - a.updatedAt);
          });
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => () => {
    if (abortRef.current) abortRef.current.abort();
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  useEffect(() => {
    if (view === 'workspace') {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [view, activeProject?.messages, thinkingSteps, isGenerating]);

  useEffect(() => {
    const handler = (e) => {
      if (versionMenuRef.current && !versionMenuRef.current.contains(e.target)) {
        setShowVersionMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const applyPreview = useCallback((reactCode) => {
    const html = buildPreviewDocument(reactCode);
    setPreviewHtml(html || '');
  }, []);

  const syncFileTreeFromCode = useCallback((reactCode) => {
    const tree = parseIntoFileTree(reactCode);
    const paths = sortFilePaths(Object.keys(tree));
    setFileTree(tree);
    setActiveFile(paths[0] || 'src/App.jsx');
    return tree;
  }, []);

  useEffect(() => {
    if (!previewHtml || !iframeRef.current) return;
    applyPreviewToIframe(iframeRef.current, previewHtml);
  }, [previewHtml, view]);

  const updateProject = useCallback((projectId, updater) => {
    setProjects((prev) => prev.map((p) => (p.id === projectId ? updater(p) : p)));
    setActiveProject((prev) => (prev?.id === projectId ? updater(prev) : prev));
  }, []);

  const openWorkspace = useCallback(async (project) => {
    setPromptValue('');
    setErrorMessage('');
    setView('workspace');
    setThinkingSteps(null);

    if (githubConnected && project.id && !project.code) {
      try {
        const res = await fetch(`/api/design/projects/${project.id}`);
        if (res.ok) {
          const full = await res.json();
          const code = full.code || '';
          const html = buildPreviewDocument(code);
          const loaded = {
            ...project,
            ...full,
            code,
            previewHtml: html,
            activeVersion: full.activeVersion || full.iterations,
          };
          setActiveProject(loaded);
          setProjects((prev) => prev.map((p) => (p.id === loaded.id ? loaded : p)));
          applyPreview(code);
          syncFileTreeFromCode(code);
          return;
        }
      } catch {
        // fall through
      }
    }

    setActiveProject(project);
    if (project.code) {
      applyPreview(project.code);
      syncFileTreeFromCode(project.code);
      if (project.fileTree) {
        setFileTree(project.fileTree);
        setActiveFile(sortFilePaths(Object.keys(project.fileTree))[0] || 'src/App.jsx');
      }
    } else {
      setPreviewHtml('');
      setFileTree(null);
    }
  }, [githubConnected, applyPreview, syncFileTreeFromCode]);

  const goHome = useCallback(() => {
    setView('landing');
    setActiveProject(null);
    setPromptValue('');
    setErrorMessage('');
    setShowCode(false);
    setThinkingSteps(null);
    setPreviewHtml('');
    setFileTree(null);
    setActiveFile('src/App.jsx');
  }, []);

  const restoreVersion = useCallback(async (version) => {
    if (!activeProject || isGenerating) return;
    setShowVersionMenu(false);

    const localVersion = activeProject.versions?.find((v) => v.v === version);
    if (localVersion?.code) {
      const updated = {
        ...activeProject,
        code: localVersion.code,
        activeVersion: version,
      };
      setActiveProject(updated);
      setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      applyPreview(localVersion.code);
      syncFileTreeFromCode(localVersion.code);
      return;
    }

    if (!githubConnected) {
      setErrorMessage('Connect GitHub to load older versions.');
      return;
    }

    try {
      const res = await fetch(`/api/design/projects/${activeProject.id}/versions/${version}`);
      if (!res.ok) throw new Error('Failed to load version');
      const { code } = await res.json();
      const updated = {
        ...activeProject,
        code,
        activeVersion: version,
      };
      setActiveProject(updated);
      setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      applyPreview(code);
      syncFileTreeFromCode(code);
    } catch (err) {
      setErrorMessage(err.message);
    }
  }, [activeProject, isGenerating, applyPreview, githubConnected, syncFileTreeFromCode]);

  const resizeTextarea = useCallback((el) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, []);

  const runGenerate = useCallback(async (text, baseProject = null) => {
    const trimmed = text.trim();
    if (!trimmed || isGenerating) return;

    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    const source = baseProject || activeProject;
    const isNew = !source;
    const projectId = isNew ? crypto.randomUUID() : source.id;

    const userMsg = {
      id: crypto.randomUUID(),
      role: 'user',
      text: trimmed,
      at: Date.now(),
    };

    const newProject = {
      id: projectId,
      name: isNew ? trimmed.slice(0, 60) : source.name,
      prompt: isNew ? trimmed : source.prompt,
      code: isNew ? '' : source.code,
      previewHtml: isNew ? '' : source.previewHtml,
      status: 'generating',
      createdAt: isNew ? Date.now() : source.createdAt,
      iterations: isNew ? 0 : source.iterations,
      versions: isNew ? [] : (source.versions || []),
      activeVersion: source?.activeVersion,
      messages: isNew
        ? [userMsg]
        : [...(source.messages || []), userMsg],
    };

    setProjects((prev) =>
      isNew ? [newProject, ...prev] : prev.map((p) => (p.id === projectId ? newProject : p))
    );
    setActiveProject(newProject);
    setPromptValue('');
    setIsGenerating(true);
    setErrorMessage('');
    setView('workspace');
    setThinkingSteps(buildThinkingSteps('understand'));
    streamBufferRef.current = isNew ? '' : (source.code || '');

    try {
      await streamDesign(
        {
          prompt: trimmed,
          previousCode: isNew ? '' : source.code,
          projectId,
          projectName: newProject.name,
          isNew,
          createdAt: newProject.createdAt,
          signal: abortRef.current.signal,
        },
        {
          onStatus: (phase) => {
            setThinkingSteps(buildThinkingSteps(phase));
          },
          onDelta: (delta) => {
            streamBufferRef.current += delta;
            const buf = streamBufferRef.current;
            if (buf.length > 300 && buf.length % 600 < delta.length) {
              if (rafRef.current) cancelAnimationFrame(rafRef.current);
              rafRef.current = requestAnimationFrame(() => {
                const partial = buildPreviewDocument(buf);
                if (partial && iframeRef.current) {
                  applyPreviewToIframe(iframeRef.current, partial);
                }
              });
            }
          },
          onComplete: (data) => {
            const reactCode = prepareReactCode(stripCodeFences(data.code || streamBufferRef.current));
            streamBufferRef.current = reactCode;

            if (!reactCode) {
              setErrorMessage('No code was generated. Try again.');
              setThinkingSteps(null);
              setIsGenerating(false);
              return;
            }

            const version = newProject.iterations + 1;
            applyPreview(reactCode);
            const tree = syncFileTreeFromCode(reactCode);
            setThinkingSteps(null);

            const doneMsg = {
              id: crypto.randomUUID(),
              role: 'assistant',
              text: 'Design ready — preview loaded.',
              at: Date.now(),
              status: 'done',
            };

            updateProject(projectId, (p) => ({
              ...p,
              code: reactCode,
              fileTree: tree,
              previewHtml: buildPreviewDocument(reactCode),
              status: 'done',
              iterations: version,
              activeVersion: version,
              versions: [
                ...(p.versions || []).filter((v) => v.v !== version),
                {
                  v: version,
                  label: version === 1 ? 'Initial' : `Version ${version}`,
                  createdAt: Date.now(),
                  code: reactCode,
                },
              ],
              messages: [...p.messages, doneMsg],
            }));

            if (githubConnected && projectId) {
              fetch(`/api/design/projects/${projectId}/files`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ files: tree, version }),
              }).catch(() => {});
            }
          },
          onSaved: (data) => {
            updateProject(projectId, (p) => ({
              ...p,
              repoUrl: data.repoUrl,
              githubRepo: data.githubRepo,
              storage: data.storage,
              iterations: data.version,
              activeVersion: data.version,
              messages: [
                ...p.messages,
                {
                  id: crypto.randomUUID(),
                  role: 'assistant',
                  text: `Saved to GitHub as v${data.version} → ${data.githubRepo}`,
                  at: Date.now(),
                  status: 'done',
                },
              ],
              versions: [
                ...(p.versions || []).filter((v) => v.v !== data.version),
                {
                  v: data.version,
                  label: data.version === 1 ? 'Initial' : `Version ${data.version}`,
                  createdAt: Date.now(),
                  code: p.code,
                },
              ],
            }));
          },
          onVersionInfo: (data) => {
            updateProject(projectId, (p) => ({
              ...p,
              repoUrl: data.repoUrl,
              githubRepo: data.githubRepo,
              iterations: data.version,
              activeVersion: data.version,
            }));
          },
          onGithubError: (message) => {
            updateProject(projectId, (p) => ({
              ...p,
              messages: [
                ...p.messages,
                {
                  id: crypto.randomUUID(),
                  role: 'assistant',
                  text: message,
                  at: Date.now(),
                  status: 'done',
                },
              ],
            }));
          },
          onDone: () => setIsGenerating(false),
          onError: (err) => {
            console.error('Design generation failed:', err);
            const msg = err.message || 'Generation failed';
            setErrorMessage(msg);
            setThinkingSteps(null);
            updateProject(projectId, (p) => ({
              ...p,
              status: 'error',
              messages: [
                ...p.messages,
                {
                  id: crypto.randomUUID(),
                  role: 'assistant',
                  text: `Something went wrong: ${msg}`,
                  at: Date.now(),
                  status: 'error',
                },
              ],
            }));
            setIsGenerating(false);
          },
        }
      );
    } catch (err) {
      if (err.name !== 'AbortError') {
        setErrorMessage(err.message || 'Generation failed');
        setIsGenerating(false);
        setThinkingSteps(null);
      }
    }
  }, [activeProject, isGenerating, updateProject, applyPreview, syncFileTreeFromCode, githubConnected]);

  const handleLandingSubmit = useCallback(() => {
    runGenerate(promptValue);
  }, [promptValue, runGenerate]);

  const handleChatSubmit = useCallback(() => {
    if (!activeProject) return;
    runGenerate(promptValue, activeProject);
  }, [promptValue, activeProject, runGenerate]);

  const handleRemix = useCallback(() => {
    if (!activeProject || isGenerating) return;
    const remixPrompt = `Make it look completely different — same content, entirely new visual direction: ${activeProject.prompt}`;
    runGenerate(remixPrompt, activeProject);
  }, [activeProject, isGenerating, runGenerate]);

  const handleCopy = useCallback(async () => {
    const content = fileTree
      ? (fileTree[activeFile] || fileTree['src/App.jsx'] || '')
      : activeProject?.code;
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [fileTree, activeFile, activeProject?.code]);

  const handleFullscreen = useCallback(() => {
    if (!previewHtml) return;
    const win = window.open('', '_blank', 'width=1400,height=900');
    if (!win) return;
    win.document.open();
    win.document.write(previewHtml);
    win.document.close();
  }, [previewHtml]);

  const handleKeyDown = (e, onSubmit) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  };

  const versions = activeProject?.versions?.length
    ? activeProject.versions
    : activeProject?.iterations
      ? Array.from({ length: activeProject.iterations }, (_, i) => ({
          v: i + 1,
          label: i === 0 ? 'Initial' : `Version ${i + 1}`,
        }))
      : [];

  if (view === 'landing') {
    return (
      <div className="design-agent-shell design-landing">
        <div className="design-landing-scroll">
          <div className="design-landing-hero">
            <div className="design-landing-icon">◈</div>
            <h1 className="design-landing-title">Design Agent</h1>
            <p className="design-landing-subtitle">
              Describe any screen, component, or page — AI builds it in React.
            </p>

            {!githubConnected && (
              <p className="design-landing-github-hint">
                Connect GitHub in Integrations — each project gets its own private repo with version history.
              </p>
            )}

            <div className="design-landing-chatbox">
              <textarea
                className="design-landing-input"
                rows={1}
                value={promptValue}
                onChange={(e) => {
                  setPromptValue(e.target.value);
                  resizeTextarea(e.target);
                }}
                onInput={(e) => resizeTextarea(e.target)}
                onKeyDown={(e) => handleKeyDown(e, handleLandingSubmit)}
                placeholder="Describe a landing page, dashboard, mobile app screen…"
                disabled={isGenerating}
              />
              <button
                type="button"
                className="design-landing-send"
                onClick={handleLandingSubmit}
                disabled={!promptValue.trim() || isGenerating}
                title="Generate"
              >
                →
              </button>
            </div>
          </div>

          {projects.length > 0 && (
            <section className="design-tiles-section">
              <h2 className="design-tiles-heading">Your projects</h2>
              <div className="design-tiles-grid">
                {projects.map((project) => (
                  <ProjectTile
                    key={project.id}
                    project={project}
                    onClick={openWorkspace}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={workspaceRef}
      className={`design-agent-shell design-workspace ${isResizingSidebar ? 'is-resizing' : ''}`}
    >
      <aside className="design-chat-sidebar" style={{ width: sidebarWidth }}>
        <div className="design-chat-header">
          <button type="button" className="design-back-btn" onClick={goHome} title="Back to home">
            ←
          </button>
          <div className="design-chat-project">
            <strong>{activeProject?.name || 'Project'}</strong>
            <span>
              {activeProject?.githubRepo ? (
                <a
                  href={activeProject.repoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="design-repo-link"
                >
                  {activeProject.githubRepo}
                </a>
              ) : (
                relativeTime(activeProject?.createdAt)
              )}
            </span>
          </div>
        </div>

        <div className="design-chat-messages">
          {(activeProject?.messages || []).map((msg) => (
            <div key={msg.id} className={`design-chat-bubble design-chat-${msg.role}`}>
              {msg.role === 'assistant' && msg.status === 'generating' && (
                <span className="design-chat-spinner" />
              )}
              <p>{msg.text}</p>
            </div>
          ))}

          {thinkingSteps && <ThinkingBubble steps={thinkingSteps} />}

          <div ref={chatEndRef} />
        </div>

        <div className="design-chat-composer">
          <div className="design-chat-input-row">
            <textarea
              className="design-chat-input"
              rows={1}
              value={promptValue}
              onChange={(e) => {
                setPromptValue(e.target.value);
                resizeTextarea(e.target);
              }}
              onInput={(e) => resizeTextarea(e.target)}
              onKeyDown={(e) => handleKeyDown(e, handleChatSubmit)}
              placeholder="Ask for changes…"
              disabled={isGenerating}
            />
            <button
              type="button"
              className="design-btn-remix design-chat-remix"
              title="Remix"
              onClick={handleRemix}
              disabled={!activeProject?.code || isGenerating}
            >
              ⇄
            </button>
            <button
              type="button"
              className="design-chat-send"
              onClick={handleChatSubmit}
              disabled={!promptValue.trim() || isGenerating}
            >
              →
            </button>
          </div>
        </div>
      </aside>

      <div
        className="design-sidebar-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize chat panel"
        onMouseDown={startSidebarResize}
      />

      <div className="design-main">
        <div className="design-topbar">
          <div className="design-topbar-left">
            <span className="design-breadcrumb">Preview</span>
            {versions.length > 0 && (
              <div className="design-version-picker" ref={versionMenuRef}>
                <button
                  type="button"
                  className="design-version-btn"
                  onClick={() => setShowVersionMenu((s) => !s)}
                >
                  v{activeProject?.activeVersion || versions.length}
                  <span className="design-version-caret">▾</span>
                </button>
                {showVersionMenu && (
                  <div className="design-version-menu">
                    {[...versions].reverse().map((v) => (
                      <button
                        key={v.v}
                        type="button"
                        className={`design-version-item ${v.v === activeProject?.activeVersion ? 'active' : ''}`}
                        onClick={() => restoreVersion(v.v)}
                      >
                        <span>{v.label || `v${v.v}`}</span>
                        {v.v === activeProject?.activeVersion && <span className="design-version-current">Current</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="design-topbar-actions">
            <button
              type="button"
              className="design-fullscreen-btn"
              onClick={handleFullscreen}
              title="Open fullscreen preview"
              disabled={!previewHtml}
            >
              ⤢
            </button>
            <button
              type="button"
              className={`design-code-toggle ${showCode ? 'active' : ''}`}
              onClick={() => setShowCode((s) => !s)}
            >
              Code
            </button>
          </div>
        </div>

        <div className="design-preview-wrap">
          {!previewHtml && !isGenerating && (
            <div className="design-empty-state">
              <span className="design-empty-icon">◈</span>
              <div className="design-empty-heading">Waiting for design</div>
              <div className="design-empty-sub">Preview appears when coding finishes</div>
            </div>
          )}

          <iframe
            ref={iframeRef}
            className={`design-preview-iframe ${previewHtml ? 'visible' : ''}`}
            title="Design preview"
            sandbox="allow-scripts allow-forms"
          />

          {isGenerating && !previewHtml && (
            <div className="design-generating-overlay">
              <div className="design-generating-spinner" />
              <div className="design-generating-label">Building your React design…</div>
            </div>
          )}

          {activeProject?.status === 'error' && errorMessage && !isGenerating && (
            <div className="design-error-overlay">
              <div className="design-error-label">{errorMessage}</div>
            </div>
          )}
        </div>
      </div>

      <aside className={`design-code-panel ${showCode ? 'open' : ''}`}>
        <div className="design-code-header">
          <span className="design-code-title">Code</span>
          <button
            type="button"
            className="design-code-copy"
            onClick={handleCopy}
            title="Copy active file"
          >
            {copied ? '✓' : '⎘'}
          </button>
        </div>

        {fileTree && Object.keys(fileTree).length > 1 && (
          <div className="design-file-tabs">
            {sortFilePaths(Object.keys(fileTree)).map((path) => (
              <button
                key={path}
                type="button"
                className={`design-file-tab ${activeFile === path ? 'active' : ''}`}
                onClick={() => setActiveFile(path)}
                title={path}
              >
                {fileLabel(path)}
              </button>
            ))}
          </div>
        )}

        <div className="design-code-body">
          <pre><code>
            {fileTree
              ? (fileTree[activeFile] || fileTree['src/App.jsx'] || '')
              : (activeProject?.code || '')}
          </code></pre>
        </div>
      </aside>
    </div>
  );
}
