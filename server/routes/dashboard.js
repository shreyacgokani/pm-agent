import { Router } from 'express';
import pool, { getDbMode } from '../db/index.js';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const [prompts, skills, generations] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM prompts'),
      pool.query('SELECT COUNT(*) FROM skills'),
      pool.query('SELECT COUNT(*) FROM generations'),
    ]);

    const recent = await pool.query(
      'SELECT id, repo_url, repo_name, created_at FROM generations ORDER BY created_at DESC LIMIT 5'
    );

    const activePrompt = await pool.query(
      'SELECT id, name FROM prompts WHERE is_active = true LIMIT 1'
    );

    res.json({
      counts: {
        prompts: parseInt(prompts.rows[0].count),
        skills: parseInt(skills.rows[0].count),
        generations: parseInt(generations.rows[0].count),
      },
      activePrompt: activePrompt.rows[0]?.name || null,
      activePromptId: activePrompt.rows[0]?.id || null,
      database: getDbMode(),
      recentGenerations: recent.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to load dashboard' });
  }
});

export default router;
