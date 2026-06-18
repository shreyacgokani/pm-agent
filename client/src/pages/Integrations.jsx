import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';

const CLASSIC_TOKEN_URL =
  'https://github.com/settings/tokens/new?scopes=repo,read:user&description=PM+Agent';

function GitHubMark() {
  return (
    <svg className="github-mark" viewBox="0 0 16 16" width="20" height="20" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
      />
    </svg>
  );
}

export default function Integrations() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState(null);
  const [repos, setRepos] = useState([]);
  const [branches, setBranches] = useState([]);
  const [selectedOwner, setSelectedOwner] = useState('');
  const [selectedRepo, setSelectedRepo] = useState('');
  const [selectedBranch, setSelectedBranch] = useState('');
  const [repoSearch, setRepoSearch] = useState('');
  const [pat, setPat] = useState('');
  const [connectingPat, setConnectingPat] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [designCaps, setDesignCaps] = useState(null);

  const connectedParam = searchParams.get('connected');
  const errorParam = searchParams.get('error');
  const oauthHintParam = searchParams.get('oauth_hint');

  useEffect(() => {
    if (connectedParam) {
      setSuccess('GitHub connected successfully!');
      setSearchParams({}, { replace: true });
    }
    if (errorParam) {
      setError(decodeURIComponent(errorParam));
      setSearchParams({}, { replace: true });
    }
    if (oauthHintParam === 'local') {
      setSearchParams({}, { replace: true });
    }
  }, [connectedParam, errorParam, oauthHintParam, setSearchParams]);

  async function loadStatus() {
    setLoading(true);
    try {
      const data = await api.github.status();
      setStatus(data);

      if (data.selectedRepo) {
        setSelectedOwner(data.selectedRepo.owner);
        setSelectedRepo(data.selectedRepo.repo);
        setSelectedBranch(data.selectedRepo.branch);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStatus();
  }, []);

  useEffect(() => {
    if (!status?.connected) {
      setDesignCaps(null);
      return;
    }
    api.github.capabilities()
      .then((data) => setDesignCaps(data.design))
      .catch(() => setDesignCaps(null));
  }, [status?.connected]);

  useEffect(() => {
    if (!status?.connected) return;

    setLoadingRepos(true);
    api.github.repos()
      .then(setRepos)
      .catch((err) => setError(err.message))
      .finally(() => setLoadingRepos(false));
  }, [status?.connected]);

  useEffect(() => {
    if (!selectedOwner || !selectedRepo) {
      setBranches([]);
      return;
    }

    setLoadingBranches(true);
    api.github.repoBranches(selectedOwner, selectedRepo)
      .then((data) => {
        setBranches(data.branches);
        if (!selectedBranch || !data.branches.some((b) => b.name === selectedBranch)) {
          setSelectedBranch(data.selectedBranch);
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoadingBranches(false));
  }, [selectedOwner, selectedRepo]);

  function handleOAuthConnect() {
    window.location.href = '/api/github/auth/login';
  }

  async function handlePatConnect(e) {
    e.preventDefault();
    if (!pat.trim()) return;
    setConnectingPat(true);
    setError('');
    try {
      const result = await api.github.connectPat(pat.trim());
      setPat('');
      setSuccess(
        result.designAgentLimited
          ? 'Connected with fine-grained token — PM Agent is ready. For Design Agent saves, use a classic token with repo scope (link below).'
          : 'GitHub connected with personal access token.'
      );
      await loadStatus();
    } catch (err) {
      setError(err.message);
    } finally {
      setConnectingPat(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm('Disconnect GitHub?')) return;
    setError('');
    try {
      await api.github.disconnect();
      setRepos([]);
      setBranches([]);
      setSelectedOwner('');
      setSelectedRepo('');
      setSelectedBranch('');
      setSuccess('GitHub disconnected.');
      await loadStatus();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleSaveSelection(e) {
    e.preventDefault();
    if (!selectedOwner || !selectedRepo || !selectedBranch) return;

    setSaving(true);
    setError('');
    try {
      const saved = await api.github.saveSelection(selectedOwner, selectedRepo, selectedBranch);
      setSuccess(`Saved ${saved.fullName} @ ${saved.branch}`);
      await loadStatus();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function handleRepoChange(fullName) {
    const repo = repos.find((r) => r.fullName === fullName);
    if (!repo) return;
    setSelectedOwner(repo.owner);
    setSelectedRepo(repo.name);
    setSelectedBranch(repo.defaultBranch);
  }

  const filteredRepos = repos.filter((r) => {
    const q = repoSearch.toLowerCase();
    return (
      r.fullName.toLowerCase().includes(q) ||
      (r.description || '').toLowerCase().includes(q)
    );
  });

  const selectedFullName = selectedOwner && selectedRepo ? `${selectedOwner}/${selectedRepo}` : '';
  const showTokenConnect = !status?.connected;
  const oauthReady = status?.oauthConfigured;

  if (loading) return <div className="loading">Loading integrations...</div>;

  return (
    <div>
      <h2 className="page-title">Integrations</h2>
      <p className="page-subtitle">
        Sign in with GitHub to browse repos, run PM Agent on your code, and save Design Agent projects to dedicated repositories.
      </p>

      {success && <div className="prompt-active-banner">{success}</div>}
      {error && <div className="error">{error}</div>}

      <div className="card integration-card">
        <div className="integration-header">
          <div className="integration-icon">GitHub</div>
          <div>
            <h3>GitHub</h3>
            <p className="hint">Authenticate to list repos and analyze code with higher API limits.</p>
          </div>
        </div>

        {status?.connected ? (
          <div className="integration-connected-block">
            <div className="integration-connected">
              <div className="connected-user">
                {status.avatarUrl && (
                  <img src={status.avatarUrl} alt="" className="github-avatar" />
                )}
                <div>
                  <strong>
                    Connected{status.username ? ` as @${status.username}` : ''}
                  </strong>
                  <div className="hint">
                    via {status.method === 'oauth' ? 'GitHub sign-in' : status.method === 'pat' ? 'Personal Access Token' : 'server config'}
                  </div>
                </div>
              </div>
              <div className="integration-connected-actions">
                {status.recommendLogin && (
                  <button type="button" className="github-signin-btn" onClick={handleOAuthConnect}>
                    <GitHubMark /> Connect with GitHub
                  </button>
                )}
                <button type="button" className="btn btn-secondary" onClick={handleDisconnect}>
                  Disconnect
                </button>
              </div>
            </div>

            {status.recommendLogin && status.isFineGrained && (
              <div className="permissions-banner">
                Fine-grained token connected — PM Agent works on repos your token can access.
                Design Agent needs a <a href={CLASSIC_TOKEN_URL} target="_blank" rel="noreferrer">classic token with repo scope</a> to create design repos.
              </div>
            )}

            {status.recommendLogin && !status.isFineGrained && (
              <div className="permissions-banner">
                Reconnect with a classic token (repo scope) or GitHub sign-in for full Design Agent access.
              </div>
            )}

            {status.allGranted && (
              <p className="hint">GitHub permissions are active for PM Agent and Design Agent.</p>
            )}
          </div>
        ) : (
          <div className="integration-connect">
            <div className="github-login-panel">
              <button type="button" className="github-signin-btn" onClick={handleOAuthConnect}>
                <GitHubMark />
                Connect with GitHub
              </button>
              <p className="hint github-login-hint">
                {oauthReady
                  ? 'Redirects to GitHub to authorize repository access for PM Agent and Design Agent.'
                  : status?.localDev
                    ? 'GitHub sign-in needs a public OAuth app (not available on localhost). Use a personal access token below — recommended for local development.'
                    : 'Redirects to GitHub to authorize repository access. If sign-in fails, use a personal access token below.'}
              </p>
            </div>

            {showTokenConnect && (
              <>
                <div className="connect-divider">
                  <span>or</span>
                </div>

                <div className="token-connect-card">
                  <h4>Connect with a personal access token</h4>
                  <ol className="token-steps">
                    <li>
                      <strong>Fine-grained token</strong> (<code>github_pat_…</code>) — paste below.
                      Works for <strong>PM Agent</strong> on repos your token can access.
                    </li>
                    <li>
                      <strong>Classic token</strong> (<code>ghp_…</code>) — needed for <strong>Design Agent</strong> to create <code>pm-design-*</code> repos.{' '}
                      <a href={CLASSIC_TOKEN_URL} target="_blank" rel="noreferrer">
                        Generate classic token with repo scope →
                      </a>
                    </li>
                    <li>Paste your token and click Connect.</li>
                  </ol>
                  <form className="pat-form" onSubmit={handlePatConnect}>
                    <div className="pat-form-row">
                      <input
                        type="password"
                        placeholder="github_pat_… or ghp_…"
                        value={pat}
                        onChange={(e) => setPat(e.target.value)}
                        autoComplete="off"
                        required
                      />
                      <button
                        type="submit"
                        className="btn btn-primary"
                        disabled={connectingPat || !pat.trim()}
                      >
                        {connectingPat ? 'Connecting…' : 'Connect token'}
                      </button>
                    </div>
                  </form>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {status?.connected && designCaps && !status.allGranted && (
        <div className="card design-caps-card">
          <h3>Design Agent — GitHub storage</h3>
          <p className="hint">{designCaps.designSaveHint}</p>
        </div>
      )}

      {status?.connected && (
        <div className="card">
          <h3>Select Repository & Branch</h3>
          <p className="hint">Used by PM Agent when you start a session. Design Agent saves to separate pm-design-* repos.</p>

          <form onSubmit={handleSaveSelection}>
            <div className="form-group">
              <label>Search repositories</label>
              <input
                type="text"
                placeholder="Search by name..."
                value={repoSearch}
                onChange={(e) => setRepoSearch(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label>Repository</label>
              {loadingRepos ? (
                <p className="hint">Loading your repositories...</p>
              ) : (
                <select
                  value={selectedFullName}
                  onChange={(e) => handleRepoChange(e.target.value)}
                  required
                >
                  <option value="">Select a repository</option>
                  {filteredRepos.map((r) => (
                    <option key={r.fullName} value={r.fullName}>
                      {r.fullName}{r.private ? ' (private)' : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {selectedFullName && (
              <div className="form-group">
                <label>Branch</label>
                {loadingBranches ? (
                  <p className="hint">Loading branches...</p>
                ) : (
                  <select
                    value={selectedBranch}
                    onChange={(e) => setSelectedBranch(e.target.value)}
                    required
                  >
                    {branches.map((b) => (
                      <option key={b.name} value={b.name}>
                        {b.name}{b.protected ? ' (protected)' : ''}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            <button
              type="submit"
              className="btn btn-primary"
              disabled={saving || !selectedFullName || !selectedBranch}
            >
              {saving ? 'Saving...' : 'Save Selection'}
            </button>
          </form>

          {status.selectedRepo && (
            <div className="saved-selection">
              <strong>Current selection:</strong>{' '}
              {status.selectedRepo.fullName} @ {status.selectedRepo.branch}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
