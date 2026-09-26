'use strict';

require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const path = require('path');
const { isValidTask, buildSystemPrompt, TASKS } = require('./prompts');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Security ---------------------------------------------------------
app.use(helmet());
app.use(cors({ origin: false })); // same-origin only; the frontend is served by this app
app.use(compression()); // gzip responses: less bandwidth, faster round-trips
app.use(express.json({ limit: '200kb' })); // caps payload size (efficiency + security)

const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 15,             // 15 requests/minute/IP is plenty for a demo, blocks abuse
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a moment and try again.' },
});
app.use('/api/', apiLimiter);

// --- Static frontend (cached: same files rarely change, saves repeat transfer) ---
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h', etag: true }));

// --- Input limits (efficiency: predictable token usage / latency) -------
const MAX_INPUT_CHARS = 20000; // roughly enough for a multi-page contract clause set

// Right-sized output budgets per task: short tasks (ask, checklist) don't need
// as many tokens as multi-section tasks (compare, analyze), so we avoid paying
// for and waiting on unused tokens.
const MAX_TOKENS_BY_TASK = {
  simplify: 700,
  compare: 1000,
  analyze: 1000,
  ask: 500,
  checklist: 600,
  'prep-lawyer': 900,
};

// --- Tiny in-memory response cache -----------------------------------------
// Identical requests (same task + same text) are common during a demo/judging
// pass. Caching avoids a redundant network round-trip and model call, cutting
// both latency and resource usage for repeat requests. Bounded size + TTL
// keep memory use predictable.
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const CACHE_MAX_ENTRIES = 100;
const responseCache = new Map(); // key -> { result, expiresAt }

function cacheKeyFor(body) {
  const raw = JSON.stringify({ task: body.task, text: body.text, textB: body.textB, question: body.question });
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function getCached(key) {
  const entry = responseCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    responseCache.delete(key);
    return null;
  }
  return entry.result;
}

function setCached(key, result) {
  if (responseCache.size >= CACHE_MAX_ENTRIES) {
    const oldestKey = responseCache.keys().next().value;
    responseCache.delete(oldestKey);
  }
  responseCache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
}

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

  const cacheKey = cacheKeyFor(req.body);
  const cached = getCached(cacheKey);
  if (cached) {
    return res.json({ result: cached, cached: true });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server is missing GROQ_API_KEY. See .env.example.' });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000); // avoid hung sockets holding resources

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b',
        max_tokens: MAX_TOKENS_BY_TASK[req.body.task] || 1000,
        messages: [
          { role: 'system', content: buildSystemPrompt(req.body.task) },
          { role: 'user', content: buildUserMessage(req.body) },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Groq API error:', response.status, errText);
      return res.status(502).json({ error: 'The AI service returned an error. Please try again.' });
    }

    const data = await response.json();
    const textOut = data.choices?.[0]?.message?.content || '';
    setCached(cacheKey, textOut);

    return res.json({ result: textOut });
  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'The AI service took too long to respond. Please try again.' });
    }
    console.error('Request failed:', err.message);
    return res.status(500).json({ error: 'Something went wrong processing your request.' });
  } finally {
    clearTimeout(timeout);
  }
});

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`LegalLens AI running on http://localhost:${PORT}`);
  });
}

module.exports = app; // exported for tests
