import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAgent } from '../context/AgentContext';
import { SARAH_OPENING_LINE, primeAudioOutput, useRealtimeVoice } from '../hooks/useRealtimeVoice';

function ParticipantTile({ name, initials, role, active, thinking, caption, micOn }) {
  return (
    <div className={`call-participant ${active ? 'speaking' : ''} ${thinking ? 'thinking' : ''}`}>
      <div className="call-participant-frame">
        <div className={`call-participant-avatar call-participant-avatar-${role}`}>
          {initials}
        </div>
        {(active || thinking) && <div className="call-participant-ring" aria-hidden="true" />}
      </div>
      <div className="call-participant-label">
        <span>{name}</span>
        {micOn && <span className="call-mic-on" title="Microphone on">●</span>}
      </div>
      {caption ? (
        <p className="call-participant-caption live-caption">{caption}</p>
      ) : (
        <p className="call-participant-caption call-caption-placeholder">&nbsp;</p>
      )}
    </div>
  );
}

export default function CallScreenOverlay({
  open,
  sessionId,
  userLabel,
  agentReady,
  onStartCall,
  onEndCallConfirm,
  onResume,
  onGenerate,
  onDiscard,
  disabled,
}) {
  const [phase, setPhase] = useState('idle');
  const [error, setError] = useState('');
  const frozenTranscriptRef = useRef([]);
  const startedRef = useRef(false);
  const wasOpenRef = useRef(false);

  const agent = useAgent();
  const voice = useRealtimeVoice(sessionId);
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  useEffect(() => {
    if (!open) {
      startedRef.current = false;
      return undefined;
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  async function handleJoinCall() {
    setError('');
    setPhase('connecting');
    agent?.setStatus('processing');

    try {
      const data = await onStartCall();
      await voiceRef.current.beginCall(data.sessionId);
      setPhase('active');
      agent?.setCallActive(true);
      agent?.setCallStartedAt(Date.now());
      agent?.setStatus('in-call');
    } catch (err) {
      voiceRef.current.endCall();
      setPhase('idle');
      agent?.setCallActive(false);
      agent?.setStatus('error');
      setError(err.message);
    }
  }

  useEffect(() => {
    if (open && phase === 'idle' && agentReady && !disabled && !startedRef.current) {
      startedRef.current = true;
      handleJoinCall();
    }
    if (!open && wasOpenRef.current) {
      voiceRef.current.endCall();
      setPhase('idle');
      agent?.setCallActive(false);
      agent?.setStatus('ready');
      startedRef.current = false;
    }
    wasOpenRef.current = open;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, agentReady, disabled]);

  function handleLeaveCall() {
    frozenTranscriptRef.current = [...voice.transcript];
    voice.pauseCall();
    setPhase('confirm');
    agent?.setCallActive(false);
    agent?.setStatus('ready');
    onEndCallConfirm?.(frozenTranscriptRef.current);
  }

  async function handleResume() {
    try {
      await primeAudioOutput();
      setPhase('active');
      voice.resumeCall();
      agent?.setCallActive(true);
      agent?.setStatus('in-call');
      onResume?.();
    } catch (err) {
      setError(err.message || 'Could not resume audio output.');
    }
  }

  function handleDiscard() {
    voice.endCall();
    setPhase('idle');
    startedRef.current = false;
    agent?.setCallActive(false);
    agent?.setStatus('ready');
    onDiscard?.();
  }

  function handleGenerateClick() {
    frozenTranscriptRef.current = [...voice.transcript];
    voice.endCall();
    setPhase('idle');
    startedRef.current = false;
    agent?.setCallActive(false);
    agent?.setStatus('processing');
    onGenerate?.(frozenTranscriptRef.current);
  }

  function handleCloseOverlay() {
    voice.endCall();
    setPhase('idle');
    startedRef.current = false;
    agent?.setCallActive(false);
    agent?.setStatus('ready');
    onDiscard?.();
  }

  if (!open) return null;

  const userInitials = userLabel.startsWith('@') ? userLabel.slice(1, 3).toUpperCase() : 'YO';
  const userName = userLabel.startsWith('@') ? userLabel : 'You';
  const inCall = phase === 'active' || phase === 'connecting';

  const lastUserLine = [...voice.transcript].reverse().find((line) => line.role === 'user');
  const userCaption = lastUserLine?.text || '';

  const sarahCaption = voice.isSarahSpeaking || voice.streamingText
    ? voice.streamingText
    : '';

  return createPortal(
    <div className="call-screen-overlay" role="dialog" aria-modal="true" aria-label="PM Agent call">
      <div className="call-screen-inner">
        <header className="call-screen-header">
          <span className={`status-dot ${inCall ? 'live' : ''}`} />
          <span className="call-screen-status">
            {phase === 'connecting' ? 'Connecting…' :
              phase === 'confirm' ? 'Call ended' :
              voice.isThinking ? 'Sarah is thinking…' :
              voice.isSarahSpeaking ? 'Sarah is speaking' :
              voice.callState === 'listening' ? 'Listening' : 'In call'}
          </span>
          {phase !== 'confirm' && (
            <button type="button" className="call-screen-close" onClick={handleCloseOverlay} aria-label="Close call">
              ×
            </button>
          )}
        </header>

        <main className="call-screen-stage">
          {phase === 'confirm' ? (
            <div className="call-confirm-panel">
              <h2>Call ended</h2>
              <p>
                Your conversation is saved ({frozenTranscriptRef.current.length} turns).
                Generate Jira tickets, resume the call, or discard.
              </p>
              <div className="call-confirm-actions">
                <button type="button" className="btn btn-call-confirm-primary" onClick={handleGenerateClick}>
                  Generate tickets
                </button>
                <button type="button" className="btn btn-call-confirm-resume" onClick={handleResume}>
                  Resume call
                </button>
                <button type="button" className="btn btn-call-confirm-discard" onClick={handleDiscard}>
                  Discard
                </button>
              </div>
            </div>
          ) : (
            <div className="call-participant-grid">
              <ParticipantTile
                name={userName}
                initials={userInitials}
                role="user"
                active={voice.callState === 'listening' && !voice.isSarahSpeaking}
                micOn={voice.callState === 'listening' && !voice.isSarahSpeaking}
                caption={userCaption}
              />
              <ParticipantTile
                name="Sarah"
                initials="S"
                role="agent"
                active={voice.isSarahSpeaking}
                thinking={voice.isThinking && !voice.isSarahSpeaking}
                caption={sarahCaption}
              />
            </div>
          )}
        </main>

        {phase === 'active' && (
          <footer className="call-screen-controls">
            <button type="button" className="btn btn-call-end" onClick={handleLeaveCall}>
              End call
            </button>
          </footer>
        )}

        {error && <div className="call-screen-error">{error}</div>}
      </div>
    </div>,
    document.body
  );
}

export { SARAH_OPENING_LINE };
