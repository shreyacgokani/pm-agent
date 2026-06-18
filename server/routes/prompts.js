import { Router } from 'express';
import pool, { saveToFile } from '../db/index.js';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const result = await pool.query('SELECT * FROM prompts ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, content, is_active } = req.body;
    if (!name || !content) {
      return res.status(400).json({ error: 'Name and content are required' });
    }

    if (is_active) {
      await pool.query('UPDATE prompts SET is_active = false');
    }

    const result = await pool.query(
      'INSERT INTO prompts (name, content, is_active) VALUES ($1, $2, $3) RETURNING *',
      [name, content, is_active ?? false]
    );
    await saveToFile(pool);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { name, content, is_active } = req.body;
    const { id } = req.params;

    if (is_active) {
      await pool.query('UPDATE prompts SET is_active = false WHERE id != $1', [id]);
    }

    const result = await pool.query(
      `UPDATE prompts SET name = COALESCE($1, name), content = COALESCE($2, content),
       is_active = COALESCE($3, is_active), updated_at = NOW()
       WHERE id = $4 RETURNING *`,
      [name, content, is_active, id]
    );

    if (!result.rows[0]) return res.status(404).json({ error: 'Prompt not found' });
    await saveToFile(pool);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM prompts WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Prompt not found' });
    await saveToFile(pool);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
