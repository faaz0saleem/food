# Hungter — Project Briefing for AI Assistants

> Read this first. It gets any new AI assistant (Claude Code, Copilot, etc.)
> fully up to speed on this project instantly.

## Who's building this

A student/developer building Hungter, working solo, intermediate coding
level, using GitHub Codespaces + VS Code. No credit card — free tiers only.
Prefers fast, direct, step-by-step answers with copy-pasteable code over
long explanations. Never ask them to paste API keys into chat — they've had
keys leak/expire before (Groq, Gemini).

## What Hungter is

An AI tutor web app that:
- Combines 4 AI engines (Groq, Gemini, OpenAI GPT-4, Claude) into one smart tutor
- Personalizes teaching to HOW the student learns (Visual / Examples / Step-by-step / Stories)
- Has gamification (levels, XP, streaks, milestones)
- Targets students worldwide, especially those who can't afford private tutors

Name: **Hungter**. Tagline: *"The tutor that gets you."*

Note: `README.md` in this repo currently describes a Django/Python backend —
that is stale/aspirational and does **not** match the actual codebase, which
is Node.js with no framework. Trust this file and the code, not README.md,
for current architecture.

## Tech stack (actual, verified against code)

| Layer | Technology |
|---|---|
| Language | JavaScript (Node.js) |
| Backend | Node.js built-in `http` module (no Express) — `server.js` |
| AI Engine | `groq-sdk` (model: `llama-3.3-70b-versatile`); `@google/generative-ai` is installed but Gemini is not wired into chat yet |
| Frontend | Plain HTML + CSS + vanilla JS (no React, no Tailwind — except `chat.html`, see bugs below) |
| Fonts | Fredoka (headings), Manrope (body), Space Mono (mono) |
| Hosting | GitHub Codespaces for dev; `netlify.toml` present for planned Netlify deploy |
| Payments | Stripe — not integrated, `checkout.html` is a stub |
| Auth | Not integrated (planned: Supabase) |
| Database | `localStorage` only, no real DB |

## Design system (must follow on all pages)

```css
--bg: #1A1033;
--bg-deep: #120B26;
--surface: #2A1B4D;
--surface-2: #251746;
--border: #3D2A66;
--border-soft: rgba(255,255,255,0.06);
--lime: #C8FF4D;      /* primary accent */
--coral: #FF6B4A;     /* secondary */
--blue: #4DD8FF;      /* tertiary */
--pink: #FF4DE3;      /* quaternary */
--gold: #FFD14D;
--ink: #FFF8F0;       /* main text */
--ink-soft: #C9BFE0;  /* secondary text */
--ink-faint: #8B7FB0; /* muted text */
--font-display: 'Fredoka', sans-serif;
--font-body: 'Manrope', sans-serif;
--font-mono: 'Space Mono', monospace;
--radius: 20px;
--radius-sm: 12px;
--shadow: 6px 6px 0 var(--bg-deep);      /* "sticker" shadow style */
--shadow-sm: 4px 4px 0 var(--bg-deep);
```

Aesthetic: bold, playful, gamified — Duolingo meets Linear. Buttons use a
solid offset "sticker shadow" (never a blur shadow). Cards rotate slightly.
No gradients on buttons. Never hardcode colors — always use the CSS
variables above, defined in `brand.css`.

## File structure

```
index.html          Landing page — good, but engine status grid on it is never populated
dashboard.html       Analytics/home for students — insights hidden, level thresholds don't match server
chat.html            Main AI chat page — uses Tailwind CDN, clashes with brand.css
learn.html           Learning interface
onboarding.html      New user setup (3 steps)
quiz.html            AI-generated quizzes
progress.html        Detailed stats page
subjects.html        Browse all subjects
profile.html         User settings
checkout.html        Payment page (Stripe stub, not integrated)
signup.html          Auth page (stub, no real auth yet)
server.js            Main backend (Node http + Groq)
backend.js           Secondary/alt backend entry point
chat-app.js          Chat page JS
app.js               Shared app JS
script.js            Shared frontend logic
layout.js            Shared nav/footer rendering
brand.css            Design tokens (variables above)
nav.css              Navigation styles
styles.css           Global styles
dashboard.css        Dashboard-specific styles
landing.css          Landing page styles
checkout.css         Checkout styles
stats.json           Visitor tracking data
package.json         Dependencies (groq-sdk, @google/generative-ai, dotenv, chalk, ora)
netlify.toml         Netlify config (serverless function support added)
```

## API keys & services

- **Groq API** is the only live AI right now (`GROQ_API_KEY` in `.env`).
- Gemini SDK is installed (`@google/generative-ai`) but not wired into the
  chat flow — shown as "Coming Soon" in the UI.
- OpenAI GPT-4 and Claude are not yet connected at all.

## Backend — server.js

Routes (verified in code):
- `GET /` and `GET /*.html` — serve pages
- `GET /*.css, *.js, *.svg` — static files
- `GET /api/status` — server health + stats
- `POST /api/visit` — body `{ visitorId }`, tracks visitors
- `POST /api/chat` — body `{ message, subject, learningStyle, visitorId, userLevel }` → `{ reply, model, stats }`
- `POST /api/quiz-question` — body `{ subject }` → one MCQ question
- `POST /api/quiz` — body `{ subject, count, askedQuestions }` → array of MCQ questions

The chat prompt varies tone by `userLevel` (Newbie/Learner → simple
explanations, Explorer/Scholar → detailed, Master → advanced), but the level
*thresholds* themselves are computed client-side in `dashboard.html`, not in
`server.js` — and the two currently disagree (see bugs below).

## localStorage keys (frontend data)

```
mm_name          student's name (string)
mm_style         learning style: 'Visual' | 'Examples' | 'Step-by-step' | 'Stories'
mm_subject       last/current subject (string)
mm_level         current level name (string)
mm_count         total messages sent (number)
mm_streak        array of date strings, e.g. ['Mon Jul 01 2026']
mm_subjects      object: { Math: 12, Science: 5, ... }
mm_milestones    array of { event, date } objects
mm_quiz_scores   object: { Math: [80, 60, 100] }
mm_sessionId     unique session ID
mm_today_count   messages sent today (number)
mm_avatarColor   hex color for avatar
mm_theme         'dark' (default)
```

## The 4 AI engines (concept — only Groq is actually live)

| Engine | Name | AI Model | Best for |
|---|---|---|---|
| 🟢 | Reasoner | Groq Llama 3.3 | Deep explanations, reasoning |
| 🟠 | Solver | Gemini Flash | Math, coding, step-by-step |
| 🔵 | Explorer | GPT-4o | Real-world examples, research |
| 🟣 | Storyteller | Claude Sonnet | Stories, analogies, creative |

Planned routing logic (not implemented yet — server always uses Groq):
- Math/Coding/Physics → Solver
- Learning style = Stories → Storyteller
- Complex concepts → Reasoner
- Real-world examples needed → Explorer

## Pages status

| Page | Status | Issue |
|---|---|---|
| index.html | Good | Engine status grid empty |
| dashboard.html | Mostly good | Insights hidden (`#insightsContainer` forced `display:none`), level thresholds don't match what `server.js` assumes |
| chat.html | Broken design | Loads `https://cdn.tailwindcss.com`, clashes with the rest of the site's brand.css design system |
| onboarding.html | OK | — |
| quiz.html | Working | — |
| progress.html | Good | — |
| subjects.html | OK | — |
| profile.html | OK | — |
| checkout.html | Stub | No real Stripe integration |
| signup.html | Stub | No real auth (Supabase planned) |

## Known bugs, in priority order

1. `chat.html` uses Tailwind CDN instead of `brand.css` — needs a full rewrite to match the rest of the site.
2. `quiz.html`, `progress.html`, `learn.html`, and `subjects.html` still load Tailwind CDN and should be migrated to `brand.css` + local styles.
3. `dashboard.html` level thresholds must stay aligned with `script.js` (`Newbie/Learner/Explorer/Scholar/Master`).
4. `chat.html` must keep writing localStorage stats (`mm_count`, etc.) after messages so dashboards stay accurate.
5. `layout.js` must keep populating the landing page engine status grid from `/api/status`.
6. `checkout.html` currently uses RapidPay checkout session flow; production billing hardening and webhook monitoring are still needed before launch.

## Business model

| Plan | Price | Cost/user | Profit |
|---|---|---|---|
| Free | $0 | ~$0.30/mo | — |
| Student | $5/mo | ~$0.30/mo | $4.70 |
| Family | $12/mo | ~$0.90/mo | $11.10 |
| School | $200/mo | ~$15/mo | $185 |

Estimated API cost per user at 100 msgs/month once all 4 engines are live:
Groq $0.04 (70% of msgs), Claude $0.12 (10%), Gemini $0.01 (10%), GPT-4o
$0.10 (10%) — total ~$0.30/user/month.

## Development rules

1. No extra npm installs unless truly necessary.
2. No React, no Tailwind, no component frameworks.
3. All pages must use `brand.css` + `nav.css` + `styles.css`.
4. All pages must have the shared nav built by `layout.js`.
5. All pages must have the 4px top progress bar (lime → blue gradient).
6. Level badge must show in nav on all inner pages.
7. Mobile responsive — must work on phones.
8. All changes must work with `node server.js`.
9. Never hardcode colors — always use CSS variables from `brand.css`.

## How to run

```bash
npm install
echo "GROQ_API_KEY=your-key-here" > .env
node server.js
# open http://localhost:3000
```

## What to build next, in order

1. Fix `chat.html` design (rewrite without Tailwind).
2. Fix `dashboard.html` bugs (insights + level thresholds).
3. Wire up localStorage updates in `chat.html`.
4. Add multi-engine routing to `server.js`.
5. Add Supabase auth (signup/login).
6. Integrate Stripe payments.
7. Add Claude + Gemini + GPT-4o API keys and wire them into `server.js`.
8. Deploy to Netlify/Vercel.

## Working style

- Work step by step — give one thing at a time, not everything at once.
- Give actual code to copy-paste, not just explanations.
- When writing prompts for GitHub Copilot, be very specific and detailed.
- The repo/folder may be called `food` or `food-main` — ignore the name, it's Hungter.
