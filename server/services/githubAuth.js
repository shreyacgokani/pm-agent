import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';
import {
  getOAuthConfig,
  isOAuthConfigured,
  getCallbackUrl,
  getFrontendUrl,
  renderManifestBootstrapPage,
  saveOAuthConfig,
  isLocalDev,
  canUseManifestBootstrap,
} from './githubOAuthConfig.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_STORE_PATH = path.join(__dirname, '../data/github-auth.json');

/** Scopes requested on GitHub OAuth — repo covers PM Agent reads + Design Agent repo creation. */
export const GITHUB_OAUTH_SCOPES = 'repo read:user';
export const GITHUB_REQUIRED_SCOPES = ['repo'];

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

export function evaluateGithubPermissions(auth = loadAuth()) {
  if (!auth?.access_token) {
    return {
      connected: false,
      scopes: [],
      isFineGrained: false,
      hasRepoScope: false,
      allGranted: false,
      recommendLogin: true,
      permissions: [],
    };
  }

  const scopes = auth.scopes || (auth.scope ? auth.scope.split(',').map((s) => s.trim()).filter(Boolean) : []);
  const isFineGrained = Boolean(auth.is_fine_grained || isFineGrainedToken(auth.access_token));
  const hasRepoScope = scopes.includes('repo') || scopes.includes('public_repo') || Boolean(auth.oauth_via_app);
  const isOAuth = auth.method === 'oauth';

  const permissions = [
    {
      id: 'profile',
      label: 'Read your GitHub profile',
      granted: true,
    },
    {
      id: 'list_repos',
      label: 'List your repositories',
      granted: true,
    },
    {
      id: 'read_code',
      label: 'Read repository code for PM Agent',
      granted: hasRepoScope || isFineGrained,
    },
    {
      id: 'create_repos',
      label: 'Create private pm-design-* repos for Design Agent',
      granted: hasRepoScope && !isFineGrained,
    },
  ];

  const allGranted = permissions.every((p) => p.granted);
  const recommendLogin = (isFineGrained && auth.method === 'pat') || !isOAuth || !hasRepoScope;

  return {
    connected: true,
    method: auth.method || 'oauth',
    scopes,
    isFineGrained,
    hasRepoScope,
    allGranted,
    recommendLogin,
    permissions,
    oauthScopes: GITHUB_OAUTH_SCOPES,
  };
}

export function getGithubAuthStatus() {
  const stored = loadAuth();
  const envToken = Boolean(process.env.GITHUB_TOKEN?.trim());
  const oauthConfigured = isOAuthConfigured();
  const localDev = isLocalDev();

  if (stored?.access_token) {
    return {
      connected: true,
      username: stored.username || null,
      method: stored.method || 'oauth',
      avatarUrl: stored.avatar_url || null,
      selectedRepo: stored.selectedRepo || null,
      oauthConfigured,
      localDev,
      oauthScopes: GITHUB_OAUTH_SCOPES,
      ...evaluateGithubPermissions(stored),
    };
  }

  if (envToken) {
    return {
      connected: true,
      username: null,
      method: 'env',
      avatarUrl: null,
      selectedRepo: stored?.selectedRepo || null,
      oauthConfigured,
      localDev,
      oauthScopes: GITHUB_OAUTH_SCOPES,
      scopes: [],
      isFineGrained: false,
      hasRepoScope: true,
      allGranted: true,
      recommendLogin: false,
      permissions: [],
    };
  }

  return {
    connected: false,
    username: null,
    method: null,
    avatarUrl: null,
    selectedRepo: null,
    oauthConfigured,
    localDev,
    oauthScopes: GITHUB_OAUTH_SCOPES,
    scopes: [],
    isFineGrained: false,
    hasRepoScope: false,
    allGranted: false,
    recommendLogin: true,
    permissions: [],
  };
}

export function getSelectedRepo() {
  const stored = loadAuth();
  return stored?.selectedRepo || null;
}

export function getDesignStorageBranch() {
  const selected = getSelectedRepo();
  return selected?.branch || selected?.defaultBranch || 'main';
}

export function isFineGrainedToken(token) {
  return Boolean(token?.startsWith('github_pat_'));
}

export function canCreateDedicatedRepos() {
  const stored = loadAuth();
  if (!stored?.access_token) return false;
  if (stored.oauth_via_app) return true;
  if (stored.is_fine_grained || isFineGrainedToken(stored.access_token)) return false;
  const scopes = stored.scopes || (stored.scope ? stored.scope.split(',').map((s) => s.trim()) : []);
  return scopes.includes('repo') || scopes.includes('public_repo');
}

export function shouldPreferNestedDesignStorage() {
  return false;
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

export { getCallbackUrl, getFrontendUrl, isOAuthConfigured, isLocalDev, canUseManifestBootstrap, renderManifestBootstrapPage, saveOAuthConfig };

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
  const { clientId, appSlug } = getOAuthConfig();
  if (!clientId) {
    throw new Error('GitHub OAuth is not ready yet. Click Connect with GitHub again.');
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getCallbackUrl(),
    state,
  });
  if (!appSlug) {
    params.set('scope', GITHUB_OAUTH_SCOPES);
  }

  return `https://github.com/login/oauth/authorize?${params}`;
}

export async function exchangeOAuthCode(code) {
  const { clientId, clientSecret } = getOAuthConfig();

  if (!clientId || !clientSecret) {
    throw new Error('GitHub OAuth is not ready yet. Click Connect with GitHub again.');
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
  const scopes = (data.scope || '').split(',').map((s) => s.trim()).filter(Boolean);
  const hasRepoScope = scopes.includes('repo') || scopes.includes('public_repo');
  const { appSlug } = getOAuthConfig();

  if (!hasRepoScope && !appSlug) {
    throw new Error(
      'GitHub did not grant the "repo" permission. Sign in again and approve all requested permissions so PM Agent and Design Agent can access your repositories.'
    );
  }

  if (appSlug) {
    const repoAccess = await verifyGithubRepoAccess(data.access_token);
    if (!repoAccess) {
      throw new Error(
        'GitHub did not grant repository access. Sign in again and approve all requested permissions.'
      );
    }
  }

  saveAuth({
    access_token: data.access_token,
    token_type: data.token_type,
    scope: data.scope,
    scopes: scopes.length ? scopes : ['repo'],
    username: user.login,
    avatar_url: user.avatar_url,
    method: 'oauth',
    is_fine_grained: false,
    oauth_via_app: Boolean(appSlug),
    connected_at: new Date().toISOString(),
  });

  return user;
}

export async function connectWithPat(token) {
  if (!token?.trim()) throw new Error('GitHub token is required');

  const trimmed = token.trim();
  const user = await fetchGithubUser(trimmed);

  const scopeRes = await fetch('https://api.github.com/user', {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${trimmed}`,
    },
  });
  const scopes = (scopeRes.headers.get('x-oauth-scopes') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const isFineGrained = Boolean(scopeRes.headers.get('github-authentication-token-expiration'))
    || isFineGrainedToken(trimmed);

  if (!isFineGrained && !scopes.some((s) => s === 'repo' || s === 'public_repo')) {
    throw new Error(
      'This classic token is missing the "repo" scope. Create a new classic PAT at github.com/settings/tokens with "repo" checked.'
    );
  }

  saveAuth({
    access_token: trimmed,
    username: user.login,
    avatar_url: user.avatar_url,
    method: 'pat',
    scopes,
    is_fine_grained: isFineGrained,
    connected_at: new Date().toISOString(),
  });

  return { user, isFineGrained };
}

async function verifyGithubRepoAccess(token) {
  const res = await fetch('https://api.github.com/user/repos?per_page=1', {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
    },
  });
  return res.ok;
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
