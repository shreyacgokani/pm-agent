import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAgent } from '../context/AgentContext';

const NAV = [
  {
    section: 'Workspace',
    items: [
      { to: '/', label: 'Dashboard', icon: '▦', end: true },
      { to: '/pm-agent', label: 'PM Agent', icon: '◎' },
    ],
  },
  {
    section: 'Design',
    items: [
      { to: '/design-agent', label: 'Design Agent', icon: '◈' },
    ],
  },
  {
    section: 'Tickets',
    items: [
      { to: '/pm-agent', label: 'Generated Tickets', icon: '☰' },
    ],
  },
  {
    section: 'Configure',
    items: [
      { to: '/integrations', label: 'Integrations', icon: '⚙' },
      { to: '/prompts', label: 'Prompts', icon: '✎' },
      { to: '/skills', label: 'Skills', icon: '◆' },
    ],
  },
];

function statusLabel(status) {
  if (status === 'in-call') return 'On call';
  if (status === 'processing') return 'Processing';
  if (status === 'error') return 'Error';
  return 'Ready to call';
}

function statusClass(status) {
  if (status === 'in-call') return 'live';
  if (status === 'processing') return 'processing';
  if (status === 'error') return 'error';
  return 'ready';
}

function formatDuration(startedAt) {
  if (!startedAt) return null;
  const sec = Math.floor((Date.now() - startedAt) / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function Layout() {
  const [collapsed, setCollapsed] = useState(false);
  const { status, callActive, callStartedAt } = useAgent() || {};
  const [duration, setDuration] = useState(null);

  useEffect(() => {
    if (!callActive || !callStartedAt) {
      setDuration(null);
      return undefined;
    }
    const tick = () => setDuration(formatDuration(callStartedAt));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [callActive, callStartedAt]);

  return (
    <div className={`app-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <aside className="app-sidebar">
        <div className="sidebar-top">
          <div className="sidebar-brand-row">
            {!collapsed && <span className="sidebar-brand">PM Agent</span>}
            <button
              type="button"
              className="sidebar-collapse-btn"
              onClick={() => setCollapsed((c) => !c)}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? '›' : '‹'}
            </button>
          </div>

          <div className="sidebar-agent" title={collapsed ? 'Sarah — PM Agent' : undefined}>
            <div className="sidebar-agent-avatar">
              S
              <span className={`sidebar-status-dot ${statusClass(status)}`} />
            </div>
            {!collapsed && (
              <div className="sidebar-agent-meta">
                <strong>Sarah</strong>
                <span>{callActive && duration ? `Call ${duration}` : statusLabel(status)}</span>
              </div>
            )}
          </div>
        </div>

        <nav className="sidebar-nav">
          {NAV.map((group) => (
            <div key={group.section} className="sidebar-section">
              {!collapsed && <div className="sidebar-section-label">{group.section}</div>}
              {group.items.map((item) => (
                <NavLink
                  key={`${group.section}-${item.label}`}
                  to={item.to}
                  end={item.end}
                  title={collapsed ? item.label : undefined}
                  className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}
                >
                  <span className="sidebar-nav-icon">{item.icon}</span>
                  {!collapsed && <span className="sidebar-nav-label">{item.label}</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <button type="button" className="sidebar-icon-btn" title="Settings">⚙</button>
          <button type="button" className="sidebar-icon-btn" title="Help">?</button>
          <button type="button" className="sidebar-icon-btn" title="Feedback">✉</button>
        </div>
      </aside>

      <main className="app-content">
        <Outlet />
      </main>
    </div>
  );
}
