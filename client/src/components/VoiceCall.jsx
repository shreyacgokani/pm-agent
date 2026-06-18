import { useCallback, useEffect, useRef, useState } from 'react';
import { useVoiceCall } from '../hooks/useVoiceCall';

const STATUS_LABELS = {
  idle: 'Ready to join',
  connecting: 'Connecting…',
  active: 'In meeting',
  listening: 'You are speaking',
  synthesizing: 'Sarah is responding…',
  'agent-speaking': 'Sarah is speaking',
  processing: 'Sarah is thinking…',
  ended: 'Call ended',
};

function ParticipantTile({ name, initials, role, active, muted, caption }) {
  return (
    <div className={`teams-tile ${active ? 'active' : ''} ${muted ? 'muted' : ''}`}>
      <div className="teams-tile-video">
        <div className={`teams-avatar teams-avatar-${role}`}>{initials}</div>
        {active && <div className="teams-speaking-indicator" aria-hidden="true" />}
      </div>
      <div className="teams-tile-footer">
        <span className="teams-tile-name">{name}</span>
        {role === 'user' && active && <span className="teams-mic-icon" title="Microphone on">🎤</span>}
      </div>
      {caption && <p className="teams-tile-caption">{caption}</p>}
    </div>
  );
}

export default function VoiceCall({
  sessionId,
  callActive,
  userLabel = 'You',
  onStartCall,
  onUserMessage,
  onAutoGenerate,
  onEndCall,
  onCallTranscript,
  readyToGenerate,
  onGenerate,
  generating,
  disabled,
}) {
  const [error, setError] = useState('');
  const [lastCaption, setLastCaption] = useState({ role: null, text: '' });
  const voice = useVoiceCall(Boolean(sessionId && callActive));
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  const onUserMessageRef = useRef(onUserMessage);
  onUserMessageRef.current = onUserMessage;

  const onAutoGenerateRef = useRef(onAutoGenerate);
  onAutoGenerateRef.current = onAutoGenerate;

  const onGenerateRef = useRef(onGenerate);
  onGenerateRef.current = onGenerate;

  const generatingRef = useRef(generating);
  generatingRef.current = generating;

  const handleAgentReply = useCallback((data) => {
    setLastCaption({ role: 'agent', text: data.message });
    voiceRef.current.prefetchReply(data.message);

    if (data.autoGenerate && !generatingRef.current) {
      const transcript = [...voiceRef.current.transcript];
      voiceRef.current.endCall();
      onCallTranscript?.(transcript);
      onAutoGenerateRef.current?.(data, transcript);
      return;
    }

    voiceRef.current.speak(data.message, () => {
      voiceRef.current.userHeard();
    });
  }, [onCallTranscript]);

  useEffect(() => {
    voiceRef.current.setOnUtterance(async (text) => {
      if (!sessionId || !callActive) return;
      setLastCaption({ role: 'user', text });
      try {
        const data = await onUserMessageRef.current(text);
        handleAgentReply(data);
      } catch (err) {
        voiceRef.current.userHeard();
        setError(err.message);
        const retry = "Sorry, I didn't catch that — could you say that again?";
        setLastCaption({ role: 'agent', text: retry });
        voiceRef.current.speak(retry, () => voiceRef.current.userHeard());
      }
    });
  }, [sessionId, callActive, handleAgentReply]);

  async function handleJoinCall() {
    setError('');
    setLastCaption({ role: null, text: '' });
    voice.beginCall();
    try {
      const data = await onStartCall();
      voice.setCallState('active');
      setLastCaption({ role: 'agent', text: data.message });
      voice.prefetchReply(data.message);
      voice.speak(data.message, () => voice.userHeard());
    } catch (err) {
      voice.endCall();
      setError(err.message);
    }
  }

  function handleLeaveCall() {
    const transcript = voice.transcript;
    voice.endCall();
    onCallTranscript?.(transcript);
    onEndCall?.(transcript);
  }

  const inCall = callActive && sessionId && voice.callState !== 'idle' && voice.callState !== 'ended';
  const hasSession = Boolean(sessionId);
  const showPostCall = hasSession && !inCall && !generating;
  const status = inCall
    ? (STATUS_LABELS[voice.callState] || voice.callState)
    : (generating ? 'Generating tickets…' : hasSession ? 'Call ended' : STATUS_LABELS.idle);

  const userSpeaking = inCall && (voice.callState === 'listening');
  const sarahSpeaking = inCall && (voice.callState === 'agent-speaking' || voice.callState === 'synthesizing');
  const sarahThinking = inCall && voice.callState === 'processing';

  const userInitials = userLabel.startsWith('@') ? userLabel.slice(1, 3).toUpperCase() : 'YO';
  const userName = userLabel.startsWith('@') ? userLabel : 'You';

  if (!voice.isSupported) {
    return (
      <div className="error">
        Voice calls require Chrome or Edge with microphone access.
      </div>
    );
  }

  return (
    <div className="voice-call teams-call">
      {!inCall && !showPostCall ? (
        <div className="teams-pre-call">
          <p className="teams-pre-call-title">PM planning call</p>
          <p className="teams-pre-call-sub">Talk through your feature with Sarah — she&apos;ll turn it into Jira tickets.</p>
          <button
            type="button"
            className="btn btn-call-start"
            onClick={handleJoinCall}
            disabled={disabled}
          >
            Join call
          </button>
        </div>
      ) : (
        <>
          <div className={`teams-meeting ${inCall ? 'live' : ''}`}>
            <div className="teams-meeting-header">
              <span className={`status-dot ${inCall ? 'live' : ''}`} />
              <span>{status}</span>
              {readyToGenerate && inCall && (
                <span className="teams-ready-pill">Ready to generate</span>
              )}
            </div>

            <div className="teams-grid">
              <ParticipantTile
                name={userName}
                initials={userInitials}
                role="user"
                active={userSpeaking}
                muted={false}
                caption={lastCaption.role === 'user' ? lastCaption.text : ''}
              />
              <ParticipantTile
                name="Sarah"
                initials="S"
                role="agent"
                active={sarahSpeaking || sarahThinking}
                caption={lastCaption.role === 'agent' ? lastCaption.text : ''}
              />
            </div>

            <div className="teams-toolbar">
              {inCall ? (
                <>
                  <button type="button" className="btn btn-call-end" onClick={handleLeaveCall}>
                    Leave
                  </button>
                  {readyToGenerate && (
                    <button
                      type="button"
                      className="btn btn-primary btn-generate"
                      onClick={() => {
                        const transcript = voice.transcript;
                        voice.endCall();
                        onCallTranscript?.(transcript);
                        onEndCall?.(transcript);
                        onGenerateRef.current?.();
                      }}
                      disabled={generating || voice.callState === 'processing'}
                    >
                      {generating ? 'Generating…' : 'Generate tickets'}
                    </button>
                  )}
                </>
              ) : showPostCall ? (
                <>
                  <button
                    type="button"
                    className="btn btn-call-start"
                    onClick={handleJoinCall}
                    disabled={disabled || generating}
                  >
                    New call
                  </button>
                  {readyToGenerate && (
                    <button
                      type="button"
                      className="btn btn-primary btn-generate"
                      onClick={onGenerate}
                      disabled={generating}
                    >
                      {generating ? 'Generating…' : 'Generate tickets'}
                    </button>
                  )}
                </>
              ) : null}
            </div>
          </div>
        </>
      )}

      {error && <div className="error">{error}</div>}

      <p className="call-hint">
        {inCall
          ? 'Talk naturally — you can interrupt Sarah anytime. When you agree, she\'ll end the call and build your tickets.'
          : generating
            ? 'Your tickets are being generated below.'
            : 'Join a call to scope your feature, then Sarah creates Jira tickets from the conversation.'}
      </p>
    </div>
  );
}
