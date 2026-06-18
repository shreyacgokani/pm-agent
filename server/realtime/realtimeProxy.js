import { WebSocketServer, WebSocket } from 'ws';
import { getSession, addMessage } from '../services/chat.js';
import {
  buildRealtimeInstructions,
  buildSessionUpdate,
  buildOpeningResponse,
  getRealtimeModel,
} from '../services/realtimeSession.js';

function isAudioDelta(type) {
  return type === 'response.output_audio.delta' || type === 'response.audio.delta';
}

function isTranscriptDelta(type) {
  return type === 'response.output_audio_transcript.delta' || type === 'response.audio_transcript.delta';
}

function isTranscriptDone(type) {
  return type === 'response.output_audio_transcript.done' || type === 'response.audio_transcript.done';
}

function extractAssistantText(message) {
  if (isTranscriptDone(message.type) && message.transcript) {
    return message.transcript;
  }
  if (message.type === 'response.output_text.done' && message.text) {
    return message.text;
  }
  if (message.type === 'response.text.done' && message.text) {
    return message.text;
  }
  if (message.type === 'response.output_item.done') {
    const item = message.item;
    if (item?.role === 'assistant') {
      const textPart = item.content?.find((c) =>
        c.type === 'text' || c.type === 'audio' || c.type === 'output_audio'
      );
      if (textPart?.transcript) return textPart.transcript;
      if (textPart?.text) return textPart.text;
    }
  }
  return null;
}

export function setupRealtimeProxy(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (!url.pathname.startsWith('/api/realtime')) {
      return;
    }

    wss.handleUpgrade(request, socket, head, (clientWs) => {
      wss.emit('connection', clientWs, request);
    });
  });

  wss.on('connection', (clientWs, request) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const sessionId = url.searchParams.get('sessionId');

    if (!sessionId || !getSession(sessionId)) {
      console.warn('[Sarah realtime] rejected WS — invalid session:', sessionId);
      clientWs.close(4000, 'Invalid session');
      return;
    }

    if (!process.env.OPENAI_API_KEY) {
      clientWs.close(4001, 'OpenAI API key not configured');
      return;
    }

    const session = getSession(sessionId);
    const instructions = buildRealtimeInstructions({
      prompt: session.prompt,
      promptName: session.promptName,
      skills: session.skills,
      repoContext: session.repoContext,
    });

    const model = getRealtimeModel();
    const openaiWs = new WebSocket(
      `wss://api.openai.com/v1/realtime?model=${model}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
      }
    );

    let sessionConfigured = false;
    let clientReady = false;
    let openingSent = false;
    let speakingStartSent = false;
    let assistantBuffer = '';
    let sawAudioDelta = false;

    const sendOpening = () => {
      if (openingSent || !sessionConfigured || !clientReady) return;
      openingSent = true;
      console.log('[Sarah realtime] sending opening response');
      openaiWs.send(JSON.stringify(buildOpeningResponse()));
    };

    const closeBoth = (code = 1000, reason = '') => {
      if (clientWs.readyState === WebSocket.OPEN) clientWs.close(code, reason);
      if (openaiWs.readyState === WebSocket.OPEN) openaiWs.close(code, reason);
    };

    openaiWs.on('open', () => {
      console.log('[Sarah realtime] OpenAI WS connected for session', sessionId, 'model:', model);
    });

    const forwardTextToClient = (raw) => {
      if (clientWs.readyState !== WebSocket.OPEN) return;
      const text = typeof raw === 'string' ? raw : raw.toString();
      clientWs.send(text);
    };

    openaiWs.on('message', (data) => {
      const text = data.toString();
      let message;
      try {
        message = JSON.parse(text);
      } catch {
        console.warn('[Sarah realtime] non-JSON message from OpenAI, length:', text.length);
        forwardTextToClient(text);
        return;
      }

      if (message.type === 'session.created' && !sessionConfigured) {
        const sessionUpdate = buildSessionUpdate(instructions);
        console.log('[Sarah realtime] session.update — GA realtime, voice:', sessionUpdate.session?.audio?.output?.voice);
        openaiWs.send(JSON.stringify(sessionUpdate));
      }

      if (message.type === 'session.updated' && !sessionConfigured) {
        sessionConfigured = true;
        console.log('[Sarah realtime] session configured');
        sendOpening();
      }

      if (message.type === 'response.created') {
        console.log('[Sarah realtime] response.created');
      }

      if (isAudioDelta(message.type) && !sawAudioDelta) {
        sawAudioDelta = true;
        console.log('[Sarah realtime] first audio delta');
      }

      if (message.type === 'input_audio_buffer.speech_started') {
        clientWs.send(JSON.stringify({ type: 'client.speech_started' }));
      }

      if (message.type === 'conversation.item.input_audio_transcription.completed') {
        const transcript = message.transcript?.trim();
        if (transcript) {
          addMessage(sessionId, 'user', transcript);
          clientWs.send(JSON.stringify({ type: 'client.user_transcript', text: transcript }));
        }
      }

      if (isTranscriptDelta(message.type)) {
        assistantBuffer += message.delta || '';
      }

      if (isAudioDelta(message.type)) {
        if (!speakingStartSent) {
          speakingStartSent = true;
          clientWs.send(JSON.stringify({ type: 'client.agent_speaking_start' }));
        }
      }

      if (isTranscriptDone(message.type)) {
        const text = (message.transcript || assistantBuffer).trim() || extractAssistantText(message);
        if (text) addMessage(sessionId, 'assistant', text);
        assistantBuffer = '';
      }

      if (message.type === 'response.done') {
        speakingStartSent = false;
        sawAudioDelta = false;
        clientWs.send(JSON.stringify({ type: 'client.agent_speaking_end' }));
      }

      if (message.type === 'error') {
        console.error('[Sarah realtime] API error:', message.error);
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({ type: 'error', error: message.error }));
        }
      }

      forwardTextToClient(text);
    });

    openaiWs.on('close', (code, reason) => {
      console.log('[Sarah realtime] OpenAI WS closed', code, reason?.toString() || '');
      closeBoth();
    });

    openaiWs.on('error', (err) => {
      console.error('[Sarah realtime] OpenAI WS error:', err.message);
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ type: 'error', error: { message: err.message } }));
      }
      closeBoth(1011, 'OpenAI connection error');
    });

    clientWs.on('message', (data) => {
      const text = data.toString();
      try {
        const message = JSON.parse(text);

        if (message.type === 'client.ready') {
          clientReady = true;
          console.log('[Sarah realtime] client ready');
          sendOpening();
          return;
        }

        if (message.type === 'client.mute_input') return;

        if (openaiWs.readyState === WebSocket.OPEN) {
          // OpenAI Realtime requires text JSON frames — never forward raw Buffers as binary.
          openaiWs.send(text);
        }
      } catch {
        console.warn('[Sarah realtime] ignoring non-JSON message from client');
      }
    });

    clientWs.on('close', () => {
      if (openaiWs.readyState === WebSocket.OPEN) openaiWs.close();
    });

    clientWs.on('error', () => closeBoth());
  });
}
