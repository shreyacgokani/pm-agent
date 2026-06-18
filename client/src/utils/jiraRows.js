export function formatTicketCopy(ticket) {
  if (!ticket) return '';
  const lines = [`${ticket.key}: ${ticket.summary}`];
  const data = ticket.data;

  if (ticket.type === 'epic') {
    if (data.description) lines.push('', data.description);
    if (data.epicGoal) lines.push('', `Goal: ${data.epicGoal}`);
    if (data.acceptanceCriteria?.length) {
      lines.push('', 'Acceptance Criteria:');
      data.acceptanceCriteria.forEach((c) => lines.push(`- ${c}`));
    }
    return lines.join('\n');
  }

  if (ticket.type === 'story') {
    if (data.description) lines.push('', data.description);
    if (data.acceptanceCriteria?.length) {
      lines.push('', 'Acceptance Criteria:');
      data.acceptanceCriteria.forEach((c) => lines.push(`- [ ] ${c}`));
    }
    if (data.storyPoints) lines.push('', `Story Points: ${data.storyPoints}`);
    return lines.join('\n');
  }

  if (data.description) lines.push('', data.description);
  if (data.discipline || data.assignee) lines.push('', `Discipline: ${data.discipline || data.assignee}`);
  return lines.join('\n');
}

export function buildJiraRows(result, prefix = 'FUEL') {
  if (!result?.epics?.length) return [];

  const rows = [];
  let n = 1;

  for (const epic of result.epics) {
    const epicKey = `${prefix}-${n++}`;
    rows.push({
      id: epicKey,
      key: epicKey,
      type: 'epic',
      summary: epic.title,
      depth: 0,
      data: epic,
      storyCount: epic.stories?.length || 0,
      loading: epic._loading,
    });

    for (const story of epic.stories || []) {
      const storyKey = `${prefix}-${n++}`;
      rows.push({
        id: storyKey,
        key: storyKey,
        type: 'story',
        summary: story.title,
        depth: 1,
        parentId: epicKey,
        data: story,
        storyPoints: story.storyPoints,
        loading: story._loading,
      });

      for (const sub of story.subtasks || []) {
        const subKey = `${prefix}-${n++}`;
        rows.push({
          id: subKey,
          key: subKey,
          type: 'subtask',
          summary: sub.title,
          depth: 2,
          parentId: storyKey,
          discipline: (sub.discipline || sub.assignee || '').toUpperCase(),
          data: sub,
          loading: sub._loading,
        });
      }
    }
  }

  return rows;
}

export function getVisibleRows(rows, expanded) {
  const visible = [];
  const collapsedEpics = expanded.epics;
  const collapsedStories = expanded.stories;

  for (const row of rows) {
    if (row.type === 'epic') {
      visible.push(row);
      continue;
    }
    if (row.type === 'story') {
      const parentEpic = rows.find((r) => r.id === row.parentId);
      if (parentEpic && collapsedEpics.has(parentEpic.id)) continue;
      visible.push(row);
      continue;
    }
    if (row.type === 'subtask') {
      const parentStory = rows.find((r) => r.id === row.parentId);
      if (!parentStory) continue;
      const parentEpic = rows.find((r) => r.id === parentStory.parentId);
      if (parentEpic && collapsedEpics.has(parentEpic.id)) continue;
      if (collapsedStories.has(parentStory.id)) continue;
      visible.push(row);
    }
  }
  return visible;
}
