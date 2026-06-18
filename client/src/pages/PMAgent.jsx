import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import CallScreenOverlay from '../components/CallScreenOverlay';
import GenerationLoader from '../components/GenerationLoader';
import JiraBacklog from '../components/JiraBacklog';
import { useAgent } from '../context/AgentContext';
import { primeAudioOutput } from '../hooks/useRealtimeVoice';

function withStorySkeleton(epic, stillGenerating) {
  const stories = [...(epic.stories || [])];
  if (stillGenerating) {
    stories.push({ title: 'Generating stories…', _loading: true, subtasks: [] });
  }
  return { ...epic, stories };
}

export default function PMAgent() {
  const agent = useAgent();
  const [activePrompt, setActivePrompt] = useState(null);
  const [databaseMode, setDatabaseMode] = useState(null);
  const [githubStatus, setGithubStatus] = useState(null);
  const [selectedRepo, setSelectedRepo] = useState(null);

  const [agentReady, setAgentReady] = useState(false);
  const [showCallOverlay, setShowCallOverlay] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [repoStats, setRepoStats] = useState(null);
  const [promptUsed, setPromptUsed] = useState(null);

  const [generating, setGenerating] = useState(false);
  const [generationPhase, setGenerationPhase] = useState('scope');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [partialResult, setPartialResult] = useState(null);
  const [callStarting, setCallStarting] = useState(false);
  const [callTranscript, setCallTranscript] = useState([]);

  async function handleStartCallClick() {
    setCallStarting(true);
    setError('');
    try {
      await primeAudioOutput();
      setShowCallOverlay(true);
    } catch (err) {
      setError(err.message || 'Could not enable audio output. Try again.');
    } finally {
      setCallStarting(false);
    }
  }

  const resultsRef = useRef(null);
  const userConfirmedRef = useRef(false);
  const generatingRef = useRef(false);

  useEffect(() => {
    generatingRef.current = generating;
  }, [generating]);

  useEffect(() => {
    Promise.all([api.dashboard(), api.github.status()])
      .then(([dash, gh]) => {
        setActivePrompt(dash.activePrompt);
        setDatabaseMode(dash.database);
        setGithubStatus(gh);
        setSelectedRepo(gh.selectedRepo || null);
        setAgentReady(true);
      })
      .catch(() => setAgentReady(true));
  }, []);

  const handleStartCall = useCallback(async () => {
    if (!selectedRepo?.repoUrl || !selectedRepo?.branch) {
      throw new Error('No repository selected');
    }

    setError('');
    setResult(null);
    setPartialResult(null);
    userConfirmedRef.current = false;

    const data = await api.chat.start(selectedRepo.repoUrl, selectedRepo.branch, true);
    setSessionId(data.sessionId);
    setRepoStats(data.repo);
    setPromptUsed(data.prompt_used?.name);
    return data;
  }, [selectedRepo]);

  const runGeneration = useCallback(async () => {
    if (!sessionId || !userConfirmedRef.current) return;

    setGenerating(true);
    setGenerationPhase('scope');
    setError('');
    setResult(null);
    setPartialResult({ epics: [], assumptions: [], summary: '' });
    agent?.setStatus('processing');

    try {
      let finalResult = null;
      let streamError = null;

      await api.chat.generateStream(sessionId, (event) => {
        if (event.type === 'phase') {
          setGenerationPhase(event.phase);
        }
        if (event.type === 'scope' && event.repo) {
          setRepoStats((prev) => ({ ...prev, ...event.repo, indexMode: false }));
        }
        if (event.type === 'epic' && event.epic) {
          setPartialResult({
            epics: [withStorySkeleton(event.epic, true)],
            assumptions: [],
            summary: '',
          });
        }
        if (event.type === 'story' && event.epic) {
          setPartialResult({
            epics: [withStorySkeleton(event.epic, generatingRef.current)],
            assumptions: [],
            summary: '',
          });
        }
        if (event.type === 'complete' && event.result) {
          finalResult = event.result;
          setResult(event.result);
          setPartialResult(event.result);
        }
        if (event.type === 'error') {
          streamError = new Error(event.error);
        }
      }, true);

      if (streamError) throw streamError;

      if (!finalResult?.epics?.length) {
        throw new Error('Generation finished but no tickets were produced.');
      }

      agent?.setStatus('ready');
      setTimeout(() => {
        resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    } catch (err) {
      agent?.setStatus('error');
      setError(err.message || 'Failed to generate Jira tickets');
    } finally {
      setGenerating(false);
    }
  }, [sessionId, agent]);

  const handleConfirmedGenerate = useCallback(async (transcript) => {
    userConfirmedRef.current = true;
    setShowCallOverlay(false);
    if (transcript?.length) setCallTranscript(transcript);
    await runGeneration();
  }, [runGeneration]);

  const canStart = selectedRepo?.repoUrl && selectedRepo?.branch && activePrompt && githubStatus?.connected;
  const userLabel = githubStatus?.username ? `@${githubStatus.username}` : 'You';
  const displayResult = result || (generating ? partialResult : null);
  const showBacklog = generating || (displayResult?.epics?.length > 0);

  return (
    <div className="pm-agent-page">
      <h2 className="page-title">PM Agent</h2>
      <p className="page-subtitle">
        Start a fullscreen call with Sarah to scope your feature. When you end the call,
        you choose whether to generate Jira tickets — nothing is created automatically.
      </p>

      {!githubStatus?.connected && (
        <div className="github-token-warning">
          <strong>GitHub not connected.</strong>{' '}
          <Link to="/integrations">Connect GitHub in Integrations</Link> first.
        </div>
      )}

      {githubStatus?.connected && !selectedRepo && (
        <div className="github-token-warning">
          <strong>No repo selected.</strong>{' '}
          <Link to="/integrations">Select a repository and branch in Integrations</Link>.
        </div>
      )}

      {activePrompt ? (
        <div className="prompt-active-banner">
          Active PM Prompt: <strong>{activePrompt}</strong>
          {databaseMode && (
            <span className="db-mode-tag">
              Storage: {databaseMode === 'postgres' ? 'PostgreSQL' : 'File-backed'}
            </span>
          )}
        </div>
      ) : (
        <div className="error" style={{ marginBottom: 16 }}>
          No active PM prompt. <Link to="/prompts">Create and activate one</Link> first.
        </div>
      )}

      <div className="card">
        {selectedRepo ? (
          <div className="repo-selection-display">
            <div>
              <div className="jira-field-label">Connected Repository</div>
              <div className="repo-selection-name">
                {selectedRepo.fullName} @ <strong>{selectedRepo.branch}</strong>
              </div>
            </div>
            <Link to="/integrations" className="btn btn-secondary">Change</Link>
          </div>
        ) : (
          <p className="hint">No repository selected. <Link to="/integrations">Go to Integrations</Link></p>
        )}

        {repoStats && (
          <p className="hint" style={{ marginTop: 12 }}>
            {repoStats.indexMode
              ? `Indexed ${repoStats.totalFiles} files — scope narrows to your feature at generation`
              : repoStats.filesAnalyzed
                ? `Analyzed ${repoStats.filesAnalyzed} scoped files (${repoStats.scopedPaths || 0} connected) of ${repoStats.totalFiles} total`
                : null}
            {repoStats.featureSummary && (
              <span> — {repoStats.featureSummary}</span>
            )}
          </p>
        )}
      </div>

      <div className="card">
        <p className="hint" style={{ marginBottom: 16 }}>
          {agentReady
            ? 'Sarah is ready. Your call opens fullscreen — audio and captions stream in realtime.'
            : 'Preparing Sarah…'}
        </p>
        <button
          type="button"
          className="btn btn-call-start"
          onClick={handleStartCallClick}
          disabled={!canStart || !agentReady || generating || callStarting}
        >
          {callStarting ? 'Enabling audio…' : agentReady ? 'Start call with Sarah' : 'Preparing…'}
        </button>
      </div>

      <CallScreenOverlay
        open={showCallOverlay}
        sessionId={sessionId}
        userLabel={userLabel}
        agentReady={agentReady}
        disabled={!canStart}
        onStartCall={handleStartCall}
        onEndCallConfirm={setCallTranscript}
        onResume={() => {}}
        onGenerate={handleConfirmedGenerate}
        onDiscard={() => {
          setShowCallOverlay(false);
          userConfirmedRef.current = false;
        }}
      />

      {generating && (
        <div className="card">
          <GenerationLoader
            phase={generationPhase}
            message="Tickets appear in the backlog as they are written — epics first, then stories and subtasks."
          />
        </div>
      )}

      {error && (
        <div className="card">
          <div className="error">{error}</div>
          {sessionId && userConfirmedRef.current && !generating && (
            <button
              type="button"
              className="btn btn-primary"
              style={{ marginTop: 12 }}
              onClick={runGeneration}
            >
              Retry ticket generation
            </button>
          )}
        </div>
      )}

      {showBacklog && (
        <div className="pm-backlog-section" ref={resultsRef}>
          {promptUsed && !generating && (
            <p className="prompt-used-label">Using PM Prompt: <strong>{promptUsed}</strong></p>
          )}
          <JiraBacklog result={displayResult} generating={generating} />
        </div>
      )}

      {callTranscript.length > 0 && !showCallOverlay && !generating && (
        <details className="card call-transcript-card">
          <summary>Call transcript</summary>
          <div className="transcript-lines">
            {callTranscript.map((line, i) => (
              <div key={i} className={`transcript-line transcript-${line.role}`}>
                <span className="transcript-role">{line.role === 'user' ? 'You' : 'Sarah'}</span>
                {line.text}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
