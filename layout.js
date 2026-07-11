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

  const NAV_LINKS = [
    { label: '💡 Learn', href: '/learn.html' },
    { label: '📚 Subjects', href: '/subjects.html' },
    { label: '📖 Books', href: '/books.html' },
    { label: '🧪 Quiz', href: '/quiz.html' },
    { label: '📄 Guess Papers', href: '/guess-papers.html' },
    { label: '📊 Progress', href: '/progress.html' },
    { label: '🎙️ RoundChat', href: '/roundchat.html' },
    { label: '💬 Chat', href: '/chat.html' },
  ];

  const ENGINES = [
    { id: 'reasoner', name: 'The Reasoner', provider: 'Groq', status: 'live', color: 'var(--lime)', desc: 'Step-by-step explanations tuned to your level.' },
    { id: 'solver', name: 'The Solver', provider: 'Gemini', status: 'soon', color: 'var(--coral)', desc: 'Math and code walkthroughs with worked solutions.' },
    { id: 'explorer', name: 'The Explorer', provider: 'OpenAI', status: 'soon', color: 'var(--blue)', desc: 'Real-world examples and visual learning paths.' },
    { id: 'storyteller', name: 'The Storyteller', provider: 'Claude', status: 'soon', color: 'var(--pink)', desc: 'Analogies and narratives that make ideas stick.' },
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
    const path = window.location.pathname;
    return path === href || path.endsWith(href.replace(/^\//, ''));
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
      Math.min(explainChecks.length, 10) * 20
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
    const brandHref = name ? '/dashboard.html' : '/';
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
          <a href="/chat.html" class="chat-btn">💬 Ask AI</a>
          <a href="/profile.html" class="avatar" style="background-color:${avatarColor}" title="Profile">${initials}</a>
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
  }

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
      Math.min(explainChecks.length, 10) * 20
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
            <h4>Product</h4>
            <a href="/learn.html">Learn</a>
            <a href="/subjects.html">Subjects</a>
            <a href="/quiz.html">Quiz</a>
            <a href="/chat.html">AI Chat</a>
          </div>
          <div class="footer-col">
            <h4>Company</h4>
            <a href="/#pricing">Pricing</a>
            <a href="/signup.html">Get started</a>
            <a href="/checkout.html?plan=student">Upgrade</a>
          </div>
          <div class="footer-col">
            <h4>Legal</h4>
            <a href="/terms.html">Terms</a>
            <a href="/privacy.html">Privacy</a>
            <a href="/faq.html">FAQ</a>
          </div>
          <div class="footer-col" data-footer-status>
            <h4>Status</h4>
            <p>Reasoner (Groq): live</p>
            <p>Solver, Explorer, Storyteller: checking…</p>
            <p>Stripe billing: testing phase</p>
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
      <article class="engine-status ${status}">
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
    lines.push('<p>Stripe billing: testing phase</p>');
    target.innerHTML = lines.join('');
  }

  async function renderEngineStatus(container) {
    const fallbackStatuses = { reasoner: true, solver: false, explorer: false, storyteller: false };
    if (container) renderEngineCards(container, fallbackStatuses);
    const sticker = document.querySelector('[data-live-engines]');
    if (sticker) {
      const liveFallback = Object.values(fallbackStatuses).filter(Boolean).length;
      sticker.textContent = `${liveFallback} engine${liveFallback === 1 ? '' : 's'} live · ${4 - liveFallback} coming soon`;
    }
    try {
      const response = await fetch(apiPath('/api/status'));
      const data = await response.json();
      if (data.engines) {
        if (container) renderEngineCards(container, data.engines);
        renderFooterStatus(data.engines);
        if (sticker) {
          const liveCount = Object.values(data.engines).filter(Boolean).length;
          sticker.textContent = `${liveCount} engine${liveCount === 1 ? '' : 's'} live · ${4 - liveCount} coming soon`;
        }
      }
    } catch {
      // keep the fallback render (Groq only) if /api/status is unreachable
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

  document.addEventListener('DOMContentLoaded', () => {
    buildBetaBanner();
    ensureTopProgressBar();
    buildNav();
    buildFooter();
    renderEngineStatus(document.querySelector('[data-engine-status]'));
    initGamificationFX();
  });
})();
