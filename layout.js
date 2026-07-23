// Register service worker globally
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

(function () {
  window.HUNGTER_API_BASE = window.HUNGTER_API_BASE || '';
  const API_BASE = String(window.HUNGTER_API_BASE || '').replace(/\/$/, '');
  function apiPath(path) {
    const clean = String(path || '').startsWith('/') ? String(path) : `/${path}`;
    return `${API_BASE}${clean}`;
  }

  // ── Auth gate DISABLED by default ───────────────────────────────────────────
  // Forced sign-in was removed because it looped users back to /signin. It can be
  // turned back on from Admin → Settings → "Force sign-in" (force_login), handled
  // in the site-settings consumer below. Do NOT hard-code a redirect here.

  // ── Site settings consumer (admin-controlled) ───────────────────────────────
  // Reads the public settings and applies owner toggles: maintenance mode, the
  // announcement banner, and the optional force-login gate. Fails silently so a
  // missing/broken settings file never takes the site down.
  (function siteSettings() {
    const path = (location.pathname || '').toLowerCase();
    // Never gate or black-out the admin panel or the settings endpoint itself.
    if (path.indexOf('/admin') === 0 || location.hostname.indexOf('admin.') === 0) return;
    function applySettings(s) {
        if (!s) return;

        // 1) Maintenance mode — full-page takeover for visitors.
        if (s.maintenance_mode) {
          document.documentElement.innerHTML =
            '<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#04060F;color:#F2F5FF;font-family:Manrope,sans-serif;text-align:center;padding:24px;">' +
            '<div><div style="font-size:2.4rem;margin-bottom:10px;">🛠️</div>' +
            '<h1 style="font-family:Space Grotesk,sans-serif;">' + (s.site_name || 'Hungter') + '</h1>' +
            '<p style="color:#A9B2D6;max-width:420px;line-height:1.6;">' + (s.maintenance_message || 'Down for maintenance — back shortly.') + '</p></div></body>';
          return;
        }

        // 2) Announcement banner.
        if (s.announcement_enabled && s.announcement_text) {
          const bar = document.createElement('div');
          bar.id = 'hg-announce';
          bar.style.cssText = 'position:relative;z-index:50;text-align:center;padding:9px 40px;font-family:Manrope,sans-serif;font-size:0.86rem;font-weight:600;color:#04060F;background:linear-gradient(120deg,#C8FF4D,#4DF0FF);';
          const inner = s.announcement_link
            ? '<a href="' + s.announcement_link + '" style="color:#04060F;text-decoration:underline;">' + s.announcement_text + '</a>'
            : s.announcement_text;
          bar.innerHTML = inner + '<button aria-label="Dismiss" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;color:#04060F;cursor:pointer;font-size:1rem;">✕</button>';
          bar.querySelector('button').addEventListener('click', () => bar.remove());
          if (document.body) document.body.insertBefore(bar, document.body.firstChild);
        }

        // 3) Optional force-login gate (off by default).
        if (s.force_login) {
          const PUBLIC = ['', 'index', 'pricing', 'books', 'book', 'signin', 'signup', 'privacy', 'terms', 'faq', 'contact', 'about', 'complaints', '404', 'verify-email', 'reset-password', 'select-plan',
            'ai-tutor-chat', 'ai-quizzes', 'smart-flashcards', 'practice-papers', 'ai-app-builder', 'progress-tracking', 'ai-engines'];
          if (path === '/books' || path.indexOf('/books/') === 0) return;
          const file = (location.pathname.split('/').pop() || '').replace(/\.html$/, '').toLowerCase();
          if (PUBLIC.indexOf(file) >= 0) return;
          let token = null; try { token = JSON.parse(localStorage.getItem('mm_auth_token') || 'null'); } catch (e) {}
          if (!token) location.replace('/signin');
        }
    }

    // Cache settings for 5 min in sessionStorage so navigating between pages
    // doesn't refetch on every load — a real speed win across the site.
    const CACHE_KEY = 'hg_settings_v1';
    let cached = null;
    try { cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null'); } catch (e) {}
    if (cached && cached.t && (Date.now() - cached.t) < 300000 && cached.s) {
      applySettings(cached.s);
      return;
    }
    fetch(apiPath('/api/settings.php'))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const s = d && d.settings; if (!s) return;
        try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), s: s })); } catch (e) {}
        applySettings(s);
      })
      .catch(() => {});
  })();

  // ── Plan gate — paid-only features blur behind an upgrade wall for Free ──────
  // Rank: free < student < pro. Pages list the minimum plan they need.
  const PAID_PAGES = { 'codex': 'pro', 'guess-papers': 'pro' };
  const PLAN_RANK = { preview: 0, free: 0, student: 1, pro: 2, family: 2, school: 2 };
  const FEATURE_LABEL = { 'codex': 'the Codex AI app builder', 'guess-papers': 'Solvable Guess Papers' };
  (function planGate() {
    const file = (location.pathname.split('/').pop() || '').replace(/\.html$/, '').toLowerCase();
    const need = PAID_PAGES[file];
    if (!need) return;

    function overlay(inner, blurOnly) {
      let o = document.getElementById('planGate');
      if (!o) { o = document.createElement('div'); o.id = 'planGate'; document.body.appendChild(o); }
      o.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(4,6,15,0.6);-webkit-backdrop-filter:blur(9px);backdrop-filter:blur(9px);';
      o.innerHTML = inner;
      return o;
    }
    // Blur immediately so the locked content is never usable while we check.
    overlay('<div style="color:#A9B2D6;font-family:sans-serif;">Checking your plan…</div>');

    function showUpgrade() {
      const label = FEATURE_LABEL[file] || 'this feature';
      overlay('<div style="max-width:430px;text-align:center;background:var(--surface-solid,#0D1428);border:1px solid var(--border-glow,rgba(200,255,77,0.35));border-radius:18px;padding:34px 28px;box-shadow:0 8px 32px rgba(0,0,0,0.5);">'
        + '<div style="font-size:2.6rem;">🔒</div>'
        + '<h2 style="font-family:var(--font-display,sans-serif);margin:12px 0 8px;color:var(--ink,#F2F5FF);">A Pro feature</h2>'
        + '<p style="color:var(--ink-soft,#A9B2D6);line-height:1.6;margin:0 0 20px;">' + label + ' is included with <strong style="color:var(--cyan,#4DF0FF)">Pro</strong>. Upgrade to unlock it — plus $30/month of AI.</p>'
        + '<a href="/checkout?plan=pro" style="display:inline-block;background:var(--gradient-brand,linear-gradient(120deg,#C8FF4D,#4DF0FF));color:#070B1A;font-family:var(--font-display,sans-serif);font-weight:700;border-radius:999px;padding:13px 30px;text-decoration:none;">Upgrade to Pro →</a>'
        + '<div style="margin-top:16px;"><a href="/dashboard" style="color:var(--ink-faint,#5F6A94);font-size:0.86rem;text-decoration:none;">← Back to dashboard</a></div>'
        + '</div>');
    }

    let token = null;
    try { token = JSON.parse(localStorage.getItem('mm_auth_token') || 'null'); } catch (e) {}
    fetch(apiPath('/api/credits.php'), { headers: token ? { Authorization: 'Bearer ' + token } : {} })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        const plan = String((d && d.plan) || 'free').toLowerCase();
        if ((PLAN_RANK[plan] || 0) >= PLAN_RANK[need]) {
          const o = document.getElementById('planGate'); if (o) o.remove(); // has access
        } else { showUpgrade(); }
      })
      .catch(showUpgrade);
  })();

  // Reusable plan check + upgrade wall for in-page actions (e.g. All-4 mode).
  window.HungterPlan = {
    check: function (need) {
      let token = null; try { token = JSON.parse(localStorage.getItem('mm_auth_token') || 'null'); } catch (e) {}
      return fetch(apiPath('/api/credits.php'), { headers: token ? { Authorization: 'Bearer ' + token } : {} })
        .then(function (r) { return r.json(); })
        .then(function (d) { return (PLAN_RANK[String((d && d.plan) || 'free').toLowerCase()] || 0) >= (PLAN_RANK[need] || 0); })
        .catch(function () { return false; });
    },
    wall: function (need, label) {
      const planName = need === 'pro' ? 'Pro' : 'Student';
      let o = document.getElementById('planGate');
      if (!o) { o = document.createElement('div'); o.id = 'planGate'; document.body.appendChild(o); }
      o.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(4,6,15,0.6);-webkit-backdrop-filter:blur(9px);backdrop-filter:blur(9px);';
      o.innerHTML = '<div style="max-width:430px;text-align:center;background:var(--surface-solid,#0D1428);border:1px solid var(--border-glow,rgba(200,255,77,0.35));border-radius:18px;padding:34px 28px;box-shadow:0 8px 32px rgba(0,0,0,0.5);">'
        + '<div style="font-size:2.6rem;">🔒</div><h2 style="font-family:var(--font-display,sans-serif);color:var(--ink,#F2F5FF);margin:12px 0 8px;">A ' + planName + ' feature</h2>'
        + '<p style="color:var(--ink-soft,#A9B2D6);line-height:1.6;">' + (label || 'This feature') + ' is included with ' + planName + '. Upgrade to unlock it.</p>'
        + '<a href="/checkout?plan=' + need + '" style="display:inline-block;margin-top:16px;background:var(--gradient-brand,linear-gradient(120deg,#C8FF4D,#4DF0FF));color:#070B1A;font-weight:700;border-radius:999px;padding:13px 30px;text-decoration:none;font-family:var(--font-display,sans-serif);">Upgrade →</a>'
        + '<div style="margin-top:14px;"><button type="button" onclick="var g=document.getElementById(\'planGate\');if(g)g.remove();" style="background:none;border:none;color:var(--ink-faint,#5F6A94);cursor:pointer;font-size:0.86rem;">Maybe later</button></div></div>';
    }
  };

  const NAV_LINKS = [
    { label: '💬 Chat', href: '/chat' },
    { label: '⚡ Codex', href: '/codex' },
    { label: '📄 Guess Papers', href: '/guess-papers' },
    { label: '📖 Books', href: '/books' },
    { label: '🧪 Quiz', href: '/quiz' },
    { label: '💡 Learn', href: '/learn' },
    { label: '📚 Subjects', href: '/subjects' },
    { label: '📊 Progress', href: '/progress' },
  ];

  const ENGINES = [
    { id: 'reasoner', name: 'Groq', provider: 'The Reasoner', status: 'live', color: 'var(--lime)', desc: 'Step-by-step explanations tuned to your level.' },
    { id: 'solver', name: 'Gemini', provider: 'The Solver', status: 'live', color: 'var(--coral)', desc: 'Math and code walkthroughs with worked solutions.' },
    { id: 'explorer', name: 'ChatGPT', provider: 'The Explorer', status: 'live', color: 'var(--blue)', desc: 'Real-world examples and visual learning paths.' },
    { id: 'storyteller', name: 'Claude', provider: 'The Storyteller', status: 'live', color: 'var(--pink)', desc: 'Analogies and narratives that make ideas stick.' },
  ];

  function lsGet(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null || raw === undefined) return fallback;
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    } catch {
      return fallback;
    }
  }

  function getInitials(name) {
    const value = (name || '').trim();
    if (!value) return 'MM';
    return value
      .split(/\s+/)
      .map((part) => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }

  function isActive(href) {
    const path = window.location.pathname.replace(/\.html$/, '');
    const clean = href.replace(/\.html$/, '');
    return path === clean || path.endsWith(clean.replace(/^\//, ''));
  }

  function getLevelMeta() {
    const count = Number(lsGet('mm_count', 0) || 0);
    const subjects = lsGet('mm_subjects', {});
    const quizScores = lsGet('mm_quiz_scores', {});
    const streak = lsGet('mm_streak', []);
    const milestones = lsGet('mm_milestones', []);
    const explainChecks = lsGet('mm_explain_checks', []);
    const allScores = Object.values(quizScores || {}).flat();
    const xp = Number(
      count * 2 +
      Object.keys(subjects || {}).length * 25 +
      allScores.length * 15 +
      allScores.reduce((sum, score) => sum + Math.round(Number(score || 0) * 0.2), 0) +
      Math.min(streak.length, 7) * 10 +
      milestones.length * 5 +
      Math.min(explainChecks.length, 10) * 20 +
      (Number(lsGet('mm_bonus_xp', 0)) || 0)
    );
    const storedLevel = lsGet('mm_level', 'Newbie');
    const levels = [
      { name: 'Newbie', icon: '🌱', min: 0, max: 150 },
      { name: 'Learner', icon: '📖', min: 150, max: 400 },
      { name: 'Explorer', icon: '🧭', min: 400, max: 800 },
      { name: 'Scholar', icon: '📚', min: 800, max: 1500 },
      { name: 'Master', icon: '🏆', min: 1500, max: Infinity },
    ];
    const matched = levels.find((level) => xp >= level.min && xp < level.max);
    if (matched) {
      return { ...matched, xp };
    }
    return { ...(levels.find((level) => level.name === storedLevel) || levels[0]), xp };
  }

  function buildBetaBanner() {
    if (document.querySelector('.beta-banner')) return;
    const path = window.location.pathname;
    if (path === '/' || path.endsWith('/index.html')) return;
    const banner = document.createElement('div');
    banner.className = 'beta-banner';
    banner.innerHTML = '<strong>Launch access</strong> — Hungter is in early access. Some premium features and billing are not yet live; check the engine status below for current availability.';
    document.body.prepend(banner);
  }

  function buildNav() {
    const nav = document.querySelector('.site-nav');
    if (!nav || nav.dataset.built === 'true') return;

    const path = window.location.pathname;
    const isLanding = path === '/' || path.endsWith('/index.html');
    const isCheckout = path.endsWith('/checkout.html');
    if (isLanding || isCheckout) {
      nav.style.display = 'none';
      nav.dataset.built = 'true';
      return;
    }

    const name = lsGet('mm_name', '');
    const brandHref = name ? '/dashboard' : '/';
    const avatarColor = lsGet('mm_avatarColor', '#7b7cff');
    const initials = getInitials(name);
    const level = getLevelMeta();
    const streakDays = lsGet('mm_streak', []).length;
    const streakBadge = streakDays >= 3
      ? `<span class="nav-streak-flame" title="${streakDays}-day streak">🔥 ${streakDays}</span>`
      : '';
    const links = NAV_LINKS.map((link) => {
      const active = isActive(link.href) ? ' active' : '';
      return `<a href="${link.href}" class="nav-link${active}">${link.label}</a>`;
    }).join('');

    nav.innerHTML = `
      <div class="nav-brand"><a href="${brandHref}">🧠 Hungter</a></div>
      <button class="nav-toggle" type="button" aria-label="Open menu" aria-expanded="false">
        <span></span><span></span><span></span>
      </button>
      <div class="nav-panel">
        <nav class="nav-links">${links}</nav>
        <div class="nav-right">
          ${streakBadge}
          <div class="nav-level-badge" id="navLevelBadge" aria-label="Current level">
            <span class="nav-level-icon">${level.icon}</span>
            <span class="nav-level-copy">
              <strong>${level.name}</strong>
              <small>${Math.max(0, Number(level.xp || 0))} XP</small>
            </span>
          </div>
          <a href="/checkout" class="nav-credits" id="navCredits" title="AI credits left today" style="display:none;"></a>
          <a href="/chat" class="chat-btn">💬 Ask AI</a>
          <a href="/profile" class="avatar" style="background-color:${avatarColor}" title="Profile">${initials}</a>
        </div>
      </div>
    `;
    nav.dataset.built = 'true';

    const toggle = nav.querySelector('.nav-toggle');
    const panel = nav.querySelector('.nav-panel');
    toggle?.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    panel?.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => nav.classList.remove('open'));
    });

    refreshCredits();
  }

  // ── AI credits badge — live daily balance from the server ──────────────────
  async function refreshCredits() {
    const el = document.getElementById('navCredits');
    if (!el) return;
    let token = null;
    try { token = JSON.parse(localStorage.getItem('mm_auth_token') || 'null'); } catch (e) {}
    try {
      const r = await fetch(apiPath('/api/credits.php'), { headers: token ? { Authorization: 'Bearer ' + token } : {} });
      if (!r.ok) return;
      const d = await r.json();
      if (!d || typeof d.left === 'undefined') return;
      el.textContent = '⚡ ' + d.left;
      el.title = d.left + ' AI credits left today · ' + d.plan + ' plan';
      el.style.display = '';
      el.classList.toggle('low', d.left <= 3);
    } catch (e) {}
  }
  window.HungterCredits = { refresh: refreshCredits };

  function calculateXPForNav() {
    const count = Number(lsGet('mm_count', 0) || 0);
    const subjects = lsGet('mm_subjects', {});
    const quizScores = lsGet('mm_quiz_scores', {});
    const streak = lsGet('mm_streak', []);
    const milestones = lsGet('mm_milestones', []);
    const explainChecks = lsGet('mm_explain_checks', []);
    const allScores = Object.values(quizScores || {}).flat();
    return Number(
      count * 2 +
      Object.keys(subjects || {}).length * 25 +
      allScores.length * 15 +
      allScores.reduce((sum, score) => sum + Math.round(Number(score || 0) * 0.2), 0) +
      Math.min(streak.length, 7) * 10 +
      milestones.length * 5 +
      Math.min(explainChecks.length, 10) * 20 +
      (Number(lsGet('mm_bonus_xp', 0)) || 0)
    );
  }

  function ensureTopProgressBar() {
    const path = window.location.pathname;
    if (path === '/' || path.endsWith('/index.html')) {
      return;
    }
    let topBar = document.querySelector('.top-bar');
    if (!topBar) {
      topBar = document.createElement('div');
      topBar.className = 'top-bar';
      topBar.style.height = '4px';
      topBar.style.background = 'var(--surface-2)';
      topBar.innerHTML = '<div class="top-bar-fill" style="height:100%;background:linear-gradient(90deg,var(--lime),var(--blue));width:0%;border-radius:999px;"></div>';
      document.body.prepend(topBar);
    }
    const fill = topBar.querySelector('.top-bar-fill');
    if (fill) {
      const xp = calculateXPForNav();
      const levels = [
        { min: 0, max: 150 },
        { min: 150, max: 400 },
        { min: 400, max: 800 },
        { min: 800, max: 1500 },
        { min: 1500, max: Infinity },
      ];
      const level = levels.find((item) => xp >= item.min && xp < item.max) || levels[levels.length - 1];
      const pct = level.max === Infinity ? 100 : Math.max(0, Math.min(100, Math.round(((xp - level.min) / (level.max - level.min)) * 100)));
      fill.style.width = `${pct}%`;
    }
  }

  function buildFooter() {
    const target = document.querySelector('.site-footer');
    if (!target || target.dataset.built === 'true') return;
    const year = new Date().getFullYear();
    target.innerHTML = `
      <div class="container">
        <div class="footer-grid">
          <div>
            <div class="footer-brand">🧠 Hungter</div>
            <p class="footer-copy">Four AI engines. One tutor that adapts to how you learn. Built for students, families, and schools.</p>
          </div>
          <div class="footer-col">
            <h4>Features</h4>
            <a href="/ai-tutor-chat">AI Tutor Chat</a>
            <a href="/ai-quizzes">AI Quizzes</a>
            <a href="/smart-flashcards">Smart Flashcards</a>
            <a href="/practice-papers">Practice Papers</a>
            <a href="/ai-app-builder">Codex App Builder</a>
            <a href="/progress-tracking">Progress Tracking</a>
            <a href="/ai-engines">The 4 AI Engines</a>
          </div>
          <div class="footer-col">
            <h4>Company</h4>
            <a href="/pricing">Pricing</a>
            <a href="/books">Book Store</a>
            <a href="/about">About</a>
            <a href="/signup">Get started</a>
            <a href="/checkout?plan=student">Upgrade</a>
          </div>
          <div class="footer-col">
            <h4>Legal</h4>
            <a href="/terms">Terms</a>
            <a href="/privacy">Privacy</a>
            <a href="/faq">FAQ</a>
            <a href="/complaints">Complaints</a>
          </div>
          <div class="footer-col" data-footer-status>
            <h4>Status</h4>
            <p>Groq, Gemini, ChatGPT, Claude: live</p>
            <p>Billing: testing phase</p>
          </div>
        </div>
        <div class="footer-bottom">
          <span>© ${year} Hungter. All rights reserved.</span>
          <span>Built by a student, for students. Independent — not affiliated with Cambridge, Pearson, College Board, or any exam board.</span>
        </div>
      </div>
    `;
    target.dataset.built = 'true';
  }

  function renderEngineCards(container, statuses) {
    container.innerHTML = ENGINES.map((engine) => {
      const status = statuses[engine.id] ? 'live' : 'soon';
      return `
      <article class="engine-status hg-holo ${status}">
        <div class="engine-status-top">
          <span class="engine-dot ${status}" style="background:${engine.color}"></span>
          <span class="engine-badge ${status}">${status === 'live' ? 'LIVE' : 'COMING SOON'}</span>
        </div>
        <h3>${engine.name}</h3>
        <p>${engine.desc}</p>
        <p style="font-family:var(--font-mono);font-size:0.72rem;color:var(--ink-faint);">${engine.provider}</p>
      </article>
    `;
    }).join('');
  }

  function renderFooterStatus(statuses) {
    const target = document.querySelector('[data-footer-status]');
    if (!target) return;
    const liveEngines = ENGINES.filter((engine) => statuses[engine.id]).map((engine) => engine.name.replace('The ', ''));
    const comingSoon = ENGINES.filter((engine) => !statuses[engine.id]).map((engine) => engine.name.replace('The ', ''));
    const lines = [`<h4>Status</h4>`, `<p>${liveEngines.length ? liveEngines.join(', ') : 'No engines'}: live</p>`];
    if (comingSoon.length) lines.push(`<p>${comingSoon.join(', ')}: coming soon</p>`);
    lines.push('<p>Billing: testing phase</p>');
    target.innerHTML = lines.join('');
  }

  function liveEnginesLabel(count) {
    if (count >= 4) return 'All 4 AI engines live';
    if (count <= 0) return 'Engines starting up…';
    return `${count} engine${count === 1 ? '' : 's'} live · ${4 - count} coming soon`;
  }

  function renderLivePulse(stats) {
    const active = document.getElementById('pulseActive');
    const chatsToday = document.getElementById('pulseChatsToday');
    const visitors = document.getElementById('pulseVisitors');
    if (!active && !chatsToday && !visitors) return;
    // "Learning right now" reads oddly at 0 — floor it at 1 (you're here).
    const activeCount = Math.max(1, Number(stats?.activeNow || 0));
    const countUp = typeof window.hgCountUp === 'function' ? window.hgCountUp : (el, v) => { if (el) el.textContent = String(v); };
    if (active) countUp(active, activeCount);
    if (chatsToday) countUp(chatsToday, Number(stats?.chatsToday || 0));
    if (visitors) countUp(visitors, Number(stats?.totalVisitors || 0));
  }

  async function renderEngineStatus(container) {
    // Fallback chains mean every engine answers as long as one key is set,
    // so default to all-live until /api/status says otherwise.
    const fallbackStatuses = { reasoner: true, solver: true, explorer: true, storyteller: true };
    if (container) renderEngineCards(container, fallbackStatuses);
    const sticker = document.querySelector('[data-live-engines]');
    if (sticker) {
      sticker.innerHTML = `<span class="hg-live-dot"></span> ${liveEnginesLabel(4)}`;
    }
    try {
      const response = await fetch(apiPath('/api/status'));
      const data = await response.json();
      if (data.engines) {
        if (container) renderEngineCards(container, data.engines);
        renderFooterStatus(data.engines);
        if (sticker) {
          const liveCount = Object.values(data.engines).filter(Boolean).length;
          sticker.innerHTML = `<span class="hg-live-dot"></span> ${liveEnginesLabel(liveCount)}`;
        }
      }
      if (data.stats) renderLivePulse(data.stats);
    } catch {
      // keep the all-live fallback render if /api/status is unreachable
      renderFooterStatus(fallbackStatuses);
    }
  }

  // ---------- Gamification FX: XP toasts, level-up celebrations, milestone toasts ----------
  function ensureFXLayer() {
    let layer = document.getElementById('hungterFXLayer');
    if (layer) return layer;
    layer = document.createElement('div');
    layer.id = 'hungterFXLayer';
    layer.setAttribute('aria-live', 'polite');
    document.body.appendChild(layer);
    return layer;
  }

  function showXPToast(gained) {
    const layer = ensureFXLayer();
    const toast = document.createElement('div');
    toast.className = 'hg-xp-toast';
    toast.textContent = `+${gained} XP`;
    layer.appendChild(toast);
    // Also pulse the nav badge if it's on screen.
    const badge = document.getElementById('navLevelBadge');
    if (badge) {
      badge.classList.remove('hg-pulse');
      void badge.offsetWidth;
      badge.classList.add('hg-pulse');
    }
    window.setTimeout(() => toast.remove(), 1800);
  }

  function showMilestoneToast(eventName) {
    const layer = ensureFXLayer();
    const toast = document.createElement('div');
    toast.className = 'hg-milestone-toast';
    toast.innerHTML = `<span class="hg-milestone-icon">🏆</span><span></span>`;
    toast.querySelector('span:last-child').textContent = eventName;
    layer.appendChild(toast);
    window.setTimeout(() => toast.classList.add('hg-leaving'), 3200);
    window.setTimeout(() => toast.remove(), 3600);
  }

  function spawnConfetti(container) {
    const colors = ['#C8FF4D', '#4DF0FF', '#8B5CFF', '#FF4DE3', '#FFD14D'];
    const pieceCount = 42;
    for (let i = 0; i < pieceCount; i += 1) {
      const piece = document.createElement('span');
      piece.className = 'hg-confetti-piece';
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.background = colors[i % colors.length];
      piece.style.animationDelay = `${Math.random() * 0.4}s`;
      piece.style.animationDuration = `${1.6 + Math.random() * 1.2}s`;
      piece.style.setProperty('--drift', `${(Math.random() - 0.5) * 160}px`);
      container.appendChild(piece);
    }
  }

  function showLevelUpModal(detail) {
    const layer = ensureFXLayer();
    const overlay = document.createElement('div');
    overlay.className = 'hg-levelup-overlay';
    overlay.innerHTML = `
      <div class="hg-confetti-field"></div>
      <div class="hg-levelup-card">
        <div class="hg-levelup-icon">${detail.icon || '🏆'}</div>
        <p class="hg-levelup-eyebrow">Level up</p>
        <h2>You're now a ${detail.level}!</h2>
        <p class="hg-levelup-copy">You leveled up from ${detail.previousLevel} to ${detail.level}. Keep the streak going.</p>
        <button type="button" class="hg-levelup-dismiss">Nice →</button>
      </div>
    `;
    layer.appendChild(overlay);
    spawnConfetti(overlay.querySelector('.hg-confetti-field'));

    const close = () => overlay.remove();
    overlay.querySelector('.hg-levelup-dismiss')?.addEventListener('click', close);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close();
    });
    window.setTimeout(close, 6000);
  }

  function initGamificationFX() {
    window.addEventListener('hungter:xpgain', (event) => {
      const gained = event?.detail?.gained;
      if (gained && gained > 0) showXPToast(gained);
    });
    window.addEventListener('hungter:milestone', (event) => {
      const name = event?.detail?.event;
      if (name) showMilestoneToast(name);
    });
    window.addEventListener('hungter:levelup', (event) => {
      if (event?.detail?.level) showLevelUpModal(event.detail);
    });
  }

  window.HungterUI = {
    ENGINES,
    buildBetaBanner,
    buildNav,
    buildFooter,
    renderEngineStatus,
    getInitials,
    lsGet,
  };

  function loadFXLayer() {
    if (document.querySelector('script[src^="/fx.js"]') || window.__hungterFX) return;
    const script = document.createElement('script');
    script.src = '/fx.js?v=20260711';
    script.defer = true;
    document.head.appendChild(script);
  }

  document.addEventListener('DOMContentLoaded', () => {
    buildBetaBanner();
    ensureTopProgressBar();
    buildNav();
    buildFooter();
    renderEngineStatus(document.querySelector('[data-engine-status]'));
    initGamificationFX();
    loadFXLayer();
  });
})();
