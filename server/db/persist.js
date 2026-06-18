import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_PATH = path.join(__dirname, '../data/store.json');

export async function loadFromFile(pool) {
  if (!fs.existsSync(STORE_PATH)) return;

  try {
    const data = JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8'));

    await pool.query('DELETE FROM generations');
    await pool.query('DELETE FROM prompts');
    await pool.query('DELETE FROM skills');

    for (const p of data.prompts || []) {
      await pool.query(
        `INSERT INTO prompts (id, name, content, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [p.id, p.name, p.content, p.is_active, p.created_at, p.updated_at]
      );
    }

    for (const s of data.skills || []) {
      await pool.query(
        `INSERT INTO skills (id, name, description, category, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [s.id, s.name, s.description, s.category, s.created_at, s.updated_at]
      );
    }

    console.log('Loaded prompts and skills from file store');
  } catch (err) {
    console.warn('Failed to load file store:', err.message);
  }
}

export async function saveToFile(pool) {
  try {
    const [prompts, skills] = await Promise.all([
      pool.query('SELECT * FROM prompts ORDER BY id'),
      pool.query('SELECT * FROM skills ORDER BY id'),
    ]);

    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    fs.writeFileSync(
      STORE_PATH,
      JSON.stringify({ prompts: prompts.rows, skills: skills.rows }, null, 2)
    );
  } catch (err) {
    console.warn('Failed to save file store:', err.message);
  }
}
