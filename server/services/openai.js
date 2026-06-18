import OpenAI from 'openai';
import { formatRepoSummaryForVoice } from './github.js';
import { safeParseJson } from './jsonUtil.js';
import { extractVoicePrompt } from './jiraGeneration.js';
import { generateJiraTicketsMultiPass } from './jiraGeneration.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const VOICE_RULES = `You are Sarah, a friendly PM on a live voice call. American English. Warm, human, encouraging — like a real colleague, not a robot or AI assistant.

HOW TO TALK:
- Short, natural spoken turns (1-3 sentences). Use contractions. Vary your phrasing.
- One question at a time. Never stack questions.
- Acknowledge what they said before asking the next thing ("Got it", "Makes sense", "Okay cool").
- NEVER mention file paths, .tsx filenames, code structure, or GitHub internals unless the user says them first.
- Ask about screens, flows, tabs, features, and user journeys — how a person would describe the product.
- NEVER explain how you will format Jira tickets, epics, stories, or subtasks on the call. That happens silently after.
- When ready, ask if they want you to put the tickets together.
- NEVER auto-generate tickets. The user must explicitly end the call and click Generate.

OFF-TOPIC: Politely decline and steer back to this project only.

readyToGenerate: true when you understand scope well enough to write tickets.
autoGenerate: always false — ticket generation only happens when the user confirms after ending the call.

IMPORTANT: In your JSON reply, keep "message" under 280 characters. Use only plain text in message — no quotes inside quotes, no markdown.`;

function buildVoiceSystemPrompt({ prompt, promptName, skills, repoContext }) {
  const voicePrompt = extractVoicePrompt(prompt);

  return `=== YOUR PM INSTRUCTIONS (PRIMARY) ===
Prompt: "${promptName}"
${voicePrompt}

Internalize the above for product context. Do NOT read it aloud or explain formatting on the call.

=== VOICE PERSONA ===
${VOICE_RULES}

=== TEAM SKILLS ===
${buildSkillsList(skills)}

=== CODEBASE (internal — product language only on call) ===
${formatRepoSummaryForVoice(repoContext)}`;
}

function buildSkillsList(skills) {
  return skills.length
    ? skills.map((s) => `- ${s.name} (${s.category}): ${s.description || 'No description'}`).join('\n')
    : 'No skills configured.';
}

export async function startConversation({ repoContext, prompt, promptName, skills }) {
  const systemPrompt = `${buildVoiceSystemPrompt({ prompt, promptName, skills, repoContext })}

Respond with JSON only: { "message": "spoken reply max 280 chars", "readyToGenerate": false, "autoGenerate": false }

First message: brief warm hello, you're Sarah their PM, you've looked over the project, ask what area or flow they want tickets for. Max 2 sentences.`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: 'The user just joined the call.' },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.7,
    max_tokens: 150,
  });

  return parseChatResponse(response);
}

export async function continueConversation({ repoContext, prompt, promptName, skills, messages, userMessage }) {
  const systemPrompt = `${buildVoiceSystemPrompt({ prompt, promptName, skills, repoContext })}

Respond with JSON only: { "message": "spoken reply max 280 chars", "readyToGenerate": false, "autoGenerate": false }

If your last message asked whether to put tickets together, acknowledge but do NOT start generation — remind them to end the call and tap Generate tickets when ready.`;

  const chatMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.slice(-12),
    { role: 'user', content: userMessage },
  ];

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: chatMessages,
    response_format: { type: 'json_object' },
    temperature: 0.7,
    max_tokens: 150,
  });

  const parsed = parseChatResponse(response);
  return {
    ...parsed,
    autoGenerate: false,
  };
}

export async function generateJiraTickets(params) {
  return generateJiraTicketsMultiPass(params);
}

function parseChatResponse(response) {
  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('No response from OpenAI');

  const parsed = safeParseJson(content, 'agent reply');
  if (!parsed.message) throw new Error('Invalid agent response');

  let message = String(parsed.message)
    .replace(/\*\*/g, '')
    .replace(/^#+\s*/gm, '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/"/g, "'")
    .trim();

  if (message.length > 320) {
    message = message.slice(0, 317) + '...';
  }

  return {
    message,
    readyToGenerate: Boolean(parsed.readyToGenerate),
    autoGenerate: Boolean(parsed.autoGenerate),
  };
}

export async function generateWorkItems({ repoContext, prompt, skills }) {
  return generateJiraTickets({
    repoContext,
    prompt,
    promptName: 'Default',
    skills,
    messages: [{ role: 'user', content: 'Generate Jira tickets for onboarding chat feature.' }],
  });
}
