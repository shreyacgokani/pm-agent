import { Router } from 'express';
import { getTtsConfig, synthesizeSpeech } from '../services/tts.js';

const router = Router();

router.get('/config', (_req, res) => {
  const { model, voice } = getTtsConfig();
  res.json({
    provider: 'openai',
    model,
    voice,
    available: Boolean(process.env.OPENAI_API_KEY),
  });
});

router.post('/', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text?.trim()) {
      return res.status(400).json({ error: 'Text is required' });
    }

    const audio = await synthesizeSpeech(text);
    res.set({
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-store',
    });
    res.send(audio);
  } catch (err) {
    console.error('TTS error:', err);
    res.status(500).json({ error: err.message || 'Failed to synthesize speech' });
  }
});

export default router;
