const BASE = '/api';
const GENERATE_TIMEOUT_MS = 10 * 60 * 1000;

async function request(path, options = {}) {
  const { timeout, ...fetchOptions } = options;
  const controller = timeout ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(), timeout)
    : null;

  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { 'Content-Type': 'application/json', ...fetchOptions.headers },
      signal: controller?.signal,
      ...fetchOptions,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    return data;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Request timed out — ticket generation is taking longer than expected. Please retry.');
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const api = {
  dashboard: () => request('/dashboard'),
  prompts: {
    list: () => request('/prompts'),
    create: (body) => request('/prompts', { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) => request(`/prompts/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    delete: (id) => request(`/prompts/${id}`, { method: 'DELETE' }),
  },
  skills: {
    list: () => request('/skills'),
    create: (body) => request('/skills', { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) => request(`/skills/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    delete: (id) => request(`/skills/${id}`, { method: 'DELETE' }),
  },
  generate: {
    list: () => request('/generate'),
    get: (id) => request(`/generate/${id}`),
    create: (repo_url, branch) =>
      request('/generate', { method: 'POST', body: JSON.stringify({ repo_url, branch }) }),
  },
  github: {
    status: () => request('/github/auth/status'),
    capabilities: () => request('/github/auth/capabilities'),
    connectPat: (token) =>
      request('/github/auth/pat', { method: 'POST', body: JSON.stringify({ token }) }),
    disconnect: () => request('/github/auth/disconnect', { method: 'DELETE' }),
    repos: () => request('/github/repos'),
    repoBranches: (owner, repo) => request(`/github/repos/${owner}/${repo}/branches`),
    saveSelection: (owner, repo, branch) =>
      request('/github/selection', { method: 'PUT', body: JSON.stringify({ owner, repo, branch }) }),
    branches: (repo_url) =>
      request(`/github/branches?repo_url=${encodeURIComponent(repo_url)}`),
  },
  chat: {
    start: (repo_url, branch, voice = true) =>
      request('/chat/start', { method: 'POST', body: JSON.stringify({ repo_url, branch, voice }) }),
    message: (sessionId, content, voice = true) =>
      request(`/chat/${sessionId}/message`, { method: 'POST', body: JSON.stringify({ content, voice }) }),
    generate: (sessionId, userConfirmed = true) =>
      request(`/chat/${sessionId}/generate`, {
        method: 'POST',
        body: JSON.stringify({ userConfirmed }),
        timeout: GENERATE_TIMEOUT_MS,
      }),
    generateStream: async (sessionId, onEvent, userConfirmed = true) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), GENERATE_TIMEOUT_MS);

      try {
        const res = await fetch(`${BASE}/chat/${sessionId}/generate-stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userConfirmed }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Request failed (${res.status})`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              onEvent(JSON.parse(line.slice(6)));
            } catch {
              // ignore malformed chunks
            }
          }
        }
      } catch (err) {
        if (err.name === 'AbortError') {
          throw new Error('Request timed out — ticket generation is taking longer than expected. Please retry.');
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    },
  },
  tts: {
    config: () => request('/tts/config'),
    speak: async (text) => {
      const res = await fetch(`${BASE}/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `TTS failed (${res.status})`);
      }
      return res.blob();
    },
  },
};
