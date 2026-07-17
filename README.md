# Hungter — *The tutor that gets you.*

Hungter is an AI learning platform that combines **four AI engines** into one
tutor, personalizes teaching to *how* each student learns, and gamifies the
whole experience. It also ships **Codex**, an AI app-builder that plans, writes,
previews and deploys real projects to the student's own GitHub.

> **Note:** This README reflects the **actual, current** codebase. Earlier
> versions of this file described a Django/Python stack — that was aspirational
> and is no longer true. The real stack is **plain HTML/CSS/JS + PHP + Supabase**.

---

## Table of contents
1. [What Hungter is](#what-hungter-is)
2. [Tech stack](#tech-stack)
3. [Feature tour (every page)](#feature-tour-every-page)
4. [The 4 AI engines](#the-4-ai-engines)
5. [Codex — the AI orchestrator](#codex--the-ai-orchestrator)
6. [Authentication & the site gate](#authentication--the-site-gate)
7. [Admin dashboard](#admin-dashboard)
8. [Database (Supabase)](#database-supabase)
9. [Design system — "Neon Galaxy"](#design-system--neon-galaxy)
10. [Backend API reference](#backend-api-reference)
11. [Project structure](#project-structure)
12. [Environment variables](#environment-variables)
13. [Running locally](#running-locally)
14. [Deploying](#deploying)
15. [Business model](#business-model)

---

## What Hungter is
- **One tutor, four brains.** Each question is routed to the engine best suited
  to it (deep reasoning, math/code, real-world examples, or stories/analogies).
- **Learns how you learn.** Visual / Examples / Step-by-step / Stories styles,
  plus on-the-fly personas (ELI5, Exam mode, Socratic).
- **Gamified for retention.** Levels, XP, streaks, daily goal ring, daily
  quests, milestones, shareable achievement cards.
- **Builds real software.** Codex turns a plain-English brief into a working,
  committed, deployable app.
- **Free-first.** Mandatory Google sign-in, free during launch; paid tiers unlock
  more.

---

## Tech stack
| Layer | Technology |
|---|---|
| Frontend | Plain **HTML + CSS + vanilla JS** (no framework) |
| Primary backend | **PHP** (`api/*.php`), built around a shared `api/_config.php` library |
| Local/dev backend | **Node.js** `server.js` (built-in `http`, no Express) |
| Serverless option | **Netlify Functions** (`netlify/functions/api/*.js`) |
| Database | **Supabase (Postgres)** — auto-provisions its own schema; MySQL still supported as a fallback |
| Auth | **Sign in with Google** (Google Identity Services) + session tokens; GitHub OAuth for Codex |
| AI providers | Groq, Google Gemini, OpenAI, Anthropic — behind 4 branded engines with fallback chains |
| Payments | RapidPay checkout flow (stub; billing hardening pending) |
| Fonts | Space Grotesk (display), Manrope (body), Space Mono (mono) |
| PWA | `manifest.json` + `sw.js` (network-first service worker) |

The PHP layer is dialect-portable: `api/_config.php` speaks MySQL by default and
**auto-translates to Postgres** when Supabase is configured, so the same queries
run on either database.

---

## Feature tour (every page)
| Page | What it does |
|---|---|
| `index.html` | Landing page — animated live engine-routing demo, real-time activity pulse, pricing, sticky mobile CTA. |
| `signin.html` | Clean, no-nav **Sign in with Google** gate — the entry point to everything. |
| `dashboard.html` | Student home — level hero with **daily goal ring** (+confetti), XP breakdown, streaks, stat tiles, insights, quests, badges, weak topics, mistake bank. |
| `chat.html` | Main AI chat — 4 engines + Auto + **All-4 compare**, streaming, markdown/math (KaTeX), **voice input**, file/image attach, **study personas**, inline **Mermaid diagrams**, follow-up chips, stop/regenerate/copy, and **saved chat history** (search/pin/rename). |
| `codex.html` | **AI app-builder / orchestrator** — chat on the left, live app preview + code on the right (see below). |
| `quiz.html` | AI-generated multiple-choice quizzes with scoring and XP. |
| `guess-papers.html` | Exam-style solvable papers, auto-grading, weak-area analysis. |
| `learn.html` | Guided learning interface. |
| `subjects.html` | Browse all subjects. |
| `progress.html` | Detailed stats and history. |
| `books.html` / `book.html` | Store-quality book catalog + Amazon-style product pages, AI chapter notes & flashcards. |
| `flashcards.html` | Spaced-repetition flashcards, auto-generated from chats and books. |
| `profile.html` | User settings, avatar, plan. |
| `onboarding.html` | New-user setup. |
| `checkout.html` | Plan checkout (RapidPay stub). |
| `admin.html` | Owner control panel — analytics graphs, users, grant access, geography (see below). |
| `about / contact / faq / privacy / terms / 404` | Standard support & legal pages. |

Gamification is shared across pages via `script.js` (levels `Newbie → Learner →
Explorer → Scholar → Master`, XP, streaks, quests) and `celebrate.js` (confetti +
shareable cards). Navigation, the top progress bar, and the **auth gate** are
injected by `layout.js`.

---

## The 4 AI engines
| Engine | Brand | Native provider | Best for |
|---|---|---|---|
| 🟢 Reasoner | **Groq** | `groq` (Llama 3.3) | Deep explanations, reasoning |
| 🟠 Solver | **Gemini** | `gemini` | Math, code, step-by-step |
| 🔵 Explorer | **ChatGPT** | `openai` (GPT-4o) | Real-world examples, research |
| 🟣 Storyteller | **Claude** | `anthropic` (Claude Sonnet) | Stories, analogies, creative |

Each engine has a **fallback chain**: it uses its native provider when that API
key is set, otherwise it transparently falls back to whatever is available
(usually Groq). The UI **always shows the real model that answered** (e.g.
"Claude (via Groq)") and points the owner to `/api/setup.php` to add keys. Add a
provider key and that engine instantly becomes real.

---

## Codex — the AI orchestrator
Describe an app in plain English → four engines plan, build, review and test it →
you get a **live, running preview** and it's **committed to your GitHub**.

**Flow:** connect GitHub → describe a project → watch the pipeline
**🧭 Planned → 🛠 Built → 🔍 Reviewed → 🧪 Tested → 🚀 Shipped** → a split screen
shows the chat on the left and, on the right, a **live preview**, a **Code** tab
(file tree + viewer), and buttons to **download ZIP**, open the **GitHub repo**,
or **🚀 Deploy** to a live GitHub Pages URL.

- One **Lead Engineer** authors the whole project as a single coherent,
  self-contained app (web builds are a self-contained `index.html`), so files
  never reference missing pieces and the preview always runs.
- **Reviewer / Tester / Teacher** add a code review, test cases, and a plain-
  language explanation.
- **Conversational:** greetings get a reply, not a fake build. After the first
  build the composer becomes "ask for a change" and iterates on the same repo;
  **Fix mode reads your existing repo** first.
- **Saved history** (reopen/search/pin/rename), confetti + shareable card on a
  fresh ship, and honest per-engine model labels.

Backend: `api/codex.php` (build, `action=deploy` for Pages). Requires the
repo-scoped GitHub token from `api/github-callback.php`.

---

## Authentication & the site gate
- **Sign in with Google** (`api/auth/google.php`) verifies the Google ID token
  **server-side** (audience, issuer, expiry, verified email) before creating a
  session. The Google Client ID is public; no secret is stored in the repo.
- **`layout.js` enforces a site-wide gate** — every app page redirects to
  `/signin.html` without a session token. Landing + legal pages stay public.
- Sessions use bearer tokens stored in `auth_sessions` (`mm_create_session` /
  `mm_current_user`). A legacy email/password system (`api/auth/*`) also exists.
- **GitHub OAuth** (`api/github-callback.php`, `repo` scope) powers Codex; the
  access token is kept in a signed, httponly cookie only the server reads.

---

## Admin dashboard
Served at `admin.html` (point `admin.hungter.com` at the same app, or use
`/admin`). **Username/password login** — seeded `admin` / `Faaz12345` (hashed;
override with `ADMIN_SEED_PASSWORD`). Signed 7-day admin tokens; login is
rate-limited against brute force.

Tabs:
- **Overview** — live stat tiles + 14-day canvas charts (chats, sign-ups, active
  users), top subjects, MRR / paying / total users.
- **Users** — full list (email, plan, level, joined), search, **delete account**,
  one-click **Free Pro** grant.
- **Access & Admins** — **grant free access by email** (any tier at $0), and
  **create more admins**.
- **Geography** — country breakdown (from the Cloudflare `CF-IPCountry` header).

Backend: `api/admin-api.php` (JSON, token-gated). CORS allows the admin subdomain.

---

## Database (Supabase)
The app is pre-wired to a Supabase Postgres project and **creates its own tables
on first run** from `supabase/schema.sql` (idempotent).

**To connect:** add your DB password to the server `.env`:
```
SUPABASE_DB_PASSWORD=your-supabase-db-password
```
On IPv4-only hosts (e.g. Hostinger) use Supabase's **Session pooler** — see
[`SUPABASE-SETUP.md`](SUPABASE-SETUP.md). Requires the PHP `pdo_pgsql` extension.
Verify at `/api/diag` (reports driver, provider, connection, user count).

Tables: `users`, `visitor_sessions`, `chats`, `auth_sessions`, `api_rate_limits`,
`ai_usage_daily`, `auth_challenges`, `book_orders`, `admins`.

To use MySQL instead, set the `MYSQL_*` / `DB_*` variables and leave the Supabase
ones unset.

---

## Design system — "Neon Galaxy"
Neon sci-fi glass on deep space. **All colors come from `brand.css` variables —
never hardcode.**

| Token | Value | Use |
|---|---|---|
| `--lime` | `#C8FF4D` | **Primary brand color** — buttons, bars, glows |
| `--cyan` | `#4DF0FF` | Second gradient stop, links |
| `--bg` / `--bg-deep` | `#070B1A` / `#04060F` | Deep-space background |
| `--gradient-brand` | lime → cyan | Buttons, headings, progress bars |
| `--gradient-aurora` | violet/cyan/lime radial | Page background glow |

Fonts: Space Grotesk (display), Manrope (body), Space Mono (mono). Glass cards
(`--surface` + blur + soft glow), a 4px lime→cyan top progress bar on every page,
branded scrollbars, tabular numerals, and `prefers-reduced-motion` support.

---

## Backend API reference
All under `/api/` (clean URLs map to `.php` via `.htaccess`; also mirrored as
Netlify functions). Key endpoints:

| Endpoint | Purpose |
|---|---|
| `GET /api/status` | Server health + live engine status + stats |
| `GET /api/diag` | Full self-check (AI keys, DB driver/connection, etc.) |
| `POST /api/visit` | Track a visitor (+ country) |
| `POST /api/chat` | Chat with the routed engine(s) |
| `POST /api/quiz` · `/api/quiz-question` | AI quizzes |
| `POST /api/guess-paper` · `/api/guess-paper-grade` | Exam papers + grading |
| `POST /api/explain-check` | "Explain it back" feedback + bonus XP |
| `POST /api/codex` | Codex build/fix; `action=deploy` enables GitHub Pages |
| `GET /api/auth/google.php` | Verify Google token → session |
| `api/auth/login\|logout\|me\|signup\|verify-email\|reset-password` | Email auth |
| `api/github-callback.php` | GitHub OAuth for Codex |
| `api/admin-api.php` | Admin: login, overview, users, grant, delete_user, create_admin, geography |
| `api/setup.php` | Owner: add provider API keys (validated live before saving) |
| `api/book-order.php` · `book-flashcards.php` · `chapter-notes.php` | Books |
| `api/subscription.php` | Plan status |

---

## Project structure
```
*.html                 Pages (see feature tour)
brand.css              Design tokens (colors, fonts, radii) — source of truth
nav.css styles.css     Global + navigation styles
landing.css dashboard.css chat.css …  Page styles
script.js              Shared logic: levels, XP, streaks, quests, ls helpers
layout.js              Nav + top bar + auth gate (shared)
convos.js              Saved-conversation store + history drawer (chat & codex)
celebrate.js           Confetti + shareable achievement cards
fx.js                  Scroll-reveal, count-up, tilt micro-interactions
chat-app.js app.js     Chat + shared app JS
sw.js manifest.json    PWA
server.js backend.js   Node dev server
api/_config.php        Shared PHP library (DB, AI routing, auth, rate limits)
api/*.php              PHP endpoints
api/auth/*.php         Auth endpoints (Google + email)
netlify/functions/…    Serverless mirror
supabase/schema.sql    Postgres schema (auto-applied)
SUPABASE-SETUP.md      DB setup guide
.htaccess netlify.toml Routing, clean URLs, security headers
```

---

## Environment variables
Set on the server (in `.env`) — **never commit secrets**:

```bash
# AI providers (add any; each unlocks its engine)
GROQ_API_KEY=...
GEMINI_API_KEY=...
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...

# Database — Supabase (preferred)
SUPABASE_DB_PASSWORD=...
# optional overrides for IPv4 / pooler:
# SUPABASE_DB_HOST=aws-0-<region>.pooler.supabase.com
# SUPABASE_DB_PORT=5432
# SUPABASE_DB_USER=postgres.<ref>
# or a full URL:  SUPABASE_DB_URL=postgres://...
# …or MySQL instead:  MYSQL_HOST / MYSQL_DATABASE / MYSQL_USER / MYSQL_PASSWORD

# Auth
GOOGLE_CLIENT_ID=...            # has a built-in default
GITHUB_CLIENT_ID=...            # has a built-in default
GITHUB_CLIENT_SECRET=...        # required for Codex GitHub sign-in

# Admin
ADMIN_KEY=...                   # strong random string (signs admin tokens)
ADMIN_SEED_PASSWORD=...         # overrides the default 'Faaz12345'
```
The easiest way to add AI keys is the owner page `/api/setup.php`, which
validates each key live with the provider before saving.

---

## Running locally
```bash
npm install
echo "GROQ_API_KEY=your-key-here" > .env   # at minimum
node server.js
# open http://localhost:3000
```
The PHP endpoints run on any PHP host (Apache/LiteSpeed/Hostinger); `node
server.js` provides an equivalent local dev backend. Clean URLs (`/about` →
`about.html`) work via `.htaccess`.

---

## Deploying
- **PHP host (recommended, e.g. Hostinger):** upload the repo; `.htaccess`
  handles HTTPS, clean URLs, security headers, and maps `/api/x` → `api/x.php`.
  Enable `pdo_pgsql`, set `.env`, done.
- **Netlify:** `netlify.toml` routes `/api/*` to the Node functions in
  `netlify/functions/`.
- After every deploy, bump `CACHE` in `sw.js` so the service worker serves fresh
  files.
- For **Codex GitHub sign-in**, set the OAuth app's callback to
  `https://<your-domain>/api/github-callback.php` and add `GITHUB_CLIENT_SECRET`.
- For **Google sign-in**, add your domain(s) to the OAuth client's *Authorized
  JavaScript origins*.

---

## Business model
| Plan | Price | Highlights |
|---|---|---|
| Free | $0 | Free during launch |
| Student | $5/mo | Unlimited messages, every subject, all 4 engines |
| Family | $12/mo | Multiple accounts |
| School | $200/mo | Classroom seats + teacher tools |

Owners can grant any tier for **free** to any email from the admin panel.

---

*Built with the Neon Galaxy design system. Lime `#C8FF4D` on deep space. The
tutor that gets you.*
