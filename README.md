# LegalLens AI — GenAI-Powered Legal Assistance & Access

**Live Demo:** https://legallens-ai-3-mmu7.onrender.com/

LegalLens AI helps everyday people understand, compare, and navigate legal
documents — contracts, rental agreements, terms of service, policies — without
needing a law degree. It does **not** give legal advice; it gives people the
information and language they need to make decisions and to talk to a real
lawyer more effectively.

## Problem it solves
Legal documents are full of dense, specialized language that most people
cannot parse quickly. This creates a real access-to-justice gap: people sign
things they don't understand, miss risky clauses, and don't know what
questions to ask a lawyer. LegalLens AI closes that gap with six focused
GenAI-powered tools built around the challenge's suggested use cases.

## Features (mapped to the challenge's use cases)

| Feature | Use case it addresses |
|---|---|
| **Simplify** | Turns a dense clause/document into plain-language explanation | Simplifying complex legal documents |
| **Compare** | Diffs two contracts/policies and explains what changed and why it matters | Comparing contracts, agreements, or policies |
| **Analyze / Highlight Risks** | Extracts obligations, deadlines, risky clauses, and inconsistencies | Highlighting important clauses, obligations, risks |
| **Ask** | Q&A grounded only in the pasted document (won't answer from outside knowledge) | Answering questions based on provided legal documents |
| **Checklist** | Produces an actionable checklist / next-steps list | Generating summaries, checklists, or actionable outputs |
| **Prep for Lawyer** | Generates a one-page brief + question list to bring to an actual attorney | Helping users prepare for a legal professional |

Every AI response ends with a visible disclaimer: *"This is general
information, not legal advice. Consult a licensed attorney for advice on your
specific situation."* This is enforced in the system prompt AND rendered in
the UI, so it can't be silently dropped.

## Architecture
```
Browser (public/index.html, script.js)
        │  fetch (JSON)
        ▼
Express server (server.js)
        │  - validates & size-limits input
        │  - rate-limits requests
        │  - builds a task-specific system prompt
        ▼
Anthropic Messages API (claude-sonnet-4-6)
```
The API key lives **only** on the server (`.env`), never in client code —
this was a deliberate security decision (see below).

## GenAI service used
- **Groq API** (`llama-3.3-70b-versatile`, OpenAI-compatible
  `/openai/v1/chat/completions` endpoint), called server-side from
  `server.js`. Used for all six features above: each sends a task-specific
  system prompt plus the user's document/question and returns structured,
  plain-language output. Groq was chosen for its free tier and low-latency
  inference, which keeps the app fully usable without requiring billing setup.

## Run it locally
```bash
npm install
cp .env.example .env        # then add your GROQ_API_KEY
npm start                   # http://localhost:3000
```

## Run tests
```bash
npm test
```

## Deploy (free options)
- **Render.com**: New Web Service → connect this repo → Build: `npm install`
  → Start: `node server.js` → add env var `GROQ_API_KEY`.
- **Railway.app**: New Project → Deploy from GitHub → add env var
  `GROQ_API_KEY`.
- Avoid Vercel/Netlify static hosting alone — this app needs a persistent
  Node server for the `/api/*` routes (or convert them to serverless
  functions if your platform requires that).

## How this maps to the evaluation criteria

- **Problem Statement Alignment (High Impact):** every feature traces
  directly to a listed use case (table above); the app explicitly frames
  itself as *assistance*, not legal advice, per the challenge's note.
- **Code Quality (High Impact):** small, single-purpose Express routes;
  shared prompt-building logic factored out (`prompts.js`); no dead code;
  consistent naming; comments only where intent isn't obvious from the code.
- **Security (Medium Impact):** GenAI API key server-side only; `helmet` for HTTP
  headers; `express-rate-limit` to throttle abuse; strict input length caps;
  no document content is logged or persisted; CORS restricted to same origin.
- **Efficiency (Medium Impact):** gzip compression on all responses; static
  assets served with cache headers; per-task output token budgets instead of
  one flat limit, so short answers (ask, checklist) don't pay for unused
  tokens; a bounded in-memory response cache (10-min TTL, 100-entry cap) so
  identical repeat requests skip the model call entirely; input text is
  whitespace-normalized before hashing/sending, which both raises the cache
  hit rate and trims a few unnecessary tokens per request; a 20s request
  timeout so a stalled upstream call can't hold a connection open
  indefinitely; tuned keep-alive/headers timeouts for the platform's proxy.
- **Testing (Low Impact):** `tests/server.test.js` covers input validation
  (missing fields, over-length input, unknown task), rate limiting via
  route-level checks, each route's happy path with the model call mocked (no
  real API key needed to run tests), the static frontend being served, and
  that security headers are actually applied — 13 tests total, all passing.
- **Accessibility (Low Impact):** semantic HTML, labeled form controls,
  visible focus states, `aria-live` region for AI output, sufficient color
  contrast, fully keyboard-operable.

## Repo size
Text-only source (~30 KB). No binaries, no `node_modules` committed
(`.gitignore` excludes it) — well under the 10 MB limit.

## Limitations & honest scope
- Document upload currently accepts pasted text (most reliable, smallest
  footprint); PDF/DOCX text-extraction can be added with `pdf-parse`/`mammoth`
  if the round allows a larger dependency footprint.
- This is a hackathon prototype: no user accounts, no persistence layer —
  by design, so no document ever leaves the request/response cycle.
