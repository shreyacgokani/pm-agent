import { Router } from 'express';
import {
  fetchBranches,
  fetchRepoBranches,
  fetchUserRepos,
} from '../services/github.js';
import {
  createOAuthState,
  verifyOAuthState,
  getOAuthAuthorizeUrl,
  exchangeOAuthCode,
  connectWithPat,
  clearAuth,
  getGithubAuthStatus,
  getGithubAccessToken,
  setSelectedRepo,
  clearSelectedRepo,
  getFrontendRedirect,
  evaluateGithubPermissions,
  GITHUB_OAUTH_SCOPES,
  isOAuthConfigured,
  renderManifestBootstrapPage,
  saveOAuthConfig,
  isLocalDev,
  canUseManifestBootstrap,
} from '../services/githubAuth.js';
import { inspectGithubToken } from '../services/designGithub.js';

const router = Router();

router.get('/auth/status', (_req, res) => {
  res.json(getGithubAuthStatus());
});

router.get('/auth/capabilities', async (_req, res) => {
  try {
    const token = getGithubAccessToken();
    if (!token) {
      return res.json({ connected: false, design: null, permissions: evaluateGithubPermissions() });
    }
    const design = await inspectGithubToken(token);
    res.json({
      connected: true,
      design,
      permissions: evaluateGithubPermissions(),
      oauthScopes: GITHUB_OAUTH_SCOPES,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/auth/login', (req, res) => {
  try {
    if (isOAuthConfigured()) {
      const state = createOAuthState();
      return res.redirect(getOAuthAuthorizeUrl(state));
    }
    if (canUseManifestBootstrap()) {
      return res.type('html').send(renderManifestBootstrapPage());
    }
    res.redirect(`${getFrontendRedirect('/integrations')}?oauth_hint=local`);
  } catch (err) {
    res.redirect(`${getFrontendRedirect('/integrations')}?error=${encodeURIComponent(err.message)}`);
  }
});

router.post('/webhook', (_req, res) => {
  res.sendStatus(204);
});

router.get('/manifest/callback', async (req, res) => {
  try {
    const { code, error, error_description } = req.query;
    if (error) throw new Error(error_description || error);
    if (!code) throw new Error('Missing manifest code from GitHub.');

    const conversion = await fetch(`https://api.github.com/app-manifests/${code}/conversions`, {
      method: 'POST',
      headers: { Accept: 'application/vnd.github+json' },
    });
    const data = await conversion.json();
    if (!conversion.ok) {
      throw new Error(data.message || 'Failed to register GitHub app.');
    }

    saveOAuthConfig({
      clientId: data.client_id,
      clientSecret: data.client_secret,
      appSlug: data.slug,
      appId: data.id,
    });

    const state = createOAuthState();
    res.redirect(getOAuthAuthorizeUrl(state));
  } catch (err) {
    res.redirect(`${getFrontendRedirect('/integrations')}?error=${encodeURIComponent(err.message)}`);
  }
});

router.get('/callback', async (req, res) => {
  try {
    const { code, state, error, error_description } = req.query;

    if (error) {
      throw new Error(error_description || error);
    }
    if (!code || !verifyOAuthState(state)) {
      throw new Error('Invalid OAuth callback. Please try connecting again.');
    }

    await exchangeOAuthCode(code);
    res.redirect(`${getFrontendRedirect('/integrations')}?connected=1`);
  } catch (err) {
    res.redirect(`${getFrontendRedirect('/integrations')}?error=${encodeURIComponent(err.message)}`);
  }
});

router.post('/auth/pat', async (req, res) => {
  try {
    const { token } = req.body;
    const { user, isFineGrained } = await connectWithPat(token);
    res.json({
      connected: true,
      username: user.login,
      avatarUrl: user.avatar_url,
      method: 'pat',
      isFineGrained,
      designAgentLimited: isFineGrained,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/auth/disconnect', (_req, res) => {
  clearAuth();
  res.json({ success: true });
});

router.get('/repos', async (_req, res) => {
  try {
    const repos = await fetchUserRepos();
    res.json(repos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/repos/:owner/:repo/branches', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    const data = await fetchRepoBranches(owner, repo);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/selection', (req, res) => {
  try {
    const { owner, repo, branch } = req.body;
    if (!owner || !repo || !branch) {
      return res.status(400).json({ error: 'owner, repo, and branch are required' });
    }

    const saved = setSelectedRepo({
      owner,
      repo,
      branch,
      fullName: `${owner}/${repo}`,
      defaultBranch: branch,
    });

    res.json(saved);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/selection', (_req, res) => {
  clearSelectedRepo();
  res.json({ success: true });
});

router.get('/branches', async (req, res) => {
  try {
    const { repo_url } = req.query;
    if (!repo_url) {
      return res.status(400).json({ error: 'repo_url query parameter is required' });
    }

    const data = await fetchBranches(repo_url);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to fetch branches' });
  }
});

export default router;
