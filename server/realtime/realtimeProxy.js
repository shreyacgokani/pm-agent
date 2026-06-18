import { WebSocketServer, WebSocket } from 'ws';
import { getSession, addMessage } from '../services/chat.js';
import {
  buildRealtimeInstructions,
  buildSessionUpdate,
  buildOpeningResponse,
  getRealtimeModel,
} from '../services/realtimeSession.js';

function extractAssistantText(message) {
  if (message.type === 'response.audio_transcript.done' && message.transcript) {
    return message.transcript;
  }
  if (message.type === 'response.text.done' && message.text) {
    return message.text;
  }
  if (message.type === 'response.output_item.done') {
    const item = message.item;
    if (item?.role === 'assistant') {
      const textPart = item.content?.find((c) => c.type === 'text' || c.type === 'audio');
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
          'OpenAI-Beta': 'realtime=v1',
        },
      }
    );

    let sessionConfigured = false;
    let clientReady = false;
    let openingSent = false;
    let assistantBuffer = '';

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
      console.log('[Sarah realtime] OpenAI WS connected for session', sessionId);
    });

    openaiWs.on('message', (data) => {
      let message;
      try {
        message = JSON.parse(data.toString());
      } catch {
        if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data);
        return;
      }

      if (message.type === 'session.created' && !sessionConfigured) {
        const sessionUpdate = buildSessionUpdate(instructions);
        console.log('[Sarah realtime] session.update — modalities:', sessionUpdate.session.modalities, 'voice:', sessionUpdate.session.voice);
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

      if (message.type === 'response.audio.delta' && !assistantBuffer) {
        console.log('[Sarah realtime] first response.audio.delta');
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

      if (message.type === 'response.audio_transcript.delta') {
        assistantBuffer += message.delta || '';
      }

      if (message.type === 'response.audio.delta') {
        clientWs.send(JSON.stringify({ type: 'client.agent_speaking_start' }));
      }

      if (message.type === 'response.audio_transcript.done') {
        const text = (message.transcript || assistantBuffer).trim() || extractAssistantText(message);
        if (text) addMessage(sessionId, 'assistant', text);
        assistantBuffer = '';
      }

      if (message.type === 'response.done') {
        clientWs.send(JSON.stringify({ type: 'client.agent_speaking_end' }));
      }

      if (message.type === 'error') {
        console.error('[Sarah realtime] API error:', message.error);
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({ type: 'error', error: message.error }));
        }
      }

      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(data);
      }
    });

    openaiWs.on('close', (code, reason) => {
      console.log('[Sarah realtime] OpenAI WS closed', code, reason?.toString() || '');
      closeBoth();
    });

    openaiWs.on('error', (err) => {
      console.error('[Sarah realtime] OpenAI WS error:', err.message);
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ type: 'error', error: err.message }));
      }
      closeBoth(1011, 'OpenAI connection error');
    });

    clientWs.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());

        if (message.type === 'client.ready') {
          clientReady = true;
          console.log('[Sarah realtime] client ready');
          sendOpening();
          return;
        }

        if (message.type === 'client.mute_input') return;

        if (openaiWs.readyState === WebSocket.OPEN) {
          openaiWs.send(data);
        }
      } catch {
        if (openaiWs.readyState === WebSocket.OPEN) openaiWs.send(data);
      }
    });

    clientWs.on('close', () => {
      if (openaiWs.readyState === WebSocket.OPEN) openaiWs.close();
    });

    clientWs.on('error', () => closeBoth());
  });
}
