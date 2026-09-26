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

test.after(() => {
  global.fetch = realFetch;
});
