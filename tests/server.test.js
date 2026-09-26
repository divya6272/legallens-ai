'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { isValidTask, buildSystemPrompt, TASKS } = require('../prompts');

test('isValidTask accepts all documented tasks', () => {
  for (const key of Object.keys(TASKS)) {
    assert.strictEqual(isValidTask(key), true);
  }
});

test('isValidTask rejects unknown task', () => {
  assert.strictEqual(isValidTask('delete-everything'), false);
  assert.strictEqual(isValidTask(''), false);
  assert.strictEqual(isValidTask(undefined), false);
});

test('every system prompt includes the mandatory disclaimer instruction', () => {
  for (const key of Object.keys(TASKS)) {
    const prompt = buildSystemPrompt(key);
    assert.match(prompt, /not legal advice/i);
  }
});

test('every system prompt forbids claiming to be a lawyer', () => {
  for (const key of Object.keys(TASKS)) {
    const prompt = buildSystemPrompt(key);
    assert.match(prompt, /never state or imply you are a lawyer/i);
  }
});

// --- Route-level tests -----------------------------------------------------
// server.js calls the global `fetch` to reach the Anthropic API. We swap that
// global for a fake *only inside server.js's own call*, while tests use the
// original, real fetch to talk to our local test server (they're the same
// global, so we distinguish by URL instead of blindly replacing it).
process.env.GROQ_API_KEY = 'test-key';
const realFetch = global.fetch;

function mockAnthropicFetch(replyText) {
  global.fetch = async (url, opts) => {
    if (typeof url === 'string' && url.includes('api.groq.com')) {
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: replyText } }] }),
      };
    }
    return realFetch(url, opts);
  };
}

test('POST /api/legal-assist returns 400 for missing text', async () => {
  mockAnthropicFetch('irrelevant');
  const app = require('../server');
  const server = app.listen(0);
  const { port } = server.address();

  const res = await fetch(`http://localhost:${port}/api/legal-assist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task: 'simplify' }),
  });
  assert.strictEqual(res.status, 400);
  server.close();
});

test('POST /api/legal-assist happy path returns AI text for a valid simplify request', async () => {
  mockAnthropicFetch('Plain language summary.\n\nDisclaimer: This is general information, not legal advice. Consult a licensed attorney for advice on your specific situation.');
  const app = require('../server');
  const server = app.listen(0);
  const { port } = server.address();

  const res = await fetch(`http://localhost:${port}/api/legal-assist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task: 'simplify', text: 'The lessee shall indemnify the lessor.' }),
  });
  const data = await res.json();
  assert.strictEqual(res.status, 200);
  assert.match(data.result, /Disclaimer/);
  server.close();
});

test('POST /api/legal-assist rejects compare without textB', async () => {
  mockAnthropicFetch('irrelevant');
  const app = require('../server');
  const server = app.listen(0);
  const { port } = server.address();

  const res = await fetch(`http://localhost:${port}/api/legal-assist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task: 'compare', text: 'Doc A text' }),
  });
  assert.strictEqual(res.status, 400);
  server.close();
});

test('GET /api/health returns ok', async () => {
  mockAnthropicFetch('irrelevant');
  const app = require('../server');
  const server = app.listen(0);
  const { port } = server.address();

  const res = await fetch(`http://localhost:${port}/api/health`);
  const data = await res.json();
  assert.strictEqual(res.status, 200);
  assert.strictEqual(data.status, 'ok');
  server.close();
});

test('POST /api/legal-assist rejects text over the character limit', async () => {
  mockAnthropicFetch('irrelevant');
  const app = require('../server');
  const server = app.listen(0);
  const { port } = server.address();

  const res = await fetch(`http://localhost:${port}/api/legal-assist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task: 'simplify', text: 'a'.repeat(20001) }),
  });
  assert.strictEqual(res.status, 400);
  server.close();
});

test('identical repeat requests are served from cache (second call skips the model)', async () => {
  let callCount = 0;
  global.fetch = async (url, opts) => {
    if (typeof url === 'string' && url.includes('api.groq.com')) {
      callCount += 1;
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'Cached-friendly reply.' } }] }),
      };
    }
    return realFetch(url, opts);
  };

  const app = require('../server');
  const server = app.listen(0);
  const { port } = server.address();
  const payload = { task: 'simplify', text: 'Cache me please, this is a unique test document.' };

  const first = await fetch(`http://localhost:${port}/api/legal-assist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  await first.json();

  const second = await fetch(`http://localhost:${port}/api/legal-assist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const secondData = await second.json();

  assert.strictEqual(callCount, 1, 'the upstream model should only be called once');
  assert.strictEqual(secondData.cached, true);
  server.close();
});

// --- Unit tests for pure helper functions (no server needed) ---------------
const { validatePayload, buildUserMessage } = require('../server');

test('validatePayload: accepts a valid simplify payload', () => {
  assert.strictEqual(validatePayload({ task: 'simplify', text: 'Some clause text.' }), null);
});

test('validatePayload: rejects empty body', () => {
  assert.match(validatePayload(null), /Missing request body/);
});

test('validatePayload: rejects whitespace-only text', () => {
  assert.match(validatePayload({ task: 'simplify', text: '   ' }), /required/);
});

test('validatePayload: rejects ask task without a question', () => {
  const err = validatePayload({ task: 'ask', text: 'Doc text' });
  assert.match(err, /requires a "question"/);
});

test('validatePayload: accepts ask task with a question', () => {
  assert.strictEqual(validatePayload({ task: 'ask', text: 'Doc text', question: 'What is due?' }), null);
});

test('buildUserMessage: labels both documents for compare', () => {
  const msg = buildUserMessage({ task: 'compare', text: 'A text', textB: 'B text' });
  assert.match(msg, /Document A:/);
  assert.match(msg, /Document B:/);
});

test('buildUserMessage: includes the question for ask', () => {
  const msg = buildUserMessage({ task: 'ask', text: 'Doc text', question: 'Can I cancel early?' });
  assert.match(msg, /Question: Can I cancel early\?/);
});

test('buildUserMessage: single-document tasks include only one document block', () => {
  const msg = buildUserMessage({ task: 'checklist', text: 'Doc text' });
  assert.match(msg, /^Document:/);
  assert.doesNotMatch(msg, /Document A:/);
});

test('POST /api/legal-assist rejects an unknown task', async () => {
  mockAnthropicFetch('irrelevant');
  const app = require('../server');
  const server = app.listen(0);
  const { port } = server.address();

  const res = await fetch(`http://localhost:${port}/api/legal-assist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task: 'delete-everything', text: 'hello' }),
  });
  assert.strictEqual(res.status, 400);
  server.close();
});

test('GET / serves the static frontend', async () => {
  mockAnthropicFetch('irrelevant');
  const app = require('../server');
  const server = app.listen(0);
  const { port } = server.address();

  const res = await fetch(`http://localhost:${port}/`);
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /html/);
  server.close();
});

test('security headers are present on API responses', async () => {
  mockAnthropicFetch('irrelevant');
  const app = require('../server');
  const server = app.listen(0);
  const { port } = server.address();

  const res = await fetch(`http://localhost:${port}/api/health`);
  assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
  server.close();
});

test.after(() => {
  global.fetch = realFetch;
});
