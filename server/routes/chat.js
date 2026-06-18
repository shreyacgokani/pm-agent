import { Router } from 'express';
import pool from '../db/index.js';
import { fetchRepoIndex, fetchScopedRepoContext } from '../services/github.js';
import {
  startConversation,
  continueConversation,
  generateJiraTickets,
} from '../services/openai.js';
import {
  createSession,
  getSession,
  addMessage,
  getMessages,
} from '../services/chat.js';

const router = Router();

import { streamJiraTickets } from '../services/jiraGeneration.js';

const VOICE_OPENING_LINE =
  "Hey! It's Sarah — I've looked over your project. What area or flow should we turn into Jira tickets?";

async function getActivePromptAndSkills() {
  const [promptResult, skillsResult] = await Promise.all([
    pool.query('SELECT id, name, content FROM prompts WHERE is_active = true LIMIT 1'),
    pool.query('SELECT * FROM skills ORDER BY name'),
  ]);

  const activePrompt = promptResult.rows[0];
  if (!activePrompt?.content) {
    throw new Error('No active prompt found. Create and activate a prompt first.');
  }

  return { activePrompt, skills: skillsResult.rows };
}

router.post('/start', async (req, res) => {
  try {
    const { repo_url, branch } = req.body;
    if (!repo_url || !branch) {
      return res.status(400).json({ error: 'GitHub repo URL and branch are required' });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(400).json({ error: 'OpenAI API key not configured' });
    }

    const { activePrompt, skills } = await getActivePromptAndSkills();
    const repoContext = await fetchRepoIndex(repo_url, branch);

    const useVoice = req.body.voice !== false;
    const agentReply = useVoice
      ? { message: VOICE_OPENING_LINE, readyToGenerate: false, autoGenerate: false }
      : await startConversation({
          repoContext,
          prompt: activePrompt.content,
          promptName: activePrompt.name,
          skills,
        });

    const sessionId = createSession({
      repo_url,
      branch,
      repoContext,
      prompt: activePrompt.content,
      promptName: activePrompt.name,
      skills,
    });

    addMessage(sessionId, 'assistant', agentReply.message);

    res.json({
      sessionId,
      message: agentReply.message,
      readyToGenerate: agentReply.readyToGenerate,
      autoGenerate: agentReply.autoGenerate,
      repo: {
        fullName: repoContext.fullName,
        branch: repoContext.branch,
        filesAnalyzed: 0,
        totalFiles: repoContext.totalFiles,
        indexMode: true,
      },
      prompt_used: { id: activePrompt.id, name: activePrompt.name },
    });
  } catch (err) {
    console.error('Chat start error:', err);
    res.status(500).json({ error: err.message || 'Failed to start PM Agent session' });
  }
});

router.post('/:sessionId/message', async (req, res) => {
  try {
    const { content } = req.body;
    if (!content?.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const session = getSession(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Session expired. Please start a new conversation.' });

    addMessage(req.params.sessionId, 'user', content.trim());

    const agentReply = await continueConversation({
      repoContext: session.repoContext,
      prompt: session.prompt,
      promptName: session.promptName,
      skills: session.skills,
      messages: getMessages(req.params.sessionId),
      userMessage: content.trim(),
    });

    addMessage(req.params.sessionId, 'assistant', agentReply.message);

    res.json({
      message: agentReply.message,
      readyToGenerate: agentReply.readyToGenerate,
      autoGenerate: agentReply.autoGenerate,
    });
  } catch (err) {
    console.error('Chat message error:', err);
    res.status(500).json({ error: err.message || 'Failed to process message' });
  }
});

router.post('/:sessionId/generate', async (req, res) => {
  try {
    if (!req.body?.userConfirmed) {
      return res.status(400).json({ error: 'Ticket generation requires explicit user confirmation.' });
    }

    const session = getSession(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Session expired. Please start a new conversation.' });

    const messages = getMessages(req.params.sessionId);
    const repoContext = await fetchScopedRepoContext(
      session.repo_url,
      session.branch,
      messages,
      session.prompt
    );

    const result = await generateJiraTickets({
      repoContext,
      prompt: session.prompt,
      promptName: session.promptName,
      skills: session.skills,
      messages,
    });

    const saved = await pool.query(
      'INSERT INTO generations (repo_url, repo_name, result) VALUES ($1, $2, $3) RETURNING *',
      [session.repo_url, session.repoContext.fullName, JSON.stringify(result)]
    );

    res.status(201).json({
      ...saved.rows[0],
      result,
      repo: {
        filesAnalyzed: repoContext.filesAnalyzed,
        totalFiles: repoContext.totalFiles,
        scopedPaths: repoContext.scopedPaths?.length || 0,
        featureSummary: repoContext.featureSummary,
      },
      prompt_used: { name: session.promptName },
    });
  } catch (err) {
    console.error('Chat generate error:', err);
    res.status(500).json({ error: err.message || 'Failed to generate Jira tickets' });
  }
});

router.post('/:sessionId/generate-stream', async (req, res) => {
  try {
    if (!req.body?.userConfirmed) {
      return res.status(400).json({ error: 'Ticket generation requires explicit user confirmation.' });
    }

    const session = getSession(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Session expired. Please start a new conversation.' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const messages = getMessages(req.params.sessionId);

    res.write(`data: ${JSON.stringify({ type: 'phase', phase: 'scope' })}\n\n`);

    const repoContext = await fetchScopedRepoContext(
      session.repo_url,
      session.branch,
      messages,
      session.prompt
    );

    res.write(`data: ${JSON.stringify({
      type: 'scope',
      repo: {
        filesAnalyzed: repoContext.filesAnalyzed,
        totalFiles: repoContext.totalFiles,
        scopedPaths: repoContext.scopedPaths?.length || 0,
        featureSummary: repoContext.featureSummary,
      },
    })}\n\n`);

    let finalResult = null;

    for await (const event of streamJiraTickets({
      repoContext,
      prompt: session.prompt,
      promptName: session.promptName,
      skills: session.skills,
      messages,
    })) {
      if (event.type === 'complete') {
        finalResult = event.result;
      }
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    if (!finalResult?.epics?.length) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: 'No tickets were generated.' })}\n\n`);
      return res.end();
    }

    const saved = await pool.query(
      'INSERT INTO generations (repo_url, repo_name, result) VALUES ($1, $2, $3) RETURNING *',
      [session.repo_url, session.repoContext.fullName, JSON.stringify(finalResult)]
    );

    res.write(`data: ${JSON.stringify({ type: 'saved', id: saved.rows[0].id })}\n\n`);
    res.end();
  } catch (err) {
    console.error('Chat generate-stream error:', err);
    res.write(`data: ${JSON.stringify({ type: 'error', error: err.message || 'Failed to generate Jira tickets' })}\n\n`);
    res.end();
  }
});

export default router;
