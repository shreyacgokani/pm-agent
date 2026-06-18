import OpenAI from 'openai';
import {
  tokenizeConversation,
  rankCatalog,
  expandByImportGraph,
  formatCatalogForPicker,
} from './repoIndex.js';
import { extractPromptFilePaths } from './jiraGeneration.js';
import { safeParseJson } from './jsonUtil.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SCOPE_LIMITS = {
  maxSeedFiles: 30,
  maxScopedFiles: 55,
  maxPerFile: 14000,
  maxTotalChars: 120000,
};

export async function pickSeedFilesWithLLM(repoIndex, messages) {
  const conversation = messages
    .map((m) => `${m.role === 'user' ? 'User' : 'Sarah'}: ${m.content}`)
    .join('\n');

  const terms = tokenizeConversation(messages);
  const ranked = rankCatalog(repoIndex.catalog, terms, 60);

  if (ranked.length === 0) {
    return repoIndex.catalog
      .filter((e) => ['page', 'route', 'api', 'component', 'design'].includes(e.kind))
      .slice(0, 15)
      .map((e) => e.path);
  }

  const pickerPrompt = `You are a code retrieval system (like IDE "find related files"). Given a voice call about Jira tickets for a specific product feature/flow, pick ONLY the repository files needed for that scope.

CALL TRANSCRIPT:
${conversation}

TOP CANDIDATE FILES (path, kind, exports, relevance score):
${formatCatalogForPicker(ranked)}

REPO FILE TREE (folders):
${summarizeTree(repoIndex.fileTree)}

Return JSON:
{
  "featureSummary": "one sentence — what feature/flow the user discussed",
  "seedPaths": ["exact paths from candidates or tree, max 25"]
}

Rules:
- Only include files connected to the discussed feature (pages, components, APIs, services, design docs for THAT flow).
- Include shared types/utils only if directly imported by those files.
- Do NOT include unrelated areas of the app.
- Use exact paths from the candidate list or file tree.`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: pickerPrompt },
        { role: 'user', content: 'Select the minimal connected file set for this feature scope.' },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 800,
    });

    const parsed = safeParseJson(response.choices[0]?.message?.content || '{}', 'file picker');
    const seeds = (parsed.seedPaths || []).filter((p) => repoIndex.pathSet.has(p));
    if (seeds.length) return { seeds, featureSummary: parsed.featureSummary || '' };
  } catch (err) {
    console.warn('LLM file picker fallback:', err.message);
  }

  return {
    seeds: ranked.slice(0, SCOPE_LIMITS.maxSeedFiles).map((e) => e.path),
    featureSummary: terms.slice(0, 5).join(', '),
  };
}

function summarizeTree(fileTree) {
  const folders = new Set();
  for (const path of fileTree) {
    const parts = path.split('/');
    for (let i = 1; i <= Math.min(parts.length - 1, 3); i++) {
      folders.add(parts.slice(0, i).join('/') + '/');
    }
  }
  return [...folders].sort().slice(0, 120).join('\n');
}

export async function scopeFilesForConversation(repoIndex, messages, pmPrompt = '') {
  const { seeds, featureSummary } = await pickSeedFilesWithLLM(repoIndex, messages);

  const promptPaths = extractPromptFilePaths(pmPrompt).filter((p) => repoIndex.pathSet.has(p));
  const onboardingPaths = repoIndex.fileTree.filter((p) =>
    /onboarding|FuelOnboarding|fuel-onboarding|onboarding-story/i.test(p)
  );

  const allSeeds = [...new Set([...promptPaths, ...onboardingPaths.slice(0, 8), ...seeds])];

  const expanded = expandByImportGraph(
    allSeeds,
    repoIndex.graph,
    repoIndex.pathSet,
    2,
    SCOPE_LIMITS.maxScopedFiles
  );

  if (repoIndex.readmePath && !expanded.includes(repoIndex.readmePath)) {
    expanded.unshift(repoIndex.readmePath);
  }

  return {
    paths: expanded,
    seedCount: seeds.length,
    featureSummary,
  };
}

export function loadScopedFileContents(zipEntries, paths, limits = SCOPE_LIMITS) {
  const pathToEntry = new Map(zipEntries.map((e) => [e.path, e]));
  const files = [];
  let totalChars = 0;

  for (const path of paths) {
    if (files.length >= limits.maxScopedFiles || totalChars >= limits.maxTotalChars) break;

    const entry = pathToEntry.get(path);
    if (!entry) continue;

    try {
      const raw = entry.entry.getData().toString('utf8');
      if (raw.includes('\ufffd')) continue;
      const content = raw.slice(0, limits.maxPerFile);
      files.push({ path, content });
      totalChars += content.length;
    } catch {
      // skip
    }
  }

  return { files, totalChars };
}
