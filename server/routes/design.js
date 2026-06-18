import { Router } from 'express';
import OpenAI from 'openai';
import {
  listDesignProjects,
  loadFullProject,
  getVersionTree,
  buildVersionZip,
  saveDesignVersion,
} from '../services/designGithub.js';
import { isGithubAuthenticated } from '../services/githubAuth.js';
import { buildFullProject, parseAiProjectResponse } from '../utils/designScaffold.js';
import { SYSTEM_PROMPT } from '../utils/designSystemPrompt.js';

const router = Router();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const STATUS_PHASES = [
  { key: 'understand', text: 'Understanding your request…' },
  { key: 'plan', text: 'Planning layout and component structure…' },
  { key: 'scaffold', text: 'Setting up Vite + React project scaffold…' },
  { key: 'components', text: 'Writing React components across multiple files…' },
  { key: 'styles', text: 'Applying design tokens and global styles…' },
  { key: 'bundle', text: 'Bundling project for preview…' },
  { key: 'save', text: 'Saving full project to GitHub…' },
];

async function planDesign(prompt) {
  if (!prompt?.trim()) return null;
  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 250,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `Output JSON only with these exact fields:
{
  "appType": "dashboard-app|crm|healthcare|saas|landing|form|profile|card-collection",
  "palette": "professional|dark|minimal|warm",
  "pages": ["list of page names this app needs, max 8"],
  "components": ["list of key components beyond pages, max 12"],
  "complexity": "simple|medium|complex",
  "brief": "one sentence describing the specific domain and content"
}`,
        },
        { role: 'user', content: prompt },
      ],
    });
    return JSON.parse(res.choices[0].message.content);
  } catch {
    return null;
  }
}

function writeSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function emitProgressStatuses(res, startIdx = 2) {
  return STATUS_PHASES.slice(startIdx, startIdx + 4).map((phase, i) =>
    setTimeout(() => {
      writeSse(res, { type: 'status', phase: phase.key, text: phase.text });
    }, 800 + i * 1200)
  );
}

const RUNTIME_CDN = {
  'react.js': 'https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js',
  'react-dom.js': 'https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.production.min.js',
  'babel.js': 'https://cdn.jsdelivr.net/npm/@babel/standalone@7.26.0/babel.min.js',
};

router.get('/runtime/:file', async (req, res) => {
  const url = RUNTIME_CDN[req.params.file];
  if (!url) return res.status(404).json({ error: 'Unknown runtime file' });

  try {
    const upstream = await fetch(url);
    if (!upstream.ok) throw new Error(`CDN fetch failed (${upstream.status})`);
    const body = await upstream.text();
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(body);
  } catch (err) {
    console.error('Design runtime proxy error:', err);
    res.status(502).json({ error: err.message });
  }
});

router.get('/projects', async (_req, res) => {
  try {
    if (!isGithubAuthenticated()) {
      return res.json({ projects: [], githubConnected: false });
    }
    const projects = await listDesignProjects();
    res.json({ projects, githubConnected: true });
  } catch (err) {
    console.error('List design projects error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/projects/:projectId', async (req, res) => {
  try {
    if (!isGithubAuthenticated()) {
      return res.status(400).json({ error: 'GitHub not connected' });
    }
    const project = await loadFullProject(req.params.projectId);
    res.json(project);
  } catch (err) {
    console.error('Load design project error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/projects/:projectId/tree', async (req, res) => {
  try {
    if (!isGithubAuthenticated()) {
      return res.status(400).json({ error: 'GitHub not connected' });
    }
    const version = parseInt(req.query.version, 10);
    if (!version) {
      const project = await loadFullProject(req.params.projectId);
      return res.json({
        version: project.activeVersion,
        files: project.files || {},
        fileCount: project.fileCount || 0,
      });
    }
    const tree = await getVersionTree(req.params.projectId, version);
    res.json(tree);
  } catch (err) {
    console.error('Load design tree error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/projects/:projectId/versions/:version', async (req, res) => {
  try {
    if (!isGithubAuthenticated()) {
      return res.status(400).json({ error: 'GitHub not connected' });
    }
    const version = parseInt(req.params.version, 10);
    const tree = await getVersionTree(req.params.projectId, version);
    const code = tree.files?.['src/app/App.jsx'] || Object.values(tree.files || {})[0] || '';
    res.json({ code, files: tree.files, version, fileCount: tree.fileCount });
  } catch (err) {
    console.error('Load design version error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/projects/:projectId/download', async (req, res) => {
  try {
    if (!isGithubAuthenticated()) {
      return res.status(400).json({ error: 'GitHub not connected' });
    }
    const version = parseInt(req.query.version, 10);
    let versionNum = version;
    if (!versionNum) {
      const project = await loadFullProject(req.params.projectId);
      versionNum = project.activeVersion;
    }
    const zipBuffer = await buildVersionZip(req.params.projectId, versionNum);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="design-${req.params.projectId}-v${versionNum}.zip"`
    );
    res.send(zipBuffer);
  } catch (err) {
    console.error('Design download error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/generate', async (req, res) => {
  try {
    const { prompt, previousCode, previousFiles, projectId, projectName, isNew, createdAt } = req.body;

    if (!prompt?.trim()) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'your_openai_api_key_here') {
      return res.status(400).json({ error: 'OpenAI API key not configured' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    writeSse(res, { type: 'status', phase: 'understand', text: STATUS_PHASES[0].text });

    const plan = previousFiles || previousCode?.trim() ? null : await planDesign(prompt);
    writeSse(res, { type: 'status', phase: 'plan', text: STATUS_PHASES[1].text });

    const complexityNote = plan?.complexity === 'complex'
      ? '\n\nCOMPLEX app: 12-20 files. Multiple pages and reusable components.'
      : plan?.complexity === 'medium'
        ? '\n\nMEDIUM app: 8-14 files. Multiple pages.'
        : '\n\nKeep file count reasonable (6-10 files for simple apps).';

    let userContent;
    if (previousFiles && typeof previousFiles === 'object' && Object.keys(previousFiles).length) {
      userContent = `Previous project files (JSON):\n${JSON.stringify({ files: previousFiles }, null, 0)}\n\nRequested changes:\n${prompt}\n\nReturn the FULL updated files object.`;
    } else if (previousCode?.trim()) {
      userContent = `Previous single-file React code (legacy — migrate to multi-file structure):\n${previousCode}\n\nRequested changes:\n${prompt}\n\nSplit into proper multi-file src/app/ structure.`;
    } else if (plan) {
      userContent = `Generate a ${plan.appType} using the ${plan.palette} palette.

USER REQUEST: "${prompt}"

PLAN:
- App type: ${plan.appType}
- Palette: ${plan.palette}
- Pages: ${plan.pages?.join(', ')}
- Components: ${plan.components?.join(', ')}
- Brief: ${plan.brief}
${complexityNote}

Generate the complete multi-file React + Vite project JSON.`;
    } else {
      userContent = prompt;
    }

    const progressTimers = emitProgressStatuses(res, 2);

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 16000,
      temperature: 0.85,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
    });

    progressTimers.forEach(clearTimeout);
    writeSse(res, { type: 'status', phase: 'bundle', text: STATUS_PHASES[5].text });

    const raw = completion.choices[0]?.message?.content || '';
    const parsed = parseAiProjectResponse(raw);
    const allFiles = buildFullProject(parsed.files, projectName || prompt.slice(0, 60));
    const reactCode = allFiles['src/app/App.jsx'] || '';
    const fileCount = Object.keys(allFiles).length;

    if (fileCount < 6) {
      throw new Error(`Generated project too small (${fileCount} files). Expected a full multi-file React app.`);
    }

    writeSse(res, {
      type: 'complete',
      code: reactCode,
      files: allFiles,
      fileCount,
      description: parsed.description,
      entry: parsed.entry,
    });

    writeSse(res, { type: 'status', phase: 'save', text: STATUS_PHASES[6].text });

    let githubMeta = null;
    if (isGithubAuthenticated() && projectId) {
      try {
        githubMeta = await saveDesignVersion({
          projectId,
          name: projectName || prompt.slice(0, 60),
          prompt: isNew ? prompt : undefined,
          iterationPrompt: prompt,
          files: allFiles,
          createdAt: createdAt || Date.now(),
          isNew: Boolean(isNew),
        });
        writeSse(res, {
          type: 'saved',
          version: githubMeta.version,
          repoUrl: githubMeta.repoUrl,
          githubRepo: githubMeta.githubRepo,
          storage: githubMeta.storage,
          filePath: githubMeta.filePath,
          fileCount,
        });
      } catch (ghErr) {
        console.error('GitHub save error:', ghErr);
        writeSse(res, { type: 'github_error', message: ghErr.message });
      }
    }

    if (githubMeta) {
      writeSse(res, {
        type: 'version_info',
        version: githubMeta.version,
        repoUrl: githubMeta.repoUrl,
        githubRepo: githubMeta.githubRepo,
        fileCount,
      });
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('Design generation error:', err);
    if (!res.headersSent) {
      return res.status(500).json({ error: err.message || 'Design generation failed' });
    }
    writeSse(res, { type: 'error', message: err.message });
    res.end();
  }
});

export default router;
