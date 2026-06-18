import { useEffect, useMemo, useRef, useState } from 'react';
import { buildJiraRows, formatTicketCopy, getVisibleRows } from '../utils/jiraRows';

function TypeIcon({ type }) {
  const cls = `jira-type-icon jira-type-${type}`;
  const label = type === 'epic' ? 'E' : type === 'story' ? 'S' : 'T';
  return <span className={cls} aria-hidden="true">{label}</span>;
}

function DisciplineBadge({ discipline }) {
  if (!discipline) return null;
  const cls = discipline === 'FE' ? 'fe' : discipline === 'BE' ? 'be' : 'qa';
  return <span className={`jira-discipline-badge badge-${cls}`}>{discipline}</span>;
}

function CopyButton({ text, label = 'Copy', className = '' }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy(e) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button type="button" className={`jira-row-copy ${className}`} onClick={handleCopy} title="Copy ticket">
      {copied ? '✓' : '⎘'}
    </button>
  );
}

function TicketDetailSidebar({ ticket, onClose }) {
  const [copied, setCopied] = useState(false);
  if (!ticket) return null;

  async function handleCopyTicket() {
    try {
      await navigator.clipboard.writeText(formatTicketCopy(ticket));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  const { data, type, key, summary } = ticket;

  return (
    <aside className={`jira-detail-panel jira-detail-${type}`}>
      <header className="jira-detail-header">
        <div className="jira-detail-title-row">
          <TypeIcon type={type} />
          <span className="jira-detail-key">{key}</span>
          <button type="button" className="jira-detail-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <button type="button" className="btn btn-primary jira-detail-copy-btn" onClick={handleCopyTicket}>
          {copied ? 'Copied' : 'Copy ticket'}
        </button>
      </header>

      <div className="jira-detail-body">
        <h3 className="jira-detail-summary">{summary}</h3>

        {type === 'epic' && data.description && (
          <p className="jira-detail-desc">{data.description}</p>
        )}
        {type === 'epic' && (
          <p className="jira-detail-meta">{ticket.storyCount} stories in this epic</p>
        )}

        {(type === 'story' || type === 'subtask') && data.description && (
          <p className="jira-detail-desc">{data.description}</p>
        )}

        {type === 'story' && data.acceptanceCriteria?.length > 0 && (
          <div className="jira-detail-section">
            <div className="jira-detail-section-label">Acceptance Criteria</div>
            <ul className="jira-detail-checklist">
              {data.acceptanceCriteria.map((item, i) => (
                <li key={i}><span className="check">✓</span> {item}</li>
              ))}
            </ul>
          </div>
        )}

        {type === 'subtask' && ticket.discipline && (
          <p className="jira-detail-meta">Discipline: {ticket.discipline}</p>
        )}
      </div>
    </aside>
  );
}

export default function JiraBacklog({ result, generating = false }) {
  const rows = useMemo(() => buildJiraRows(result), [result]);
  const [collapsedEpics, setCollapsedEpics] = useState(new Set());
  const [collapsedStories, setCollapsedStories] = useState(new Set());
  const seenStoriesRef = useRef(new Set());

  useEffect(() => {
    setCollapsedStories((prev) => {
      const next = new Set(prev);
      for (const row of rows) {
        if (row.type === 'story' && !seenStoriesRef.current.has(row.id)) {
          seenStoriesRef.current.add(row.id);
          next.add(row.id);
        }
      }
      return next;
    });
  }, [rows]);
  const [selectedId, setSelectedId] = useState(null);
  const [hoveredId, setHoveredId] = useState(null);

  const expanded = useMemo(() => ({
    epics: collapsedEpics,
    stories: collapsedStories,
  }), [collapsedEpics, collapsedStories]);

  const visibleRows = useMemo(() => getVisibleRows(rows, expanded), [rows, expanded]);
  const selectedTicket = rows.find((r) => r.id === selectedId) || null;

  function toggleEpic(id) {
    setCollapsedEpics((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleStory(id) {
    setCollapsedStories((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function expandAll() {
    setCollapsedEpics(new Set());
    setCollapsedStories(new Set());
  }

  function collapseAll() {
    setCollapsedEpics(new Set(rows.filter((r) => r.type === 'epic').map((r) => r.id)));
    setCollapsedStories(new Set(rows.filter((r) => r.type === 'story').map((r) => r.id)));
  }

  function handleRowClick(row, e) {
    if (e.target.closest('.jira-row-chevron') || e.target.closest('.jira-row-copy')) return;
    setSelectedId(row.id);
  }

  if (!rows.length && !generating) {
    return (
      <div className="jira-backlog-empty">
        No tickets yet. End your call and tap Generate tickets to build the backlog.
      </div>
    );
  }

  return (
    <div className={`jira-backlog-layout ${selectedTicket ? 'panel-open' : ''}`}>
      <div className="jira-backlog-main">
        <div className="jira-backlog-toolbar">
          <span className="jira-backlog-title">{generating ? 'Building backlog…' : 'Backlog'}</span>
          <div className="jira-backlog-toolbar-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={expandAll}>Expand all</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={collapseAll}>Collapse all</button>
          </div>
        </div>

        <div className="jira-backlog-table" role="table">
          {visibleRows.map((row) => {
            const hasChildren = row.type === 'epic'
              ? rows.some((r) => r.parentId === row.id)
              : row.type === 'story'
                ? rows.some((r) => r.parentId === row.id)
                : false;
            const isCollapsed = row.type === 'epic'
              ? collapsedEpics.has(row.id)
              : row.type === 'story'
                ? collapsedStories.has(row.id)
                : false;

            return (
              <div
                key={row.id}
                role="row"
                className={`jira-backlog-row jira-row-${row.type} ${selectedId === row.id ? 'selected' : ''}`}
                style={{ paddingLeft: `${8 + row.depth * 24}px` }}
                onMouseEnter={() => setHoveredId(row.id)}
                onMouseLeave={() => setHoveredId(null)}
                onClick={(e) => handleRowClick(row, e)}
              >
                <div className="jira-row-chevron-cell">
                  {hasChildren ? (
                    <button
                      type="button"
                      className={`jira-row-chevron ${isCollapsed ? '' : 'expanded'}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (row.type === 'epic') toggleEpic(row.id);
                        if (row.type === 'story') toggleStory(row.id);
                      }}
                      aria-label={isCollapsed ? 'Expand' : 'Collapse'}
                    >
                      ›
                    </button>
                  ) : (
                    <span className="jira-row-chevron-spacer" />
                  )}
                </div>

                <TypeIcon type={row.type} />
                <span className="jira-row-key">{row.key}</span>

                <span className={`jira-row-summary ${row.loading ? 'shimmer' : ''}`}>
                  {row.loading ? 'Generating…' : row.summary}
                </span>

                <div className="jira-row-badges">
                  {row.type === 'subtask' && <DisciplineBadge discipline={row.discipline} />}
                  {row.type === 'story' && row.storyPoints && (
                    <span className="jira-points-badge">{row.storyPoints} sp</span>
                  )}
                  {hoveredId === row.id && (
                    <CopyButton text={formatTicketCopy(row)} />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {selectedTicket && (
        <TicketDetailSidebar ticket={selectedTicket} onClose={() => setSelectedId(null)} />
      )}
    </div>
  );
}
