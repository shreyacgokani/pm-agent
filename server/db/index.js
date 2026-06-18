import pg from 'pg';
import { newDb } from 'pg-mem';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { loadFromFile, saveToFile } from './persist.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let _pool = null;
let dbMode = 'unknown';

async function runSchema(pool) {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
  const statements = schema
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const stmt of statements) {
    await pool.query(stmt);
  }
}

async function connectPostgres() {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 3000,
  });

  const client = await pool.connect();
  await client.query('SELECT 1');
  client.release();

  pool.on('error', (err) => {
    console.error('Unexpected database error:', err);
  });

  return pool;
}

async function connectInMemory() {
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();
  await runSchema(pool);
  await loadFromFile(pool);
  return pool;
}

export async function initDb() {
  if (_pool) return _pool;

  try {
    _pool = await connectPostgres();
    dbMode = 'postgres';
    console.log('Connected to PostgreSQL');
  } catch (err) {
    console.warn(
      `PostgreSQL unavailable (${err.message || err}), using in-memory database`
    );
    _pool = await connectInMemory();
    dbMode = 'memory';
    console.log('In-memory database ready (prompts persisted to server/data/store.json)');
  }

  return _pool;
}

export function getDbMode() {
  return dbMode;
}

export { saveToFile };

const pool = {
  query: (...args) => {
    if (!_pool) {
      return Promise.reject(new Error('Database not initialized'));
    }
    return _pool.query(...args);
  },
};

export default pool;
