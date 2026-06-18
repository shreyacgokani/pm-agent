import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const DEFAULT_VOICE = 'shimmer';
const DEFAULT_MODEL = 'tts-1';

// Sarah's voice is fixed — do not change without explicit product decision.
const ALLOWED_VOICES = new Set(['shimmer']);

export function getTtsConfig() {
  const requested = process.env.OPENAI_TTS_VOICE || DEFAULT_VOICE;
  const voice = ALLOWED_VOICES.has(requested) ? requested : DEFAULT_VOICE;
  return {
    model: process.env.OPENAI_TTS_MODEL || DEFAULT_MODEL,
    voice,
  };
}

export async function synthesizeSpeech(text) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OpenAI API key not configured');
  }

  const trimmed = text?.trim();
  if (!trimmed) throw new Error('Text is required');

  const { model, voice } = getTtsConfig();

  const response = await openai.audio.speech.create({
    model,
    voice,
    input: trimmed.slice(0, 4096),
    speed: 1.0,
  });

  return Buffer.from(await response.arrayBuffer());
}
