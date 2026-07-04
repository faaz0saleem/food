(function () {
  const NAV_LINKS = [
    { label: 'Dashboard', href: '/dashboard.html' },
    { label: 'Learn', href: '/learn.html' },
    { label: 'Subjects', href: '/subjects.html' },
    { label: 'Quiz', href: '/quiz.html' },
    { label: 'Progress', href: '/progress.html' },
    { label: 'Chat', href: '/chat.html' },
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
      return raw ? JSON.parse(raw) : fallback;
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

  function buildBetaBanner() {
    if (document.querySelector('.beta-banner')) return;
    const banner = document.createElement('div');
    banner.className = 'beta-banner';
    banner.innerHTML = '<strong>Beta testing</strong> — MindMesh is in early access. Payments are still in testing; check the engine status below for which AI engines are live today.';
    document.body.prepend(banner);
  }

  function buildNav() {
    const nav = document.querySelector('.site-nav');
    if (!nav || nav.dataset.built === 'true') return;

    const name = lsGet('mm_name', '');
    const avatarColor = lsGet('mm_avatarColor', '#7b7cff');
    const initials = getInitials(name);
    const links = NAV_LINKS.map((link) => {
      const active = isActive(link.href) ? ' active' : '';
      return `<a href="${link.href}" class="nav-link${active}">${link.label}</a>`;
    }).join('');

    nav.innerHTML = `
      <div class="nav-brand"><a href="/">🧠 MindMesh</a></div>
      <button class="nav-toggle" type="button" aria-label="Open menu" aria-expanded="false">
        <span></span><span></span><span></span>
      </button>
      <div class="nav-panel">
        <nav class="nav-links">${links}</nav>
        <div class="nav-right">
          <a href="/chat.html" class="chat-btn">Ask AI →</a>
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

  function buildFooter() {
    const target = document.querySelector('.site-footer');
    if (!target || target.dataset.built === 'true') return;
    const year = new Date().getFullYear();
    target.innerHTML = `
      <div class="container">
        <div class="footer-grid">
          <div>
            <div class="footer-brand">🧠 MindMesh</div>
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
            <a href="/onboarding.html">Get started</a>
            <a href="/checkout.html?plan=student">Upgrade</a>
          </div>
          <div class="footer-col" data-footer-status>
            <h4>Status</h4>
            <p>Reasoner (Groq): live</p>
            <p>Solver, Explorer, Storyteller: checking…</p>
            <p>Stripe billing: testing phase</p>
          </div>
        </div>
        <div class="footer-bottom">
          <span>© ${year} MindMesh. All rights reserved.</span>
          <span>Made for learners who want more than a generic chatbot.</span>
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
    try {
      const response = await fetch('/api/status');
      const data = await response.json();
      if (data.engines) {
        if (container) renderEngineCards(container, data.engines);
        renderFooterStatus(data.engines);
      }
    } catch {
      // keep the fallback render (Groq only) if /api/status is unreachable
      renderFooterStatus(fallbackStatuses);
    }
  }

  window.MindMeshUI = {
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
    buildNav();
    buildFooter();
    renderEngineStatus(document.querySelector('[data-engine-status]'));
  });
})();
