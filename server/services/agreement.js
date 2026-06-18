const DECLINE_RE = /\b(no|not yet|wait|hold on|don't|do not|stop|cancel|not now)\b/i;

const AGREEMENT_RE =
  /\b(yes|yeah|yep|yup|sure|ok|okay|go ahead|sounds good|let's do|lets do|please do|do it|generate|create them|put them together|that works|perfect|agreed|absolutely|definitely|please go|go for it|let's go|lets go|i'm ready|im ready|ready when you are|works for me|let's start|lets start|ship it|make it happen|do that|that's fine|thats fine|fine by me|i'm good|im good|all good|proceed|let's proceed|lets proceed)\b/i;

export function lastAssistantOfferedGeneration(messages) {
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  if (!lastAssistant) return false;
  const text = lastAssistant.content.toLowerCase();
  return (
    /put the tickets|generate|tickets together|create the tickets|write the tickets|go ahead and|ready to put|want me to/i.test(
      text
    ) || /tickets\?/i.test(text)
  );
}

export function looksLikeAgreement(userMessage) {
  const text = userMessage.trim();
  if (!text) return false;
  if (DECLINE_RE.test(text) && !/\b(yes|yeah|sure|ok)\b/i.test(text)) return false;
  return AGREEMENT_RE.test(text);
}

export function shouldAutoGenerate(messages, userMessage, modelAutoGenerate) {
  if (modelAutoGenerate) return true;
  if (!looksLikeAgreement(userMessage)) return false;
  if (lastAssistantOfferedGeneration(messages)) return true;
  // User agreed while scope was already marked ready
  const lastFew = messages.slice(-4);
  return lastFew.some((m) => m.role === 'assistant' && /ready|tickets|put together|generate|go ahead/i.test(m.content));
}
