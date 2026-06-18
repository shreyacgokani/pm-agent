export function safeParseJson(text, label = 'response') {
  if (!text?.trim()) throw new Error(`Empty ${label}`);

  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed);
  } catch (firstErr) {
    const extracted = extractJsonObject(trimmed);
    if (extracted) {
      try {
        return JSON.parse(extracted);
      } catch {
        try {
          return JSON.parse(repairJson(extracted));
        } catch {
          // fall through
        }
      }
    }
    throw new Error(`Invalid ${label}: ${firstErr.message}`);
  }
}

function extractJsonObject(text) {
  const start = text.indexOf('{');
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function repairJson(text) {
  return text
    .replace(/,\s*}/g, '}')
    .replace(/,\s*]/g, ']')
    .replace(/\r\n/g, '\\n')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
}
