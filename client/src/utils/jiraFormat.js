export function formatDisplayValue(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map((item) => formatDisplayValue(item)).filter(Boolean).join(', ');
  }
  if (typeof value === 'object') {
    if ('request' in value || 'response' in value) {
      const parts = [];
      if (value.request != null) {
        const req = formatDisplayValue(value.request);
        if (req) parts.push(`Request:\n${req}`);
      }
      if (value.response != null) {
        const res = formatDisplayValue(value.response);
        if (res) parts.push(`Response:\n${res}`);
      }
      return parts.join('\n\n') || JSON.stringify(value, null, 2);
    }
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

function formatSubtaskCopy(sub) {
  const lines = [
    `#### SUB-TASK: [${sub.discipline || sub.assignee}] ${sub.title}`,
    `**Title:** ${sub.title}`,
    `**Description:** ${sub.description || ''}`,
  ];
  if (sub.scope?.length) {
    lines.push('**Scope:**');
    sub.scope.forEach((s) => lines.push(`- ${formatDisplayValue(s)}`));
  }
  if (sub.designRef) lines.push(`**Design Ref:** ${formatDisplayValue(sub.designRef)}`);
  if (sub.apiContract) lines.push(`**API Contract:** ${formatDisplayValue(sub.apiContract)}`);
  if (sub.dependencies) lines.push(`**Dependencies:** ${formatDisplayValue(sub.dependencies)}`);
  if (sub.requestResponseShape) {
    lines.push(`**Request/Response Shape:**\n${formatDisplayValue(sub.requestResponseShape)}`);
  }
  if (sub.testCases?.length) {
    lines.push('**Test Cases:**');
    sub.testCases.forEach((t) => lines.push(`- [ ] ${formatDisplayValue(t)}`));
  }
  if (sub.acceptanceCriteria?.length) {
    lines.push('**Acceptance Criteria:**');
    sub.acceptanceCriteria.forEach((c) => lines.push(`- [ ] ${formatDisplayValue(c)}`));
  }
  lines.push(`**Story Points:** ${sub.storyPoints || ''}`);
  lines.push(`**Assignee:** ${sub.assignee || sub.discipline || ''}`);
  return lines.join('\n');
}

function formatStoryCopy(story) {
  const lines = [
    `### STORY`,
    `**Title:** ${story.title}`,
    `**Description:**`,
    story.description || '',
    '**Acceptance Criteria:**',
    ...(story.acceptanceCriteria || []).map((c) => `- [ ] ${formatDisplayValue(c)}`),
    `**Story Points:** ${story.storyPoints || ''}`,
    `**Linked Epic:** ${story.linkedEpic || ''}`,
    '',
  ];
  story.subtasks?.forEach((sub) => {
    lines.push(formatSubtaskCopy(sub), '');
  });
  return lines.join('\n').trim();
}

function formatEpicCopy(epic) {
  const lines = [
    '### EPIC',
    `**Title:** ${epic.title}`,
    `**Description:** ${epic.description || ''}`,
    '**Acceptance Criteria:**',
    ...(epic.acceptanceCriteria || []).map((c) => `- ${formatDisplayValue(c)}`),
    `**Labels:** ${epic.labels || ''}`,
    `**Fix Version:** ${epic.fixVersion || ''}`,
    '',
  ];
  epic.stories?.forEach((story, i) => {
    lines.push(formatStoryCopy(story));
    if (i < epic.stories.length - 1) lines.push('---', '');
  });
  return lines.join('\n').trim();
}

export function formatAllTickets(result) {
  const lines = [];
  if (result.summary) lines.push(result.summary, '');
  result.epics?.forEach((epic, i) => {
    lines.push(formatEpicCopy(epic));
    if (i < result.epics.length - 1) lines.push('', '---', '');
  });
  if (result.assumptions?.length) {
    lines.push('', 'Assumptions:');
    result.assumptions.forEach((a) => lines.push(`- ${formatDisplayValue(a)}`));
  }
  return lines.join('\n').trim();
}

export { formatEpicCopy, formatStoryCopy, formatSubtaskCopy };
