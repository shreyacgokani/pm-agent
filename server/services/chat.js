import { randomUUID } from 'crypto';

const sessions = new Map();
const SESSION_TTL = 2 * 60 * 60 * 1000;

function cleanupSessions() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.updatedAt > SESSION_TTL) sessions.delete(id);
  }
}

export function getSession(id) {
  cleanupSessions();
  return sessions.get(id) || null;
}

export function createSession(data) {
  cleanupSessions();
  const id = randomUUID();
  const session = {
    ...data,
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  sessions.set(id, session);
  return id;
}

export function addMessage(id, role, content) {
  const session = getSession(id);
  if (!session) return null;
  session.messages.push({ role, content });
  session.updatedAt = Date.now();
  return session;
}

export function getMessages(id) {
  return getSession(id)?.messages || [];
}
