import {
  getGithubAccessToken,
  getSelectedRepo,
  getDesignStorageBranch,
  isFineGrainedToken,
} from './githubAuth.js';

const REPO_PREFIX = process.env.DESIGN_REPO_PREFIX || 'pm-design-';
const NESTED_ROOT = 'design-agent';
const API = 'https://api.github.com';

function headers() {
  const token = getGithubAccessToken();
  if (!token) throw new Error('GitHub not connected. Connect your account in Integrations.');
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

function isPermissionError(message = '') {
  return /not accessible by personal access token|Resource not accessible|insufficient_scope|403/i.test(message);
}

function formatGithubError(err, fallbackStatus) {
  const msg = err.message || `GitHub API error (${fallbackStatus})`;

  if (/not accessible by personal access token|Resource not accessible/i.test(msg)) {
    throw new Error(
      'Design Agent creates a separate private GitHub repo per project (pm-design-*). ' +
      'Your token cannot create repositories. Reconnect in Integrations using OAuth or a classic PAT with the "repo" scope.'
    );
  }
  throw new Error(msg);
}

async function ghFetch(url, options = {}) {
  const res = await fetch(url, { ...options, headers: { ...headers(), ...options.headers } });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw formatGithubError(err, res.status);
  }
  return res.json();
}

async function ghFetchAllow404(url) {
  const res = await fetch(url, { headers: headers() });
  if (res.status === 404) return null;
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw formatGithubError(err, res.status);
  }
  return res.json();
}

function branchQuery(branch) {
  return branch ? `?ref=${encodeURIComponent(branch)}` : '';
}

/** Deterministic repo name — one isolated repo per design project/chat. */
export function projectRepoName(projectId) {
  const slug = projectId.replace(/-/g, '').toLowerCase();
  return `${REPO_PREFIX}${slug}`;
}

export async function getGithubUser() {
  return ghFetch(`${API}/user`);
}

export async function inspectGithubToken(token) {
  const res = await fetch(`${API}/user`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Invalid GitHub token');
  }

  const user = await res.json();
  const scopes = (res.headers.get('x-oauth-scopes') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const isFineGrained = Boolean(res.headers.get('github-authentication-token-expiration'))
    || isFineGrainedToken(token);

  const canCreateDedicated = scopes.includes('repo') || scopes.includes('public_repo');
  const selectedRepo = getSelectedRepo();

  return {
    username: user.login,
    scopes,
    isFineGrained,
    canCreateDedicated: isFineGrained ? null : canCreateDedicated,
    hasSelectedRepo: Boolean(selectedRepo?.owner && selectedRepo?.repo),
    selectedRepo: selectedRepo?.fullName || null,
    designSaveHint: isFineGrained
      ? 'Design Agent creates a separate pm-design-* repo per project. Fine-grained PATs cannot do that — use OAuth or a classic PAT with "repo" scope in Integrations.'
      : canCreateDedicated
        ? 'Each design is saved to its own private pm-design-* repository on your GitHub account.'
        : 'Design Agent needs OAuth or a classic PAT with "repo" scope to create pm-design-* repos.',
  };
}

async function getFileSha(owner, repo, path, branch = null) {
  const data = await ghFetchAllow404(
    `${API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}${branchQuery(branch)}`
  );
  return data?.sha || null;
}

async function putFile(owner, repo, path, content, message, sha = null, branch = null) {
  const body = {
    message,
    content: Buffer.from(content, 'utf-8').toString('base64'),
  };
  if (sha) body.sha = sha;
  if (branch) body.branch = branch;

  return ghFetch(
    `${API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`,
    { method: 'PUT', body: JSON.stringify(body) }
  );
}

async function getFileContent(owner, repo, path, branch = null) {
  const data = await ghFetch(
    `${API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}${branchQuery(branch)}`
  );
  return Buffer.from(data.content, 'base64').toString('utf-8');
}

async function createDedicatedRepo(projectId, name) {
  const user = await getGithubUser();
  const owner = user.login;
  const repo = projectRepoName(projectId);

  const existing = await ghFetchAllow404(`${API}/repos/${owner}/${repo}`);
  if (existing) return { owner, repo, mode: 'dedicated', basePath: '' };

  const payload = {
    name: repo,
    description: `Design Agent project: ${name.slice(0, 120)}`,
    private: true,
    auto_init: false,
  };

  try {
    await ghFetch(`${API}/user/repos`, { method: 'POST', body: JSON.stringify(payload) });
  } catch (err) {
    if (!isPermissionError(err.message)) throw err;
    await ghFetch(`${API}/user/repos`, {
      method: 'POST',
      body: JSON.stringify({ ...payload, private: false }),
    });
  }

  return { owner, repo, mode: 'dedicated', basePath: '' };
}

/** Legacy read path only — new designs never write into the linked PM repo. */
function legacyNestedStorage(projectId) {
  const selected = getSelectedRepo();
  if (!selected?.owner || !selected?.repo) return null;
  return {
    owner: selected.owner,
    repo: selected.repo,
    branch: getDesignStorageBranch(),
    mode: 'nested',
    basePath: `${NESTED_ROOT}/${projectId}`,
  };
}

async function resolveProjectStorage(projectId, name, isNew, manifest = null, { forSave = false } = {}) {
  if (!forSave && manifest?.storage === 'nested') {
    const nested = legacyNestedStorage(projectId);
    if (!nested) throw new Error('Legacy nested project — linked repository no longer selected.');
    return nested;
  }

  if (forSave) {
    const user = await getGithubUser();
    if (!isNew && manifest?.storage === 'dedicated') {
      const repo = manifest.githubRepo || projectRepoName(projectId);
      const exists = await ghFetchAllow404(`${API}/repos/${user.login}/${repo}`);
      if (exists) {
        return { owner: user.login, repo, mode: 'dedicated', basePath: '' };
      }
    }
    const repo = projectRepoName(projectId);
    const exists = await ghFetchAllow404(`${API}/repos/${user.login}/${repo}`);
    if (exists) {
      return { owner: user.login, repo, mode: 'dedicated', basePath: '' };
    }
    return createDedicatedRepo(projectId, name);
  }

  if (manifest?.storage === 'dedicated' || (manifest && !isNew)) {
    const user = await getGithubUser();
    return {
      owner: user.login,
      repo: manifest.githubRepo || projectRepoName(projectId),
      mode: 'dedicated',
      basePath: '',
    };
  }

  if (!isNew) {
    const user = await getGithubUser();
    const repo = projectRepoName(projectId);
    const exists = await ghFetchAllow404(`${API}/repos/${user.login}/${repo}`);
    if (exists) {
      return { owner: user.login, repo, mode: 'dedicated', basePath: '' };
    }
    throw new Error('Project not found on GitHub');
  }

  return createDedicatedRepo(projectId, name);
}

async function listDedicatedProjects() {
  try {
    const user = await getGithubUser();
    const owner = user.login;
    const repos = [];
    let page = 1;

    while (true) {
      const batch = await ghFetch(
        `${API}/user/repos?per_page=100&page=${page}&sort=updated&direction=desc`
      );
      if (!batch.length) break;
      repos.push(...batch.filter((r) => r.name.startsWith(REPO_PREFIX)));
      if (batch.length < 100) break;
      page += 1;
    }

    const projects = [];
    for (const repo of repos) {
      try {
        const manifest = JSON.parse(await getFileContent(owner, repo.name, 'manifest.json'));
        const latest = manifest.versions?.[manifest.versions.length - 1];
        projects.push({
          id: manifest.id,
          name: manifest.name,
          prompt: manifest.prompt,
          createdAt: manifest.createdAt,
          latestVersion: manifest.versions?.length || 0,
          updatedAt: latest?.createdAt || manifest.createdAt,
          status: 'done',
          githubRepo: repo.name,
          repoUrl: repo.html_url || `https://github.com/${owner}/${repo.name}`,
          storage: 'dedicated',
        });
      } catch {
        // skip
      }
    }
    return projects;
  } catch (err) {
    console.warn('[Design] Dedicated project list unavailable:', err.message);
    return [];
  }
}

export async function listDesignProjects() {
  return listDedicatedProjects();
}

export async function getProjectManifest(projectId) {
  const storage = await resolveProjectStorage(projectId, '', false);
  const manifestPath = storage.basePath
    ? `${storage.basePath}/manifest.json`
    : 'manifest.json';
  const raw = await getFileContent(storage.owner, storage.repo, manifestPath, storage.branch || null);
  return JSON.parse(raw);
}

export async function getVersionCode(projectId, version) {
  const storage = await resolveProjectStorage(projectId, '', false);
  const path = storage.basePath
    ? `${storage.basePath}/v${version}/App.jsx`
    : `v${version}/App.jsx`;
  return getFileContent(storage.owner, storage.repo, path, storage.branch || null);
}

export async function saveDesignVersion({
  projectId,
  name,
  prompt,
  iterationPrompt,
  reactCode,
  files = null,
  createdAt,
  isNew,
}) {
  let manifest = null;
  if (!isNew) {
    try {
      manifest = await getProjectManifest(projectId);
    } catch {
      manifest = null;
    }
  }

  const storage = await resolveProjectStorage(projectId, name, isNew, manifest, { forSave: true });
  const { owner, repo } = storage;
  const pathPrefix = '';

  if (isNew || !manifest) {
    manifest = {
      id: projectId,
      name,
      prompt: prompt || iterationPrompt,
      createdAt: createdAt || Date.now(),
      githubRepo: repo,
      storage: 'dedicated',
      versions: [],
    };
  }

  const versionNum = manifest.versions.length + 1;
  manifest.versions.push({
    v: versionNum,
    prompt: iterationPrompt || prompt,
    createdAt: Date.now(),
    label: versionNum === 1 ? 'Initial' : `Version ${versionNum}`,
  });
  manifest.updatedAt = Date.now();

  const versionPath = `${pathPrefix}v${versionNum}/App.jsx`;
  const manifestPath = `${pathPrefix}manifest.json`;

  await putFile(owner, repo, versionPath, reactCode, `Design v${versionNum}: ${name}`);

  if (files && typeof files === 'object') {
    const fileEntries = Object.entries(files);
    for (let i = 0; i < fileEntries.length; i += 3) {
      const batch = fileEntries.slice(i, i + 3);
      await Promise.all(
        batch.map(([filePath, fileContent]) => {
          const githubPath = `${pathPrefix}v${versionNum}/${filePath}`;
          return putFile(owner, repo, githubPath, fileContent, `v${versionNum}: ${filePath}`);
        })
      );
    }
  }

  const manifestSha = await getFileSha(owner, repo, manifestPath);
  await putFile(
    owner,
    repo,
    manifestPath,
    JSON.stringify(manifest, null, 2),
    `Update manifest — v${versionNum}`,
    manifestSha
  );

  const repoUrl = `https://github.com/${owner}/${repo}`;

  return {
    owner,
    repo,
    githubRepo: repo,
    storage: 'dedicated',
    version: versionNum,
    manifest,
    repoUrl,
    filePath: versionPath,
  };
}

export async function saveProjectFiles(projectId, files, version) {
  if (!files || typeof files !== 'object') {
    throw new Error('files required');
  }

  const manifest = await getProjectManifest(projectId);
  const storage = await resolveProjectStorage(projectId, manifest.name, false, manifest);
  const { owner, repo } = storage;
  const versionNum = version || manifest.versions?.length || 1;
  const entries = Object.entries(files);

  for (let i = 0; i < entries.length; i += 3) {
    const batch = entries.slice(i, i + 3);
    await Promise.all(
      batch.map(([filePath, content]) =>
        putFile(owner, repo, `v${versionNum}/${filePath}`, content, `v${versionNum}: ${filePath}`)
          .catch(() => {})
      )
    );
  }

  return { saved: entries.length, version: versionNum };
}

export async function loadFullProject(projectId) {
  const manifest = await getProjectManifest(projectId);
  const latest = manifest.versions[manifest.versions.length - 1];
  const code = latest ? await getVersionCode(projectId, latest.v) : '';
  const storage = await resolveProjectStorage(projectId, manifest.name, false, manifest);

  return {
    id: manifest.id,
    name: manifest.name,
    prompt: manifest.prompt,
    code,
    status: 'done',
    createdAt: manifest.createdAt,
    iterations: manifest.versions.length,
    versions: manifest.versions,
    activeVersion: latest?.v || 1,
    githubRepo: manifest.githubRepo,
    storage: manifest.storage,
    repoUrl: `https://github.com/${storage.owner}/${storage.repo}`,
    messages: [],
  };
}
