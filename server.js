'use strict';

require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { isValidTask, buildSystemPrompt, TASKS } = require('./prompts');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Security ---------------------------------------------------------
app.use(helmet());
app.use(cors({ origin: false })); // same-origin only; the frontend is served by this app
app.use(express.json({ limit: '200kb' })); // caps payload size (efficiency + security)

const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 15,             // 15 requests/minute/IP is plenty for a demo, blocks abuse
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a moment and try again.' },
});
app.use('/api/', apiLimiter);

// --- Static frontend ----------------------------------------------------
app.use(express.static(path.join(__dirname, 'public')));

// --- Input limits (efficiency: predictable token usage / latency) -------
const MAX_INPUT_CHARS = 20000; // roughly enough for a multi-page contract clause set

function validatePayload(body) {
  if (!body || typeof body !== 'object') return 'Missing request body.';
  const { task, text, textB, question } = body;
  if (!isValidTask(task)) return `Unknown task. Valid tasks: ${Object.keys(TASKS).join(', ')}`;
  if (!text || typeof text !== 'string' || !text.trim()) return 'Field "text" is required.';
  if (text.length > MAX_INPUT_CHARS) return `"text" exceeds ${MAX_INPUT_CHARS} characters.`;
  if (task === 'compare' && (!textB || typeof textB !== 'string' || !textB.trim())) {
    return 'Task "compare" requires "textB" (the second document).';
  }
  if (textB && textB.length > MAX_INPUT_CHARS) return `"textB" exceeds ${MAX_INPUT_CHARS} characters.`;
  if (task === 'ask' && (!question || typeof question !== 'string' || !question.trim())) {
    return 'Task "ask" requires a "question".';
  }
  return null;
}

function buildUserMessage(body) {
  const { task, text, textB, question } = body;
  if (task === 'compare') {
    return `Document A:\n"""${text}"""\n\nDocument B:\n"""${textB}"""`;
  }
  if (task === 'ask') {
    return `Document:\n"""${text}"""\n\nQuestion: ${question}`;
  }
  return `Document:\n"""${text}"""`;
}

// --- Core API route -------------------------------------------------------
app.post('/api/legal-assist', async (req, res) => {
  const validationError = validatePayload(req.body);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY. See .env.example.' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        system: buildSystemPrompt(req.body.task),
        messages: [{ role: 'user', content: buildUserMessage(req.body) }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API error:', response.status, errText);
      return res.status(502).json({ error: 'The AI service returned an error. Please try again.' });
    }

    const data = await response.json();
    const textOut = (data.content || [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');

    return res.json({ result: textOut });
  } catch (err) {
    console.error('Request failed:', err.message);
    return res.status(500).json({ error: 'Something went wrong processing your request.' });
  }
});

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`LegalLens AI running on http://localhost:${PORT}`);
  });
}

module.exports = app; // exported for tests
