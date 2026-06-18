import { Router } from 'express';
import pool from '../db/index.js';
import { fetchRepoContext } from '../services/github.js';
import { generateWorkItems } from '../services/openai.js';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, repo_url, repo_name, result, created_at FROM generations ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM generations WHERE id = $1', [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Generation not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { repo_url, branch } = req.body;
    if (!repo_url) return res.status(400).json({ error: 'GitHub repo URL is required' });
    if (!branch) return res.status(400).json({ error: 'Branch is required' });

    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'your_openai_api_key_here') {
      return res.status(400).json({ error: 'OpenAI API key not configured. Set OPENAI_API_KEY in server/.env' });
    }

    const [promptResult, skillsResult] = await Promise.all([
      pool.query('SELECT id, name, content FROM prompts WHERE is_active = true LIMIT 1'),
      pool.query('SELECT * FROM skills ORDER BY name'),
    ]);

    const activePrompt = promptResult.rows[0];
    const prompt = activePrompt?.content;
    if (!prompt) {
      return res.status(400).json({ error: 'No active prompt found. Create and activate a prompt first.' });
    }

    console.log(`Generating with active prompt: "${activePrompt.name}" (id: ${activePrompt.id})`);

    const repoContext = await fetchRepoContext(repo_url, branch);
    const result = await generateWorkItems({
      repoContext,
      prompt,
      skills: skillsResult.rows,
    });

    const saved = await pool.query(
      'INSERT INTO generations (repo_url, repo_name, result) VALUES ($1, $2, $3) RETURNING *',
      [repo_url, repoContext.fullName, JSON.stringify(result)]
    );

    res.status(201).json({
      ...saved.rows[0],
      prompt_used: { id: activePrompt.id, name: activePrompt.name },
    });
  } catch (err) {
    console.error('Generation error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
