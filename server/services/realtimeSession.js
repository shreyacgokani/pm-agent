import { extractVoicePrompt } from './jiraGeneration.js';
import { formatRepoSummaryForVoice } from './github.js';

const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime';
const REALTIME_VOICE = 'shimmer';

const VOICE_RULES = `You are Sarah, a friendly PM on a live voice call. American English. Warm, human, encouraging — like a real colleague.

RULES:
- Short natural turns (1-3 sentences). One question at a time.
- Acknowledge what they said before asking the next thing.
- NEVER mention file paths or GitHub internals unless the user does first.
- Ask about screens, flows, features, and user journeys in product language.
- NEVER explain Jira formatting on the call.
- When scope is clear, tell them they can end the call and tap Generate tickets.
- NEVER start ticket generation yourself.
- Politely decline off-topic questions and steer back to this project only.`;

export function getRealtimeModel() {
  return REALTIME_MODEL;
}

export function buildRealtimeInstructions({ prompt, promptName, skills, repoContext }) {
  const voicePrompt = extractVoicePrompt(prompt);
  const skillsList = skills?.length
    ? skills.map((s) => `- ${s.name} (${s.category}): ${s.description || ''}`).join('\n')
    : 'No skills configured.';

  return `${VOICE_RULES}

=== PM INSTRUCTIONS (${promptName}) ===
${voicePrompt}

=== TEAM SKILLS ===
${skillsList}

=== CODEBASE CONTEXT (internal — use product language on the call) ===
${formatRepoSummaryForVoice(repoContext)}`;
}

export function buildSessionUpdate(instructions) {
  return {
    type: 'session.update',
    session: {
      type: 'realtime',
      model: REALTIME_MODEL,
      instructions,
      output_modalities: ['audio'],
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: 24000 },
          transcription: { model: 'whisper-1' },
          turn_detection: {
            type: 'server_vad',
            threshold: 0.65,
            prefix_padding_ms: 300,
            silence_duration_ms: 1200,
            create_response: true,
          },
        },
        output: {
          format: { type: 'audio/pcm', rate: 24000 },
          voice: REALTIME_VOICE,
        },
      },
    },
  };
}

export function buildOpeningResponse() {
  return {
    type: 'response.create',
    response: {
      instructions:
        "Give a brief warm hello. You're Sarah their PM. You've looked over the project. Ask what area or flow they want Jira tickets for. Max 2 sentences.",
    },
  };
}
