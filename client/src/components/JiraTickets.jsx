import { useState } from 'react';
import {
  formatAllTickets,
  formatDisplayValue,
  formatEpicCopy,
  formatStoryCopy,
  formatSubtaskCopy,
} from '../utils/jiraFormat';

function CopyButton({ text, label = 'Copy' }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button type="button" className="btn btn-copy" onClick={handleCopy}>
      {copied ? 'Copied!' : label}
    </button>
  );
}

function Field({ label, value, multiline }) {
  if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) return null;

  const display = formatDisplayValue(value);
  if (!display) return null;

  return (
    <div className="jira-field">
      <div className="jira-field-label">{label}</div>
      {Array.isArray(value) ? (
        <ul className="jira-list">
          {value.map((item, i) => (
            <li key={i}>{formatDisplayValue(item)}</li>
          ))}
        </ul>
      ) : multiline || typeof value === 'object' ? (
        <div className="jira-field-value multiline">{display}</div>
      ) : (
        <div className="jira-field-value">{display}</div>
      )}
    </div>
  );
}

function CriteriaList({ items }) {
  if (!items?.length) return null;
  return (
    <ul className="jira-checklist">
      {items.map((item, i) => (
        <li key={i}><span className="check">✓</span> {formatDisplayValue(item)}</li>
      ))}
    </ul>
  );
}

function DataTable({ rows, columns }) {
  if (!rows?.length) return null;
  return (
    <div className="jira-table-wrap">
      <table className="jira-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col}>{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((col) => (
                <td key={col}>{formatDisplayValue(row[colKey(col)]) || '—'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function colKey(label) {
  const map = {
    Field: 'field',
    'Field type': 'fieldType',
    Mandatory: 'mandatory',
    Source: 'source',
    Notes: 'notes',
    Group: 'group',
    Name: 'name',
    Type: 'type',
    Required: 'required',
    Behavior: 'behavior',
  };
  return map[label] || label.toLowerCase().replace(/\s+/g, '');
}

function GherkinBlock({ features }) {
  if (!features?.length) return null;
  return (
    <div className="jira-gherkin">
      {features.map((feat, i) => (
        <div key={i} className="gherkin-feature">
          {feat.feature && <div className="gherkin-title">Feature: {feat.feature}</div>}
          {feat.scenarios?.map((sc, j) => (
            <div key={j} className="gherkin-scenario">
              <div className="gherkin-scenario-name">Scenario: {sc.scenario}</div>
              <pre>{(sc.steps || []).join('\n')}</pre>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function SubtaskCard({ subtask }) {
  const discipline = (subtask.discipline || subtask.assignee || '').toUpperCase();
  const badgeClass = discipline === 'FE' ? 'fe' : discipline === 'BE' ? 'be' : 'qa';

  return (
    <div className={`jira-subtask jira-subtask-${badgeClass}`}>
      <div className="jira-subtask-header">
        <span className={`discipline-badge badge-${badgeClass}`}>{discipline}</span>
        <h5>{subtask.title}</h5>
        <CopyButton text={formatSubtaskCopy(subtask)} label="Copy" />
      </div>
      {subtask.description && <p className="jira-desc">{subtask.description}</p>}
      <Field label="Scope" value={subtask.scope} />
      {subtask.dataFields?.length > 0 && (
        <div className="jira-field">
          <div className="jira-field-label">Data Fields</div>
          <DataTable
            rows={subtask.dataFields}
            columns={['Field', 'Field type', 'Mandatory', 'Source', 'Notes']}
          />
        </div>
      )}
      {subtask.displayedValues?.length > 0 && (
        <div className="jira-field">
          <div className="jira-field-label">Displayed Values</div>
          <DataTable
            rows={subtask.displayedValues}
            columns={['Name', 'Type', 'Source', 'Required', 'Notes']}
          />
        </div>
      )}
      {subtask.behaviorRules?.length > 0 && (
        <div className="jira-field">
          <div className="jira-field-label">Behavior Rules</div>
          <DataTable
            rows={subtask.behaviorRules}
            columns={['Behavior', 'Required', 'Notes']}
          />
        </div>
      )}
      <GherkinBlock features={subtask.gherkinFeatures} />
      <Field label="Design Ref" value={subtask.designRef} />
      <Field label="API Contract" value={subtask.apiContract} multiline />
      <Field label="Dependencies" value={subtask.dependencies} />
      <Field label="Request / Response" value={subtask.requestResponseShape} multiline />
      {subtask.testCases?.length > 0 && (
        <div className="jira-field">
          <div className="jira-field-label">Test Cases</div>
          <CriteriaList items={subtask.testCases} />
        </div>
      )}
      {subtask.acceptanceCriteria?.length > 0 && (
        <div className="jira-field">
          <div className="jira-field-label">Acceptance Criteria</div>
          <CriteriaList items={subtask.acceptanceCriteria} />
        </div>
      )}
      <div className="jira-meta">
        {subtask.storyPoints && <span>Points: {subtask.storyPoints}</span>}
        {subtask.assignee && <span>Assignee: {subtask.assignee}</span>}
      </div>
    </div>
  );
}

function StoryCard({ story, index }) {
  return (
    <div className="jira-story">
      <div className="jira-story-header">
        <span className="jira-type-label">Story {index + 1}</span>
        <h4>{story.title}</h4>
        <CopyButton text={formatStoryCopy(story)} label="Copy Story" />
      </div>
      {story.description && <p className="jira-desc">{story.description}</p>}
      {story.acceptanceCriteria?.length > 0 && (
        <div className="jira-field">
          <div className="jira-field-label">Acceptance Criteria</div>
          <CriteriaList items={story.acceptanceCriteria} />
        </div>
      )}
      <div className="jira-meta">
        {story.storyPoints && <span>Points: {story.storyPoints}</span>}
        {story.linkedEpic && <span>Epic: {story.linkedEpic}</span>}
      </div>
      <div className="jira-subtasks">
        {story.subtasks?.map((sub, i) => (
          <SubtaskCard key={i} subtask={sub} />
        ))}
      </div>
    </div>
  );
}

function EpicCard({ epic, index }) {
  return (
    <div className="jira-epic">
      <div className="jira-epic-header">
        <span className="jira-type-label epic-label">Epic {index + 1}</span>
        <h3>{epic.title}</h3>
        <CopyButton text={formatEpicCopy(epic)} label="Copy Epic" />
      </div>
      {epic.description && <p className="jira-desc epic-desc">{epic.description}</p>}
      {epic.epicGoal && (
        <div className="jira-field">
          <div className="jira-field-label">Epic Goal</div>
          <div className="jira-field-value multiline">{epic.epicGoal}</div>
        </div>
      )}
      {epic.epicScope?.length > 0 && (
        <div className="jira-field">
          <div className="jira-field-label">Epic Scope</div>
          <ul className="jira-list">
            {epic.epicScope.map((item, i) => (
              <li key={i}>{formatDisplayValue(item)}</li>
            ))}
          </ul>
        </div>
      )}
      {epic.acceptanceCriteria?.length > 0 && (
        <div className="jira-field">
          <div className="jira-field-label">Epic Acceptance Criteria</div>
          <CriteriaList items={epic.acceptanceCriteria} />
        </div>
      )}
      <div className="jira-meta">
        {epic.labels && <span className="jira-tag">{formatDisplayValue(epic.labels)}</span>}
        {epic.fixVersion && <span>Fix: {epic.fixVersion}</span>}
      </div>
      <div className="jira-stories">
        {epic.stories?.map((story, i) => (
          <StoryCard key={i} story={story} index={i} />
        ))}
      </div>
    </div>
  );
}

export default function JiraTickets({ result }) {
  if (!result) return null;

  if (!result.epics?.length) {
    return (
      <div className="error">
        No Jira tickets were returned. Try describing the feature with more detail on your next call.
      </div>
    );
  }

  return (
    <div className="jira-tickets">
      <div className="work-items-header">
        <CopyButton text={formatAllTickets(result)} label="Copy All Tickets" />
      </div>

      {result.summary && (
        <div className="jira-summary">{result.summary}</div>
      )}

      {result.epics.map((epic, i) => (
        <EpicCard key={i} epic={epic} index={i} />
      ))}

      {result.assumptions?.length > 0 && (
        <div className="jira-assumptions">
          <div className="jira-field-label">Assumptions</div>
          <ul className="jira-list">
            {result.assumptions.map((a, i) => (
              <li key={i}>{formatDisplayValue(a)}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
