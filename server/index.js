import http from 'http';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { initDb, getDbMode } from './db/index.js';
import { isGithubTokenConfigured } from './services/github.js';
import { getGithubAuthStatus } from './services/githubAuth.js';
import { setupRealtimeProxy } from './realtime/realtimeProxy.js';
import dashboardRoutes from './routes/dashboard.js';
import promptsRoutes from './routes/prompts.js';
import skillsRoutes from './routes/skills.js';
import generateRoutes from './routes/generate.js';
import githubRoutes from './routes/github.js';
import chatRoutes from './routes/chat.js';
import ttsRoutes from './routes/tts.js';
import designRoutes from './routes/design.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => {
  const github = getGithubAuthStatus();
  res.json({
    status: 'ok',
    database: getDbMode(),
    githubTokenConfigured: isGithubTokenConfigured(),
    githubConnected: github.connected,
    githubUsername: github.username,
    selectedRepo: github.selectedRepo,
    realtime: Boolean(process.env.OPENAI_API_KEY),
  });
});

app.use('/api/dashboard', dashboardRoutes);
app.use('/api/prompts', promptsRoutes);
app.use('/api/skills', skillsRoutes);
app.use('/api/generate', generateRoutes);
app.use('/api/github', githubRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/tts', ttsRoutes);
app.use('/api/design', designRoutes);

await initDb();

const server = http.createServer(app);
setupRealtimeProxy(server);

server.listen(PORT, () => {
  console.log(`PM Agent server running on http://localhost:${PORT}`);
});
