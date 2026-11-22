import express from 'express';
import { body } from 'express-validator';
import { authenticateUser } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { LANGUAGES } from '../../shared/i18n/languages.js';
import { chat } from '../services/disha.js';

const router = express.Router();

// Signed-in passengers only: Disha greets them by name, and the AI keys can't be abused anonymously.
router.use(authenticateUser);

const dishaLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  key: (req) => String(req.user._id),
  message: 'Disha needs a short break. Try again in a minute.'
});

// Chat with Disha. The app sends the visible conversation; the server keeps no chat state.
router.post('/chat', dishaLimiter, [
  body('messages').isArray({ min: 1, max: 40 }),
  body('messages.*.role').isIn(['user', 'assistant']),
  body('messages.*.content').isString().trim().isLength({ min: 1, max: 2000 }),
  body('location.lat').optional().isFloat({ min: -90, max: 90 }),
  body('location.lng').optional().isFloat({ min: -180, max: 180 }),
  body('language').optional().isIn(LANGUAGES.map((l) => l.code))
], validate, async (req, res) => {
  const { messages, location, language } = req.body;
  if (messages.at(-1).role !== 'user') return res.status(400).json({ message: 'The last message must be from the user' });
  try {
    const result = await chat({
      user: req.user,
      messages,
      location: location?.lat != null && location?.lng != null ? { lat: Number(location.lat), lng: Number(location.lng) } : null,
      language
    });
    res.json(result);
  } catch (error) {
    if (!error.status) throw error;
    res.status(error.status).json({ message: error.message });
  }
});

export default router;
