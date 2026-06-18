import { Router } from 'express';
import pool, { saveToFile } from '../db/index.js';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const result = await pool.query('SELECT * FROM skills ORDER BY category, name');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, description, category } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });

    const result = await pool.query(
      'INSERT INTO skills (name, description, category) VALUES ($1, $2, $3) RETURNING *',
      [name, description || '', category || 'general']
    );
    await saveToFile(pool);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { name, description, category } = req.body;
    const result = await pool.query(
      `UPDATE skills SET name = COALESCE($1, name), description = COALESCE($2, description),
       category = COALESCE($3, category), updated_at = NOW()
       WHERE id = $4 RETURNING *`,
      [name, description, category, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Skill not found' });
    await saveToFile(pool);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM skills WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Skill not found' });
    await saveToFile(pool);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
