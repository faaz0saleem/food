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
      '.q-card', '.bq-card', '.engine-pill', '.milestone', '.review-item',
      '.similar-card', '.card', '.roundcard', '.topic-bar-row',
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
      if (el.classList.contains('hg-revealed')) return;
      el.classList.add('hg-reveal');
      el.style.transitionDelay = `${Math.min((i % 6) * 60, 300)}ms`;
      observer.observe(el);
    });
  }

  // Re-run reveal registration for content injected after load (dashboards,
  // dynamic lists). Cheap: only touches elements not yet observed/revealed.
  function watchForNewContent() {
    if (reducedMotion || !('MutationObserver' in window)) return;
    const mo = new MutationObserver(() => {
      clearTimeout(watchForNewContent._t);
      watchForNewContent._t = setTimeout(initScrollReveal, 250);
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  // ── Count-up: animate a number from its current value to a target ─────
  // Usage: window.hgCountUp(element, 1234) or hgCountUp(element, 1234, {suffix:'%'})
  window.hgCountUp = function hgCountUp(el, target, opts) {
    if (!el) return;
    const options = opts || {};
    const duration = reducedMotion ? 0 : (options.duration || 900);
    const suffix = options.suffix || '';
    const prefix = options.prefix || '';
    const start = Number(String(el.textContent || '0').replace(/[^0-9.-]/g, '')) || 0;
    const end = Number(target) || 0;
    if (duration === 0 || start === end) {
      el.textContent = prefix + end.toLocaleString() + suffix;
      return;
    }
    const startTime = performance.now();
    function tick(now) {
      const progress = Math.min(1, (now - startTime) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const value = Math.round(start + (end - start) * eased);
      el.textContent = prefix + value.toLocaleString() + suffix;
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  };

  // ── Magnetic tilt: subtle 3D tilt on holographic cards following cursor ─
  function initMagneticTilt() {
    if (reducedMotion || window.matchMedia('(pointer: coarse)').matches) return;
    document.addEventListener('mousemove', (event) => {
      const card = event.target.closest && event.target.closest('.hg-holo');
      if (!card) return;
      const rect = card.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      card.style.transform = `perspective(600px) rotateY(${x * 6}deg) rotateX(${-y * 6}deg) translateY(-2px)`;
    });
    document.addEventListener('mouseout', (event) => {
      const card = event.target.closest && event.target.closest('.hg-holo');
      if (!card) return;
      card.style.transform = '';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initStarfield();
      initScrollReveal();
      watchForNewContent();
      initMagneticTilt();
    });
  } else {
    initStarfield();
    initScrollReveal();
    watchForNewContent();
    initMagneticTilt();
  }
})();
