// Hungter futuristic FX layer: starfield canvas + scroll-reveal animations.
// Loaded on every page via a <script> tag; safe to include twice (guards itself).
(function () {
  if (window.__hungterFX) return;
  window.__hungterFX = true;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── Starfield / particle canvas behind everything ─────────────────────
  function initStarfield() {
    if (reducedMotion) return;
    if (document.getElementById('hgStarfield')) return;

    const canvas = document.createElement('canvas');
    canvas.id = 'hgStarfield';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:-1;pointer-events:none;opacity:0.55;';
    document.body.prepend(canvas);

    const ctx = canvas.getContext('2d');
    const COLORS = ['rgba(200,255,77,', 'rgba(77,240,255,', 'rgba(139,92,255,', 'rgba(255,77,227,'];
    let stars = [];
    let w = 0;
    let h = 0;
    let rafId = null;

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(Math.round((w * h) / 14000), 140);
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: 0.4 + Math.random() * 1.6,
        vy: 0.04 + Math.random() * 0.18,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        tw: Math.random() * Math.PI * 2,
        twSpeed: 0.008 + Math.random() * 0.02,
      }));
    }

    function frame() {
      ctx.clearRect(0, 0, w, h);
      for (const s of stars) {
        s.y -= s.vy;
        s.tw += s.twSpeed;
        if (s.y < -4) { s.y = h + 4; s.x = Math.random() * w; }
        const alpha = 0.25 + Math.abs(Math.sin(s.tw)) * 0.6;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = s.color + alpha.toFixed(2) + ')';
        ctx.fill();
      }
      rafId = requestAnimationFrame(frame);
    }

    resize();
    frame();
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = null;
      } else if (!rafId) {
        frame();
      }
    });
  }

  // ── Scroll-reveal: fade+rise sections and cards as they enter view ────
  function initScrollReveal() {
    const selectors = [
      'section', '.how-card', '.engine-status', '.price-card', '.feature-card',
      '.quick-prompt-card', '.stat-card', '.subject-card', '.book-card',
    ];
    const targets = document.querySelectorAll(selectors.join(','));
    if (!targets.length) return;

    if (reducedMotion || !('IntersectionObserver' in window)) {
      targets.forEach((el) => el.classList.add('hg-revealed'));
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('hg-revealed');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });

    targets.forEach((el, i) => {
      el.classList.add('hg-reveal');
      el.style.transitionDelay = `${Math.min((i % 6) * 60, 300)}ms`;
      observer.observe(el);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { initStarfield(); initScrollReveal(); });
  } else {
    initStarfield();
    initScrollReveal();
  }
})();
