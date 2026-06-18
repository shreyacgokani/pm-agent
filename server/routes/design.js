import { Router } from 'express';
import OpenAI from 'openai';
import {
  listDesignProjects,
  loadFullProject,
  getVersionCode,
  saveDesignVersion,
} from '../services/designGithub.js';
import { isGithubAuthenticated } from '../services/githubAuth.js';
import { cleanGeneratedReact } from '../utils/designCode.js';

const router = Router();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `You are a frontend design AI. The user describes a UI and you return a complete React component that renders a beautiful, modern design.

CRITICAL OUTPUT RULES:
- Return ONLY raw React JSX code. No markdown, no code fences, no explanation, no preamble.
- Export a single root component named App: use "function App() { ... }" or "const App = () => { ... }".
- Use React 18 patterns. You may use useState, useEffect, useRef, useMemo, useCallback.
- Include all CSS as a <style> tag INSIDE the App component's returned JSX (at the top of the fragment/div).
- Do NOT use import, export, or require statements — React hooks are pre-declared globally.
- NEVER write "import React" or "import { useState }" — use useState directly.
- Do NOT use react-router, styled-components, or any npm packages — only React hooks and inline styles/CSS.
- Use CSS custom properties for theming. Default to a clean, production-quality light theme unless asked otherwise.
- Real placeholder content matching the prompt — never "Lorem ipsum".
- Mobile responsive using CSS Grid and Flexbox with media queries in the embedded <style>.
- Proper spacing (8px grid), typography scale, hover states, transitions (200ms ease).
- If iterating on a previous design, you receive the previous React code — modify it directly, preserve what works.

DESIGN QUALITY:
- Pick one visual direction and commit fully (minimal, bold, editorial, soft, or dark).
- One primary color, neutral palette, one accent — max 3 hues unless prompt demands more.
- Real structure: nav, hero, cards, sections — not placeholder boxes.
- When in doubt, make it look like a well-funded startup landing page or SaaS dashboard.`;

const THINKING_PHASES = [
  { key: 'understand', text: 'Understanding your request…', minChars: 0 },
  { key: 'plan', text: 'Planning layout and component structure…', minChars: 80 },
  { key: 'components', text: 'Writing React components…', minChars: 250, pattern: /function\s+App|const\s+App\s*=/ },
  { key: 'styles', text: 'Applying styles and visual design…', minChars: 500, pattern: /className|<style/ },
  { key: 'polish', text: 'Polishing interactions and responsive layout…', minChars: 1200 },
];

function stripCodeFences(source) {
  return cleanGeneratedReact(source);
}

function detectPhase(charCount, buffer) {
  let active = THINKING_PHASES[0];
  for (const phase of THINKING_PHASES) {
    const patternOk = !phase.pattern || phase.pattern.test(buffer);
    if (charCount >= phase.minChars && patternOk) active = phase;
  }
  return active;
}

function writeSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
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

router.get('/projects/:projectId/versions/:version', async (req, res) => {
  try {
    if (!isGithubAuthenticated()) {
      return res.status(400).json({ error: 'GitHub not connected' });
    }
    const version = parseInt(req.params.version, 10);
    const code = await getVersionCode(req.params.projectId, version);
    res.json({ code, version });
  } catch (err) {
    console.error('Load design version error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/generate', async (req, res) => {
  try {
    const { prompt, previousCode, projectId, projectName, isNew, createdAt } = req.body;

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

    const userContent = previousCode?.trim()
      ? `Previous React code:\n${previousCode}\n\nRequested changes:\n${prompt}`
      : prompt;

    writeSse(res, { type: 'status', phase: 'understand', text: THINKING_PHASES[0].text });

    const stream = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 8000,
      temperature: 0.85,
      stream: true,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
    });

    let buffer = '';
    let lastPhaseKey = 'understand';

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (!content) continue;

      buffer += content;
      writeSse(res, { type: 'delta', delta: content });

      const phase = detectPhase(buffer.length, buffer);
      if (phase.key !== lastPhaseKey) {
        lastPhaseKey = phase.key;
        writeSse(res, { type: 'status', phase: phase.key, text: phase.text });
      }
    }

    const reactCode = stripCodeFences(buffer);

    // Send complete immediately so preview can render without waiting for GitHub.
    writeSse(res, {
      type: 'complete',
      code: reactCode,
    });

    writeSse(res, { type: 'status', phase: 'save', text: 'Saving to your project repo on GitHub…' });

    let githubMeta = null;
    if (isGithubAuthenticated() && projectId) {
      try {
        githubMeta = await saveDesignVersion({
          projectId,
          name: projectName || prompt.slice(0, 60),
          prompt: isNew ? prompt : undefined,
          iterationPrompt: prompt,
          reactCode,
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
