import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';

const SpeechRecognition = typeof window !== 'undefined'
  ? window.SpeechRecognition || window.webkitSpeechRecognition
  : null;

const MIC_REOPEN_DELAY_MS = 400;
const SILENCE_DURATION_MS = 1200;
const SILENCE_EXTENSION_MS = 600;
const MIN_WORDS_FOR_TURN = 8;

const MIC_CONSTRAINTS = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    sampleRate: 24000,
  },
};

export const SARAH_OPENING_LINE =
  "Hey! It's Sarah — I've looked over your project. What area or flow should we turn into Jira tickets?";

export function prefetchSarahAudio(text) {
  if (!text?.trim()) return;
  api.tts.speak(text).catch(() => {});
}

export function useVoiceCall() {
  const [callState, setCallState] = useState('idle');
  const [transcript, setTranscript] = useState([]);
  const [isSarahSpeaking, setIsSarahSpeaking] = useState(false);
  const isSarahSpeakingRef = useRef(false);

  const enabledRef = useRef(false);
  const pausedRef = useRef(false);
  const processingRef = useRef(false);
  const onUtteranceRef = useRef(null);

  const recognitionRef = useRef(null);
  const listenActiveRef = useRef(false);
  const micStreamRef = useRef(null);
  const micTrackRef = useRef(null);

  const turnBufferRef = useRef('');
  const silenceTimerRef = useRef(null);
  const reopenTimerRef = useRef(null);

  const audioRef = useRef(null);
  const audioUrlRef = useRef(null);
  const ttsCacheRef = useRef(new Map());

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const clearReopenTimer = useCallback(() => {
    if (reopenTimerRef.current) {
      clearTimeout(reopenTimerRef.current);
      reopenTimerRef.current = null;
    }
  }, []);

  const revokeAudioUrl = useCallback(() => {
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
  }, []);

  const setMicEnabled = useCallback((enabled) => {
    if (micTrackRef.current) {
      micTrackRef.current.enabled = enabled;
    }
  }, []);

  const stopRecognition = useCallback(() => {
    listenActiveRef.current = false;
    try {
      recognitionRef.current?.stop();
    } catch {
      // ignore
    }
    recognitionRef.current = null;
  }, []);

  const stopPlayback = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
    revokeAudioUrl();
  }, [revokeAudioUrl]);

  const enterSpeakingMode = useCallback(() => {
    clearSilenceTimer();
    turnBufferRef.current = '';
    isSarahSpeakingRef.current = true;
    setIsSarahSpeaking(true);
    setMicEnabled(false);
    stopRecognition();
    setCallState('agent-speaking');
  }, [clearSilenceTimer, setMicEnabled, stopRecognition]);

  const scheduleListeningMode = useCallback((onDone) => {
    clearReopenTimer();
    reopenTimerRef.current = setTimeout(() => {
      isSarahSpeakingRef.current = false;
      setIsSarahSpeaking(false);
      setMicEnabled(true);
      if (!pausedRef.current && enabledRef.current && !processingRef.current) {
        setCallState('listening');
        startRecognitionRef.current?.();
      }
      onDone?.();
    }, MIC_REOPEN_DELAY_MS);
  }, [clearReopenTimer, setMicEnabled]);

  const dispatchTurn = useCallback((utterance) => {
    const text = utterance.trim();
    if (!text || processingRef.current || isSarahSpeakingRef.current) return;

    clearSilenceTimer();
    turnBufferRef.current = '';
    stopRecognition();
    setTranscript((prev) => [...prev, { role: 'user', text, at: Date.now() }]);
    processingRef.current = true;
    setCallState('processing');
    onUtteranceRef.current?.(text);
  }, [clearSilenceTimer, stopRecognition]);

  const scheduleTurnEnd = useCallback(() => {
    clearSilenceTimer();
    const buffered = turnBufferRef.current.trim();
    if (!buffered) return;

    const wordCount = buffered.split(/\s+/).filter(Boolean).length;
    const delay = wordCount < MIN_WORDS_FOR_TURN
      ? SILENCE_DURATION_MS + SILENCE_EXTENSION_MS
      : SILENCE_DURATION_MS;

    silenceTimerRef.current = setTimeout(() => {
      const finalText = turnBufferRef.current.trim();
      if (finalText && !processingRef.current && !pausedRef.current && enabledRef.current) {
        dispatchTurn(finalText);
      }
    }, delay);
  }, [clearSilenceTimer, dispatchTurn]);

  const startRecognitionRef = useRef(null);

  const startRecognition = useCallback(() => {
    if (!SpeechRecognition || !enabledRef.current || pausedRef.current || listenActiveRef.current) {
      return;
    }
    if (processingRef.current || isSarahSpeakingRef.current) return;

    stopRecognition();

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      listenActiveRef.current = true;
      if (!processingRef.current && !isSarahSpeakingRef.current && !pausedRef.current) {
        setCallState('listening');
      }
    };

    recognition.onresult = (event) => {
      // Layer 4 — drop all input while Sarah speaks
      if (isSarahSpeakingRef.current || processingRef.current || pausedRef.current) return;

      let finalChunk = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalChunk += event.results[i][0].transcript;
        }
      }

      if (!finalChunk.trim()) return;

      turnBufferRef.current = `${turnBufferRef.current} ${finalChunk}`.trim();
      scheduleTurnEnd();
    };

    recognition.onerror = (event) => {
      if (event.error === 'aborted' || event.error === 'no-speech') return;
    };

    recognition.onend = () => {
      listenActiveRef.current = false;
      if (enabledRef.current && !pausedRef.current && !processingRef.current && !isSarahSpeakingRef.current) {
        setTimeout(() => startRecognitionRef.current?.(), 120);
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      // ignore
    }
  }, [scheduleTurnEnd, stopRecognition]);

  startRecognitionRef.current = startRecognition;

  const ensureMicStream = useCallback(async () => {
    if (micStreamRef.current) return micStreamRef.current;
    const stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
    micStreamRef.current = stream;
    micTrackRef.current = stream.getAudioTracks()[0] || null;
    return stream;
  }, []);

  const releaseMicStream = useCallback(() => {
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    micTrackRef.current = null;
  }, []);

  const fetchTtsBlob = useCallback(async (text, attempt = 0) => {
    const key = text.trim();
    if (!key) return null;

    const cached = ttsCacheRef.current.get(key);
    if (cached) {
      try {
        return await cached;
      } catch {
        ttsCacheRef.current.delete(key);
      }
    }

    const promise = api.tts.speak(key);
    ttsCacheRef.current.set(key, promise);
    try {
      return await promise;
    } catch (err) {
      ttsCacheRef.current.delete(key);
      if (attempt < 1) return fetchTtsBlob(text, attempt + 1);
      throw err;
    }
  }, []);

  const prefetchReply = useCallback((text) => {
    fetchTtsBlob(text).catch(() => {});
  }, [fetchTtsBlob]);

  const speak = useCallback(async (text, onDone) => {
    if (!text?.trim()) {
      onDone?.();
      return;
    }

    stopPlayback();
    enterSpeakingMode();

    try {
      const blob = await fetchTtsBlob(text);
      if (blob) await new Promise((resolve, reject) => {
        revokeAudioUrl();
        const url = URL.createObjectURL(blob);
        audioUrlRef.current = url;
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => {
          revokeAudioUrl();
          audioRef.current = null;
          resolve();
        };
        audio.onerror = () => {
          revokeAudioUrl();
          audioRef.current = null;
          reject(new Error('Audio playback failed'));
        };
        audio.play().catch(reject);
      });
    } catch {
      scheduleListeningMode(onDone);
      return;
    }

    setTranscript((prev) => [...prev, { role: 'agent', text, at: Date.now() }]);
    scheduleListeningMode(onDone);
  }, [enterSpeakingMode, fetchTtsBlob, revokeAudioUrl, scheduleListeningMode, stopPlayback]);

  const userHeard = useCallback(() => {
    processingRef.current = false;
    if (!pausedRef.current && enabledRef.current && !isSarahSpeakingRef.current) {
      startRecognition();
    }
  }, [startRecognition]);

  const beginCall = useCallback(async () => {
    enabledRef.current = true;
    pausedRef.current = false;
    processingRef.current = false;
    turnBufferRef.current = '';
    clearSilenceTimer();
    clearReopenTimer();
    setCallState('connecting');
    setTranscript([]);
    isSarahSpeakingRef.current = false;
    setIsSarahSpeaking(false);
    await ensureMicStream();
    setMicEnabled(true);
  }, [clearReopenTimer, clearSilenceTimer, ensureMicStream, setMicEnabled]);

  const pauseCall = useCallback(() => {
    pausedRef.current = true;
    clearSilenceTimer();
    clearReopenTimer();
    stopRecognition();
    stopPlayback();
    isSarahSpeakingRef.current = false;
    setIsSarahSpeaking(false);
    setMicEnabled(false);
    setCallState('paused');
  }, [clearReopenTimer, clearSilenceTimer, setMicEnabled, stopPlayback, stopRecognition]);

  const resumeCall = useCallback(() => {
    if (!enabledRef.current) return;
    pausedRef.current = false;
    processingRef.current = false;
    setMicEnabled(true);
    setCallState('listening');
    startRecognition();
  }, [setMicEnabled, startRecognition]);

  const endCall = useCallback(() => {
    enabledRef.current = false;
    pausedRef.current = false;
    processingRef.current = false;
    clearSilenceTimer();
    clearReopenTimer();
    stopRecognition();
    stopPlayback();
    releaseMicStream();
    isSarahSpeakingRef.current = false;
    setIsSarahSpeaking(false);
    setCallState('ended');
  }, [clearReopenTimer, clearSilenceTimer, releaseMicStream, stopPlayback, stopRecognition]);

  const setOnUtterance = useCallback((fn) => {
    onUtteranceRef.current = fn;
  }, []);

  useEffect(() => () => {
    endCall();
  }, [endCall]);

  return {
    callState,
    transcript,
    isSarahSpeaking,
    isSarahSpeakingState: isSarahSpeaking,
    prefetchReply,
    speak,
    beginCall,
    pauseCall,
    resumeCall,
    endCall,
    userHeard,
    setOnUtterance,
    setCallState,
    isSupported: Boolean(SpeechRecognition) && Boolean(navigator.mediaDevices?.getUserMedia),
  };
}
