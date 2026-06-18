import OpenAI from 'openai';
import { formatRepoForAI } from './github.js';
import { safeParseJson } from './jsonUtil.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const STORY_DETAIL_SCHEMA = `{
  "title": "As a [role], I want [action] so that [outcome]",
  "description": "Context, user journey, edge cases — multi-line string",
  "acceptanceCriteria": ["detailed testable criteria — 5-12 per story"],
  "storyPoints": "1|2|3|5|8",
  "linkedEpic": "epic title",
  "subtasks": [
    {
      "discipline": "FE|BE|QA",
      "title": "[FE] Component — action",
      "description": "detailed task description",
      "scope": ["bullet scope items"],
      "designRef": "Figma or file path",
      "apiContract": "METHOD /path or N/A",
      "dependencies": "Blocked by / Blocks or N/A",
      "requestResponseShape": "json or N/A",
      "dataFields": [{ "field": "", "fieldType": "", "mandatory": "", "source": "", "notes": "" }],
      "displayedValues": [{ "name": "", "type": "", "source": "", "required": "", "notes": "" }],
      "gherkinFeatures": [{ "feature": "", "scenarios": [{ "scenario": "", "steps": ["Given ...", "When ...", "Then ..."] }] }],
      "behaviorRules": [{ "behavior": "", "required": "", "notes": "" }],
      "testCases": ["for QA only"],
      "acceptanceCriteria": ["3+ per subtask"],
      "storyPoints": "1-3",
      "assignee": "FE|BE|QA"
    }
  ]
}`;

export function extractPromptFilePaths(prompt) {
  const paths = new Set();
  const patterns = [
    /`((?:src\/|docs\/|\.cursor\/)[^`]+\.(?:tsx?|jsx?|md|css|json))`/gi,
    /\|\s*`([^`]+\.(?:tsx?|jsx?|md))`\s*\|/gi,
  ];
  for (const re of patterns) {
    let match;
    while ((match = re.exec(prompt)) !== null) {
      paths.add(match[1].replace(/^\//, ''));
    }
  }
  return [...paths];
}

export function extractVoicePrompt(fullPrompt) {
  const outputIdx = fullPrompt.indexOf('## Output Format');
  const rulesIdx = fullPrompt.indexOf('## Rules');
  const cut = [outputIdx, rulesIdx].filter((i) => i > 0).sort((a, b) => a - b)[0];
  const body = cut ? fullPrompt.slice(0, cut) : fullPrompt;
  return body.slice(0, 12000);
}

function buildSkillsList(skills) {
  return skills.length
    ? skills.map((s) => `- ${s.name} (${s.category}): ${s.description || ''}`).join('\n')
    : 'No skills configured.';
}

export async function planJiraStructure({ repoContext, prompt, promptName, messages }) {
  const conversation = messages
    .map((m) => `${m.role === 'user' ? 'User' : 'Sarah'}: ${m.content}`)
    .join('\n');

  const systemPrompt = `You are a senior PM planning Jira tickets. Follow the PM PROMPT exactly — especially flow steps, onboarding sections, and output structure.

PM PROMPT ("${promptName}"):
${prompt}

FEATURE SCOPE: ${repoContext.featureSummary || 'See call'}
SCOPED FILES: ${repoContext.filesAnalyzed} files

CODE SUMMARY (scoped):
${formatRepoForAI(repoContext).slice(0, 60000)}

CALL:
${conversation}

PLANNING RULES:
1. Create ONE epic for the discussed feature area.
2. Create MULTIPLE stories — one per distinct user flow/step in the PM prompt (e.g. onboarding = company detection, profile review, benchmark inputs, benchmark results, Fuel value, York context, signal handoff, sidebar, chat polish = 8-9 stories minimum).
3. Do NOT collapse the whole feature into a single story.
4. Use exact terminology from the PM prompt (Fuel, Intelligence, Scorecard, etc.).
5. Each storyPlan must reference what code/design files apply.

Return JSON:
{
  "epic": {
    "title": "[Module] Feature Name",
    "description": "2-3 sentences",
    "epicGoal": "one paragraph goal",
    "epicScope": ["bullet list of what epic covers"],
    "acceptanceCriteria": ["3-5 epic-level criteria"],
    "labels": "module-name",
    "fixVersion": ""
  },
  "storyPlans": [
    {
      "number": 1,
      "title": "Story title",
      "userStory": "As a ... I want ... so that ...",
      "focus": "what this story covers",
      "pmPromptSection": "which section of PM prompt this maps to",
      "relatedFiles": ["file paths"]
    }
  ],
  "assumptions": ["string"]
}`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: 'Create the epic and detailed story plan now.' },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.2,
    max_tokens: 8000,
  });

  return safeParseJson(response.choices[0]?.message?.content, 'plan');
}

export async function generateStoryBatch({ storyPlans, epic, repoContext, prompt, promptName, skills }) {
  const systemPrompt = `You are a senior PM writing DETAILED Jira stories. Follow the PM PROMPT Output Format and Rules EXACTLY.

PM PROMPT ("${promptName}"):
${prompt}

TEAM SKILLS:
${buildSkillsList(skills)}

EPIC: ${epic.title}
${epic.epicGoal || epic.description}

SCOPED CODE (reference real paths, components, APIs):
${formatRepoForAI(repoContext).slice(0, 50000)}

For EACH story in the batch, produce:
- Rich acceptance criteria (5-12 items) matching PM prompt detail level
- FE subtask with scope, designRef, dataFields or displayedValues tables where applicable
- BE subtask if APIs/data handling needed (or note N/A for demo-only UI)
- QA subtask LAST with Gherkin scenarios in gherkinFeatures + testCases
- Use [ASSUMPTION: ...] in description when unclear

Return JSON: { "stories": [ ${STORY_DETAIL_SCHEMA} ] }

Stories to write now:
${JSON.stringify(storyPlans, null, 2)}`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: 'Write full detailed stories for this batch. Match the depth of a senior PM ticket set.' },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.25,
    max_tokens: 16000,
  });

  const parsed = safeParseJson(response.choices[0]?.message?.content, 'story batch');
  const stories = parsed.stories || parsed.Stories || [];
  if (!stories.length) {
    console.warn('Story batch returned no stories for:', storyPlans.map((s) => s.title).join(', '));
  }
  return stories;
}

export async function* streamJiraTickets({ repoContext, prompt, promptName, skills, messages }) {
  yield { type: 'phase', phase: 'plan' };

  const plan = await planJiraStructure({ repoContext, prompt, promptName, messages });
  if (!plan.epic || !plan.storyPlans?.length) {
    throw new Error('Failed to plan Jira structure. Try again with more detail on the call.');
  }

  const epic = { ...plan.epic, stories: [] };
  yield { type: 'epic', epic: { ...epic } };

  const batchSize = 2;
  for (let i = 0; i < plan.storyPlans.length; i += batchSize) {
    yield { type: 'phase', phase: 'write', batch: Math.floor(i / batchSize) + 1 };

    const batch = plan.storyPlans.slice(i, i + batchSize);
    let stories = [];
    try {
      stories = await generateStoryBatch({
        storyPlans: batch,
        epic: plan.epic,
        repoContext,
        prompt,
        promptName,
        skills,
      });
    } catch (err) {
      console.error(`Story batch failed (${i}):`, err.message);
      stories = batch.map((sp) => ({
        title: sp.userStory || sp.title,
        description: `${sp.focus || sp.title}\n\nPM section: ${sp.pmPromptSection || 'N/A'}`,
        acceptanceCriteria: ['[ASSUMPTION: Detailed criteria pending — regenerate or edit in Jira]'],
        storyPoints: '3',
        linkedEpic: plan.epic.title,
        subtasks: [
          {
            discipline: 'FE',
            title: `[FE] ${sp.title}`,
            description: sp.focus || sp.title,
            assignee: 'FE',
            acceptanceCriteria: ['Implementation matches scoped design and code'],
          },
        ],
      }));
    }

    for (const story of stories) {
      const normalized = { ...story, linkedEpic: story.linkedEpic || plan.epic.title };
      epic.stories.push(normalized);
      yield { type: 'story', story: normalized, epic: { ...epic } };
    }
  }

  const result = {
    epics: [{ ...epic }],
    assumptions: plan.assumptions || [],
    summary: plan.epic.epicGoal || plan.epic.description,
  };

  yield { type: 'complete', result };
}

export async function generateJiraTicketsMultiPass({ repoContext, prompt, promptName, skills, messages }) {
  const plan = await planJiraStructure({ repoContext, prompt, promptName, messages });

  if (!plan.epic || !plan.storyPlans?.length) {
    throw new Error('Failed to plan Jira structure. Try again with more detail on the call.');
  }

  const allStories = [];
  const batchSize = 2;

  for (let i = 0; i < plan.storyPlans.length; i += batchSize) {
    const batch = plan.storyPlans.slice(i, i + batchSize);
    try {
      const stories = await generateStoryBatch({
        storyPlans: batch,
        epic: plan.epic,
        repoContext,
        prompt,
        promptName,
        skills,
      });
      allStories.push(...stories);
    } catch (err) {
      console.error(`Story batch failed (${i}):`, err.message);
      for (const sp of batch) {
        allStories.push({
          title: sp.userStory || sp.title,
          description: `${sp.focus || sp.title}\n\nPM section: ${sp.pmPromptSection || 'N/A'}\nRelated files: ${(sp.relatedFiles || []).join(', ')}`,
          acceptanceCriteria: ['[ASSUMPTION: Detailed criteria pending — regenerate or edit in Jira]'],
          storyPoints: '3',
          linkedEpic: plan.epic.title,
          subtasks: [
            {
              discipline: 'FE',
              title: `[FE] ${sp.title}`,
              description: sp.focus || sp.title,
              assignee: 'FE',
              acceptanceCriteria: ['Implementation matches scoped design and code'],
            },
            {
              discipline: 'QA',
              title: `[QA] ${sp.title} — test scope`,
              description: 'Regression and acceptance testing for this story',
              assignee: 'QA',
              testCases: ['Happy path for this flow'],
              acceptanceCriteria: ['All acceptance criteria verified'],
            },
          ],
        });
      }
    }
  }

  if (!allStories.length) {
    throw new Error('No stories were generated. Try describing the feature with more detail on the call.');
  }

  const epic = {
    ...plan.epic,
    stories: allStories.map((s) => ({
      ...s,
      linkedEpic: s.linkedEpic || plan.epic.title,
    })),
  };

  return {
    epics: [epic],
    assumptions: plan.assumptions || [],
    summary: plan.epic.epicGoal || plan.epic.description,
  };
}
