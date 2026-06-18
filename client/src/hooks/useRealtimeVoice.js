import { useCallback, useEffect, useRef, useState } from 'react';

const MIC_REOPEN_DELAY_MS = 400;
const SAMPLE_RATE = 24000;
const DEBUG_AUDIO = import.meta.env.DEV;

const MIC_CONSTRAINTS = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
};

let primedAudioContext = null;

export async function primeAudioOutput() {
  if (!primedAudioContext || primedAudioContext.state === 'closed') {
    primedAudioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
  }
  if (primedAudioContext.state === 'suspended') {
    await primedAudioContext.resume();
  }
  if (DEBUG_AUDIO) {
    console.log('[Sarah audio] primed AudioContext state:', primedAudioContext.state);
  }
  return primedAudioContext;
}

function getWsUrl(sessionId) {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${window.location.host}/api/realtime?sessionId=${sessionId}`;
}

function floatTo16BitPCM(float32) {
  const buffer = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    buffer[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return buffer;
}

function base64FromInt16(int16) {
  const bytes = new Uint8Array(int16.buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function pcm16Base64ToFloat32(base64) {
  if (!base64) return new Float32Array(0);

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const sampleCount = Math.floor(bytes.length / 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const float32 = new Float32Array(sampleCount);

  for (let i = 0; i < sampleCount; i++) {
    float32[i] = view.getInt16(i * 2, true) / 32768;
  }

  return float32;
}

function resampleFloat32(input, inputRate, outputRate) {
  if (inputRate === outputRate) return input;
  const ratio = inputRate / outputRate;
  const outputLength = Math.round(input.length / ratio);
  const output = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const srcIndex = i * ratio;
    const idx = Math.floor(srcIndex);
    const frac = srcIndex - idx;
    const a = input[idx] || 0;
    const b = input[idx + 1] || a;
    output[i] = a + (b - a) * frac;
  }
  return output;
}

export function useRealtimeVoice(sessionId) {
  const [callState, setCallState] = useState('idle');
  const [transcript, setTranscript] = useState([]);
  const [streamingText, setStreamingText] = useState('');
  const [isSarahSpeaking, setIsSarahSpeaking] = useState(false);
  const [isThinking, setIsThinking] = useState(false);

  const wsRef = useRef(null);
  const audioCtxRef = useRef(null);
  const playbackGainRef = useRef(null);
  const micStreamRef = useRef(null);
  const micSourceRef = useRef(null);
  const processorRef = useRef(null);
  const silentGainRef = useRef(null);
  const nextPlayTimeRef = useRef(0);
  const isSarahSpeakingRef = useRef(false);
  const enabledRef = useRef(false);
  const pausedRef = useRef(false);
  const reopenTimerRef = useRef(null);
  const audioChunkCountRef = useRef(0);
  const pendingChunksRef = useRef([]);
  const handleServerEventRef = useRef(() => {});

  const ensureAudioRunning = useCallback(async () => {
    const ctx = audioCtxRef.current;
    if (!ctx) return false;
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    return ctx.state === 'running';
  }, []);

  const stopMicCapture = useCallback(() => {
    processorRef.current?.disconnect();
    processorRef.current = null;
    micSourceRef.current?.disconnect();
    micSourceRef.current = null;
    micStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = false;
    });
  }, []);

  const startMicCapture = useCallback(() => {
    if (!micStreamRef.current || !audioCtxRef.current || !wsRef.current) return;
    if (isSarahSpeakingRef.current || pausedRef.current) return;

    stopMicCapture();

    micStreamRef.current.getAudioTracks().forEach((track) => {
      track.enabled = true;
    });

    const ctx = audioCtxRef.current;
    const source = ctx.createMediaStreamSource(micStreamRef.current);
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    const inputRate = ctx.sampleRate;

    if (!silentGainRef.current) {
      const silentGain = ctx.createGain();
      silentGain.gain.value = 0;
      silentGain.connect(ctx.destination);
      silentGainRef.current = silentGain;
    }

    processor.onaudioprocess = (e) => {
      if (!enabledRef.current || isSarahSpeakingRef.current || pausedRef.current) return;
      if (wsRef.current?.readyState !== WebSocket.OPEN) return;

      const input = e.inputBuffer.getChannelData(0);
      const resampled = resampleFloat32(input, inputRate, SAMPLE_RATE);
      const pcm = floatTo16BitPCM(resampled);
      wsRef.current.send(JSON.stringify({
        type: 'input_audio_buffer.append',
        audio: base64FromInt16(pcm),
      }));
    };

    source.connect(processor);
    processor.connect(silentGainRef.current);
    micSourceRef.current = source;
    processorRef.current = processor;
    setCallState('listening');

    if (DEBUG_AUDIO) console.log('[Sarah audio] mic capture started');
  }, [stopMicCapture]);

  const scheduleListening = useCallback(() => {
    if (reopenTimerRef.current) clearTimeout(reopenTimerRef.current);
    reopenTimerRef.current = setTimeout(() => {
      isSarahSpeakingRef.current = false;
      setIsSarahSpeaking(false);
      setIsThinking(false);
      if (enabledRef.current && !pausedRef.current) {
        startMicCapture();
      }
    }, MIC_REOPEN_DELAY_MS);
  }, [startMicCapture]);

  const playAudioChunk = useCallback(async (base64Audio) => {
    const ctx = audioCtxRef.current;
    if (!ctx || !base64Audio) return false;

    const running = await ensureAudioRunning();
    if (!running) return false;

    const float32 = pcm16Base64ToFloat32(base64Audio);
    if (!float32.length) return false;

    audioChunkCountRef.current += 1;
    if (DEBUG_AUDIO && audioChunkCountRef.current === 1) {
      console.log('[Sarah audio] first chunk decoded, samples:', float32.length);
      console.log('[Sarah audio] AudioBufferSourceNode.start(), ctx:', ctx.state);
    }

    const buffer = ctx.createBuffer(1, float32.length, SAMPLE_RATE);
    buffer.copyToChannel(float32, 0);

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    if (!playbackGainRef.current) {
      const gain = ctx.createGain();
      gain.gain.value = 1;
      gain.connect(ctx.destination);
      playbackGainRef.current = gain;
    }

    source.connect(playbackGainRef.current);

    const now = ctx.currentTime;
    const start = Math.max(now, nextPlayTimeRef.current);
    source.start(start);
    nextPlayTimeRef.current = start + buffer.duration;
    return true;
  }, [ensureAudioRunning]);

  const queueAudioChunk = useCallback(async (base64Audio) => {
    if (!audioCtxRef.current) {
      pendingChunksRef.current.push(base64Audio);
      return;
    }

    await playAudioChunk(base64Audio);

    if (pendingChunksRef.current.length) {
      const pending = [...pendingChunksRef.current];
      pendingChunksRef.current = [];
      for (const chunk of pending) {
        await playAudioChunk(chunk);
      }
    }
  }, [playAudioChunk]);

  const enterSpeakingMode = useCallback(() => {
    if (!isSarahSpeakingRef.current) {
      isSarahSpeakingRef.current = true;
      setIsSarahSpeaking(true);
      setIsThinking(false);
      setStreamingText('');
      stopMicCapture();
      setCallState('agent-speaking');
    }
  }, [stopMicCapture]);

  const handleServerEvent = useCallback((message) => {
    if (DEBUG_AUDIO && (message.type?.startsWith('response.') || message.type?.startsWith('session.'))) {
      console.log('[Sarah realtime]', message.type);
    }

    switch (message.type) {
      case 'client.agent_speaking_start':
        enterSpeakingMode();
        break;
      case 'client.agent_speaking_end':
        setStreamingText('');
        scheduleListening();
        break;
      case 'client.user_transcript':
        if (message.text) {
          setTranscript((prev) => [...prev, { role: 'user', text: message.text, at: Date.now() }]);
        }
        setIsThinking(true);
        setCallState('processing');
        break;
      case 'input_audio_buffer.speech_started':
        if (!isSarahSpeakingRef.current) setIsThinking(false);
        break;
      case 'response.audio.delta':
        enterSpeakingMode();
        if (DEBUG_AUDIO && audioChunkCountRef.current === 0) {
          console.log('[Sarah audio] first delta prefix:', (message.delta || '').slice(0, 20));
        }
        queueAudioChunk(message.delta);
        break;
      case 'response.audio_transcript.delta':
        setStreamingText((prev) => prev + (message.delta || ''));
        break;
      case 'response.audio_transcript.done':
        if (message.transcript) {
          setStreamingText(message.transcript);
          setTranscript((prev) => [...prev, { role: 'agent', text: message.transcript, at: Date.now() }]);
        }
        break;
      case 'response.created':
        setIsThinking(true);
        setStreamingText('');
        audioChunkCountRef.current = 0;
        setCallState('processing');
        break;
      case 'error':
        console.error('[Sarah realtime] error:', message.error);
        break;
      default:
        break;
    }
  }, [enterSpeakingMode, queueAudioChunk, scheduleListening]);

  handleServerEventRef.current = handleServerEvent;

  const connect = useCallback(async (activeSessionId) => {
    const sid = activeSessionId || sessionId;
    if (!sid) throw new Error('No session');

    audioChunkCountRef.current = 0;
    pendingChunksRef.current = [];

    // 1. AudioContext FIRST — must exist before any audio.delta can play.
    let ctx = primedAudioContext && primedAudioContext.state !== 'closed'
      ? primedAudioContext
      : new AudioContext({ sampleRate: SAMPLE_RATE });
    primedAudioContext = null;

    if (ctx.state === 'suspended') await ctx.resume();
    if (ctx.state !== 'running') {
      throw new Error('Audio output blocked — click Start call again to enable sound.');
    }

    audioCtxRef.current = ctx;
    playbackGainRef.current = null;
    silentGainRef.current = null;
    nextPlayTimeRef.current = ctx.currentTime;

    if (DEBUG_AUDIO) {
      console.log('[Sarah audio] connect: ctx', ctx.state, 'rate', ctx.sampleRate);
    }

    // 2. WebSocket with handler attached before open.
    const ws = new WebSocket(getWsUrl(sid));
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        handleServerEventRef.current(JSON.parse(event.data));
      } catch {
        // ignore
      }
    };

    ws.onclose = (event) => {
      if (DEBUG_AUDIO) console.log('[Sarah audio] ws closed', event.code, event.reason || '');
      if (enabledRef.current) setCallState('ended');
    };

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Realtime connection timeout')), 10000);
      ws.onopen = () => {
        clearTimeout(timeout);
        if (DEBUG_AUDIO) console.log('[Sarah audio] ws open');
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('Realtime connection failed'));
      };
    });

    // 3. Mic permission.
    const stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
    micStreamRef.current = stream;
    stream.getAudioTracks().forEach((track) => { track.enabled = false; });

    enabledRef.current = true;
    pausedRef.current = false;

    // 4. Tell server we're ready — triggers Sarah's opening line.
    ws.send(JSON.stringify({ type: 'client.ready' }));

    setCallState('connecting');
    if (DEBUG_AUDIO) console.log('[Sarah audio] client.ready sent');
  }, [sessionId]);

  const beginCall = useCallback(async (activeSessionId) => {
    setTranscript([]);
    setStreamingText('');
    await connect(activeSessionId);
  }, [connect]);

  const pauseCall = useCallback(() => {
    pausedRef.current = true;
    stopMicCapture();
    setCallState('paused');
  }, [stopMicCapture]);

  const resumeCall = useCallback(async () => {
    pausedRef.current = false;
    await ensureAudioRunning();
    if (!isSarahSpeakingRef.current) startMicCapture();
    setCallState('listening');
  }, [ensureAudioRunning, startMicCapture]);

  const endCall = useCallback(() => {
    enabledRef.current = false;
    pausedRef.current = false;
    if (reopenTimerRef.current) clearTimeout(reopenTimerRef.current);
    stopMicCapture();
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.close();
    wsRef.current = null;
    playbackGainRef.current = null;
    silentGainRef.current = null;
    pendingChunksRef.current = [];
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close();
    }
    audioCtxRef.current = null;
    isSarahSpeakingRef.current = false;
    setIsSarahSpeaking(false);
    setIsThinking(false);
    setStreamingText('');
    audioChunkCountRef.current = 0;
    setCallState('ended');
  }, [stopMicCapture]);

  const endCallRef = useRef(endCall);
  endCallRef.current = endCall;
  useEffect(() => () => endCallRef.current(), []);

  return {
    callState,
    transcript,
    streamingText,
    isSarahSpeaking,
    isThinking,
    beginCall,
    pauseCall,
    resumeCall,
    endCall,
    isSupported: Boolean(navigator.mediaDevices?.getUserMedia && window.WebSocket),
  };
}

export const SARAH_OPENING_LINE =
  "Hey! It's Sarah — I've looked over your project. What area or flow should we turn into Jira tickets?";
