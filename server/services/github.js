import AdmZip from 'adm-zip';
import { getGithubAccessToken } from './githubAuth.js';
import { buildCatalogFromZipEntries, buildIndexSummary } from './repoIndex.js';
import { scopeFilesForConversation, loadScopedFileContents } from './repoScope.js';

function getHeaders() {
  const headers = { Accept: 'application/vnd.github+json' };
  const token = getGithubAccessToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export function isGithubTokenConfigured() {
  return Boolean(getGithubAccessToken());
}

async function parseGithubError(res) {
  const err = await res.json().catch(() => ({}));
  const message = err.message || `GitHub API error (${res.status})`;

  if (res.status === 403 && /rate limit/i.test(message)) {
    return new Error(
      'GitHub API rate limit exceeded. Connect GitHub in Integrations to authenticate and get higher limits.'
    );
  }

  return new Error(message);
}

const SKIP_PATTERNS = [
  /node_modules/,
  /\.git\//,
  /^dist\//,
  /^build\//,
  /^coverage\//,
  /^\.next\//,
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /\.(png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|mp4|webm|pdf|zip)$/i,
];

const TEXT_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js', '.md', '.css', '.json', '.sql', '.yml', '.yaml', '.env.example', '.html', '.txt'];

function shouldIncludeFile(path) {
  return !SKIP_PATTERNS.some((pattern) => pattern.test(path));
}

function isTextFile(path) {
  return TEXT_EXTENSIONS.some((ext) => path.endsWith(ext)) || !/\.\w+$/.test(path);
}

export function parseRepoUrl(url) {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)(?:\/(?:tree|blob)\/([^/?#]+))?/);
  if (!match) throw new Error('Invalid GitHub URL. Use format: https://github.com/owner/repo');
  const owner = match[1];
  const repo = match[2].replace(/\.git$/, '');
  const branchFromUrl = match[3] ? decodeURIComponent(match[3]) : null;
  return { owner, repo, branchFromUrl };
}

export async function fetchBranches(repoUrl) {
  const { owner, repo, branchFromUrl } = parseRepoUrl(repoUrl);
  return fetchRepoBranches(owner, repo, branchFromUrl);
}

export async function fetchRepoBranches(owner, repo, preferredBranch = null) {
  const headers = getHeaders();
  const base = `https://api.github.com/repos/${owner}/${repo}`;

  const [repoRes, branchesRes] = await Promise.all([
    fetch(base, { headers }),
    fetch(`${base}/branches?per_page=100`, { headers }),
  ]);

  if (!repoRes.ok) throw await parseGithubError(repoRes);

  const repoData = await repoRes.json();
  const defaultBranch = repoData.default_branch;

  let branches = [];
  if (branchesRes.ok) {
    const branchData = await branchesRes.json();
    branches = branchData.map((b) => ({ name: b.name, protected: b.protected }));
  } else if (branchesRes.status === 403) {
    throw await parseGithubError(branchesRes);
  }

  if (branches.length === 0) {
    branches = [{ name: defaultBranch, protected: false }];
  }

  const branchNames = branches.map((b) => b.name);
  const selectedBranch =
    preferredBranch && branchNames.includes(preferredBranch) ? preferredBranch : defaultBranch;

  return {
    fullName: repoData.full_name,
    owner,
    repo,
    defaultBranch,
    selectedBranch,
    branches,
    repoUrl: `https://github.com/${owner}/${repo}`,
  };
}

export async function fetchUserRepos() {
  const headers = getHeaders();
  if (!headers.Authorization) {
    throw new Error('GitHub not connected. Go to Integrations to connect your account.');
  }

  const repos = [];
  let page = 1;

  while (page <= 5) {
    const res = await fetch(
      `https://api.github.com/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`,
      { headers }
    );
    if (!res.ok) throw await parseGithubError(res);

    const batch = await res.json();
    if (!batch.length) break;

    repos.push(
      ...batch.map((r) => ({
        fullName: r.full_name,
        name: r.name,
        owner: r.owner.login,
        defaultBranch: r.default_branch,
        private: r.private,
        description: r.description || '',
        htmlUrl: r.html_url,
        updatedAt: r.updated_at,
      }))
    );
    page++;
  }

  return repos;
}

export function repoUrlFromParts(owner, repo) {
  return `https://github.com/${owner}/${repo}`;
}

const INDEX_SNIPPET_SIZE = 3500;

async function downloadZipball(owner, repo, ref) {
  const headers = getHeaders();
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/zipball/${encodeURIComponent(ref)}`,
    { headers, redirect: 'follow' }
  );

  if (!res.ok) throw await parseGithubError(res);

  const buffer = Buffer.from(await res.arrayBuffer());
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries().filter((e) => !e.isDirectory);

  return entries
    .map((entry) => {
      const path = entry.entryName.split('/').slice(1).join('/');
      return { path, entry };
    })
    .filter(({ path }) => path && shouldIncludeFile(path) && isTextFile(path));
}

function buildIndexEntries(zipEntries) {
  const indexEntries = [];
  let readme = '';
  let readmePath = null;

  for (const { path, entry } of zipEntries) {
    try {
      const raw = entry.getData().toString('utf8');
      if (raw.includes('\ufffd')) continue;

      if (/^readme\.md$/i.test(path.split('/').pop())) {
        readme = raw.slice(0, 8000);
        readmePath = path;
      }

      indexEntries.push({
        path,
        snippet: raw.slice(0, INDEX_SNIPPET_SIZE),
      });
    } catch {
      // skip
    }
  }

  return { indexEntries, readme, readmePath };
}

async function fetchRepoMeta(owner, repo, ref) {
  const headers = getHeaders();
  const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
  if (!repoRes.ok) throw await parseGithubError(repoRes);
  const repoData = await repoRes.json();
  return {
    name: repoData.name,
    fullName: repoData.full_name,
    branch: ref || repoData.default_branch,
    description: repoData.description || '',
    language: repoData.language || 'unknown',
    topics: repoData.topics || [],
  };
}

/** Fast index pass — like Figma/Dev Mode: map structure + imports, no full file dump to LLM */
export async function fetchRepoIndex(repoUrl, branch) {
  const { owner, repo } = parseRepoUrl(repoUrl);
  const meta = await fetchRepoMeta(owner, repo, branch);
  const zipEntries = await downloadZipball(owner, repo, meta.branch);
  const fileTree = zipEntries.map((e) => e.path).sort();
  const { indexEntries, readme, readmePath } = buildIndexEntries(zipEntries);
  const { catalog, graph, pathSet } = buildCatalogFromZipEntries(indexEntries);

  return {
    ...meta,
    readme,
    readmePath,
    fileTree,
    catalog,
    graph,
    pathSet,
    totalFiles: fileTree.length,
    indexMode: true,
  };
}

/** Scoped load — only files connected to the feature discussed on the call */
export async function fetchScopedRepoContext(repoUrl, branch, messages, pmPrompt = '') {
  const { owner, repo } = parseRepoUrl(repoUrl);
  const meta = await fetchRepoMeta(owner, repo, branch);
  const zipEntries = await downloadZipball(owner, repo, meta.branch);
  const fileTree = zipEntries.map((e) => e.path).sort();
  const { indexEntries, readme, readmePath } = buildIndexEntries(zipEntries);
  const repoIndex = {
    ...meta,
    readme,
    readmePath,
    fileTree,
    ...buildCatalogFromZipEntries(indexEntries),
    totalFiles: fileTree.length,
  };

  const scope = await scopeFilesForConversation(repoIndex, messages, pmPrompt);
  const { files, totalChars } = loadScopedFileContents(zipEntries, scope.paths);

  return {
    ...meta,
    readme,
    fileTree,
    files,
    filesAnalyzed: files.length,
    totalFiles: fileTree.length,
    scopedPaths: scope.paths,
    seedCount: scope.seedCount,
    featureSummary: scope.featureSummary,
    scopeChars: totalChars,
    indexMode: false,
  };
}

/** @deprecated use fetchRepoIndex or fetchScopedRepoContext */
export async function fetchRepoContext(repoUrl, branch, { forGeneration = false } = {}) {
  if (forGeneration) {
    return fetchScopedRepoContext(repoUrl, branch, [
      { role: 'user', content: 'Generate tickets for the full codebase.' },
    ]);
  }
  const index = await fetchRepoIndex(repoUrl, branch);
  return {
    ...index,
    files: [],
    filesAnalyzed: 0,
  };
}

export function formatRepoForAI(repoContext) {
  const fileContents = repoContext.files
    .map((f) => `--- FILE: ${f.path} ---\n${f.content}`)
    .join('\n\n');

  const scopeNote = repoContext.featureSummary
    ? `Feature scope: ${repoContext.featureSummary}\nScoped files (${repoContext.filesAnalyzed}): ${(repoContext.scopedPaths || []).join(', ')}`
    : `Files analyzed: ${repoContext.filesAnalyzed}`;

  return `Repository: ${repoContext.fullName}
Branch: ${repoContext.branch}
Description: ${repoContext.description || 'none'}
Language: ${repoContext.language}
Topics: ${repoContext.topics.join(', ') || 'none'}
Files in repo: ${repoContext.totalFiles}
${scopeNote}

README:
${repoContext.readme || 'No README'}

Source file contents (scoped to discussed feature):
${fileContents || 'No source files in scope'}`;
}

export function formatRepoSummaryForVoice(repoContext) {
  const structureSummary = repoContext.catalog
    ? buildIndexSummary(repoContext)
    : `Indexed ${repoContext.totalFiles} files.`;

  return `Repository: ${repoContext.fullName}
Branch: ${repoContext.branch}
Description: ${repoContext.description || 'none'}

${structureSummary}

At ticket generation, only files connected to the feature you discuss will be loaded (import graph + relevance search — not the whole repo).

README (internal reference):
${(repoContext.readme || 'No README').slice(0, 2000)}`;
}
