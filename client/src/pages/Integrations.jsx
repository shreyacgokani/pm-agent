import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';

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
  const [showPat, setShowPat] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const connectedParam = searchParams.get('connected');
  const errorParam = searchParams.get('error');

  useEffect(() => {
    if (connectedParam) {
      setSuccess('GitHub connected successfully!');
      setSearchParams({}, { replace: true });
    }
    if (errorParam) {
      setError(decodeURIComponent(errorParam));
      setSearchParams({}, { replace: true });
    }
  }, [connectedParam, errorParam, setSearchParams]);

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
    setError('');
    try {
      await api.github.connectPat(pat);
      setPat('');
      setShowPat(false);
      setSuccess('GitHub connected with personal access token.');
      await loadStatus();
    } catch (err) {
      setError(err.message);
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

  if (loading) return <div className="loading">Loading integrations...</div>;

  return (
    <div>
      <h2 className="page-title">Integrations</h2>
      <p className="page-subtitle">
        Connect GitHub to browse your repos, select a branch, and use it in PM Agent without hitting rate limits.
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
                  via {status.method === 'oauth' ? 'OAuth' : status.method === 'pat' ? 'Personal Access Token' : 'server config'}
                </div>
              </div>
            </div>
            <button type="button" className="btn btn-secondary" onClick={handleDisconnect}>
              Disconnect
            </button>
          </div>
        ) : (
          <div className="integration-connect">
            {status?.oauthConfigured ? (
              <button type="button" className="btn btn-primary" onClick={handleOAuthConnect}>
                Connect with GitHub
              </button>
            ) : (
              <p className="hint">
                OAuth not configured on server. Use a Personal Access Token below, or set{' '}
                <code>GITHUB_CLIENT_ID</code> and <code>GITHUB_CLIENT_SECRET</code> in server/.env.
              </p>
            )}

            {!showPat ? (
              <button type="button" className="btn btn-secondary" onClick={() => setShowPat(true)}>
                Connect with Token
              </button>
            ) : (
              <form className="pat-form" onSubmit={handlePatConnect}>
                <input
                  type="password"
                  placeholder="ghp_..."
                  value={pat}
                  onChange={(e) => setPat(e.target.value)}
                  required
                />
                <button type="submit" className="btn btn-primary">Connect</button>
                <button type="button" className="btn btn-secondary" onClick={() => setShowPat(false)}>
                  Cancel
                </button>
              </form>
            )}
          </div>
        )}
      </div>

      {status?.connected && (
        <div className="card">
          <h3>Select Repository & Branch</h3>
          <p className="hint">This selection is used by PM Agent when you start a session.</p>

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

      {status?.oauthConfigured === false && !status?.connected && (
        <div className="card">
          <h3>Setup GitHub OAuth (optional)</h3>
          <ol className="setup-steps">
            <li>Go to <a href="https://github.com/settings/developers" target="_blank" rel="noreferrer">GitHub Developer Settings</a></li>
            <li>Create a new <strong>OAuth App</strong></li>
            <li>Homepage URL: <code>http://localhost:3000</code></li>
            <li>Callback URL: <code>http://localhost:5001/api/github/callback</code></li>
            <li>Copy Client ID and Secret to <code>server/.env</code></li>
            <li>Restart the server</li>
          </ol>
        </div>
      )}
    </div>
  );
}
