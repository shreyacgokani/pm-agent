import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_STORE_PATH = path.join(__dirname, '../data/github-auth.json');

const oauthStates = new Map();

let cachedAuth = null;

function loadAuth() {
  if (cachedAuth) return cachedAuth;
  if (!fs.existsSync(AUTH_STORE_PATH)) {
    cachedAuth = null;
    return null;
  }
  try {
    cachedAuth = JSON.parse(fs.readFileSync(AUTH_STORE_PATH, 'utf-8'));
    return cachedAuth;
  } catch {
    cachedAuth = null;
    return null;
  }
}

function saveAuth(data) {
  fs.mkdirSync(path.dirname(AUTH_STORE_PATH), { recursive: true });
  fs.writeFileSync(AUTH_STORE_PATH, JSON.stringify(data, null, 2));
  cachedAuth = data;
}

export function clearAuth() {
  const stored = loadAuth();
  const selectedRepo = stored?.selectedRepo;
  if (fs.existsSync(AUTH_STORE_PATH)) fs.unlinkSync(AUTH_STORE_PATH);
  cachedAuth = selectedRepo ? { selectedRepo } : null;
  if (cachedAuth) saveAuth(cachedAuth);
}

export function getGithubAccessToken() {
  const stored = loadAuth();
  if (stored?.access_token) return stored.access_token;
  if (process.env.GITHUB_TOKEN?.trim()) return process.env.GITHUB_TOKEN.trim();
  return null;
}

export function getGithubAuthStatus() {
  const stored = loadAuth();
  const envToken = Boolean(process.env.GITHUB_TOKEN?.trim());

  if (stored?.access_token) {
    return {
      connected: true,
      username: stored.username || null,
      method: stored.method || 'oauth',
      avatarUrl: stored.avatar_url || null,
      selectedRepo: stored.selectedRepo || null,
      oauthConfigured: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
    };
  }

  if (envToken) {
    return {
      connected: true,
      username: null,
      method: 'env',
      avatarUrl: null,
      selectedRepo: stored?.selectedRepo || null,
      oauthConfigured: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
    };
  }

  return {
    connected: false,
    username: null,
    method: null,
    avatarUrl: null,
    selectedRepo: null,
    oauthConfigured: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
  };
}

export function getSelectedRepo() {
  const stored = loadAuth();
  return stored?.selectedRepo || null;
}

export function setSelectedRepo({ owner, repo, fullName, branch, defaultBranch }) {
  const stored = loadAuth() || {};
  stored.selectedRepo = {
    owner,
    repo,
    fullName,
    branch,
    defaultBranch,
    repoUrl: `https://github.com/${owner}/${repo}`,
    updatedAt: new Date().toISOString(),
  };
  saveAuth(stored);
  return stored.selectedRepo;
}

export function clearSelectedRepo() {
  const stored = loadAuth();
  if (!stored) return;
  delete stored.selectedRepo;
  saveAuth(stored);
}

export function isGithubAuthenticated() {
  return Boolean(getGithubAccessToken());
}

function getCallbackUrl() {
  return process.env.GITHUB_CALLBACK_URL || 'http://localhost:5001/api/github/callback';
}

function getFrontendUrl() {
  return process.env.FRONTEND_URL || 'http://localhost:3000';
}

export function createOAuthState() {
  const state = randomBytes(16).toString('hex');
  oauthStates.set(state, Date.now());
  for (const [key, time] of oauthStates) {
    if (Date.now() - time > 10 * 60 * 1000) oauthStates.delete(key);
  }
  return state;
}

export function verifyOAuthState(state) {
  if (!state || !oauthStates.has(state)) return false;
  oauthStates.delete(state);
  return true;
}

export function getOAuthAuthorizeUrl(state) {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    throw new Error(
      'GitHub OAuth not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in server/.env, or connect with a Personal Access Token.'
    );
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getCallbackUrl(),
    scope: 'repo read:user',
    state,
  });

  return `https://github.com/login/oauth/authorize?${params}`;
}

export async function exchangeOAuthCode(code) {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('GitHub OAuth credentials not configured in server/.env');
  }

  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: getCallbackUrl(),
    }),
  });

  const data = await res.json();
  if (data.error) throw new Error(data.error_description || data.error);

  const user = await fetchGithubUser(data.access_token);
  saveAuth({
    access_token: data.access_token,
    token_type: data.token_type,
    scope: data.scope,
    username: user.login,
    avatar_url: user.avatar_url,
    method: 'oauth',
    connected_at: new Date().toISOString(),
  });

  return user;
}

export async function connectWithPat(token) {
  if (!token?.trim()) throw new Error('GitHub token is required');

  const user = await fetchGithubUser(token.trim());
  saveAuth({
    access_token: token.trim(),
    username: user.login,
    avatar_url: user.avatar_url,
    method: 'pat',
    connected_at: new Date().toISOString(),
  });

  return user;
}

async function fetchGithubUser(token) {
  const res = await fetch('https://api.github.com/user', {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Invalid GitHub token');
  }

  return res.json();
}

export function getFrontendRedirect(path = '/pm-agent') {
  return `${getFrontendUrl()}${path}`;
}
