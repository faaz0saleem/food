// Celebrate — small, dependency-free confetti + shareable achievement cards.
// Used when Codex ships a build or the student levels up. Cards render on a
// canvas and share via the Web Share API (or download as a PNG) — pure
// client-side, works on any host.
(function () {
  const PALETTE = ['#C8FF4D', '#4DF0FF', '#8B5CFF', '#FF4DE3', '#FFD14D', '#FF6B4A'];

  function confetti(count) {
    count = count || 140;
    const cv = document.createElement('canvas');
    cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999;';
    document.body.appendChild(cv);
    const ctx = cv.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => { cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; };
    resize();
    const parts = Array.from({ length: count }, () => ({
      x: Math.random() * cv.width,
      y: -Math.random() * cv.height * 0.3,
      r: (4 + Math.random() * 6) * dpr,
      c: PALETTE[(Math.random() * PALETTE.length) | 0],
      vx: (Math.random() - 0.5) * 3 * dpr,
      vy: (2 + Math.random() * 4) * dpr,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
    }));
    let frame = 0;
    (function tick() {
      ctx.clearRect(0, 0, cv.width, cv.height);
      parts.forEach((p) => {
        p.x += p.vx; p.y += p.vy; p.vy += 0.05 * dpr; p.rot += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.c; ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 0.6);
        ctx.restore();
      });
      frame++;
      if (frame < 180) requestAnimationFrame(tick); else cv.remove();
    })();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function wrap(ctx, text, maxWidth) {
    const words = String(text).split(/\s+/);
    const lines = [];
    let line = '';
    words.forEach((w) => {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; }
      else line = test;
    });
    if (line) lines.push(line);
    return lines;
  }

  // Render a 1200×630 share card to a canvas and return it.
  function renderCard(opts) {
    const W = 1200, H = 630;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    // Background
    ctx.fillStyle = '#070B1A';
    ctx.fillRect(0, 0, W, H);
    const g1 = ctx.createRadialGradient(180, 60, 0, 180, 60, 700);
    g1.addColorStop(0, 'rgba(139,92,255,0.28)'); g1.addColorStop(1, 'rgba(139,92,255,0)');
    ctx.fillStyle = g1; ctx.fillRect(0, 0, W, H);
    const g2 = ctx.createRadialGradient(1050, 80, 0, 1050, 80, 640);
    g2.addColorStop(0, 'rgba(77,240,255,0.22)'); g2.addColorStop(1, 'rgba(77,240,255,0)');
    ctx.fillStyle = g2; ctx.fillRect(0, 0, W, H);
    // Border glow
    ctx.strokeStyle = 'rgba(200,255,77,0.35)'; ctx.lineWidth = 3;
    roundRect(ctx, 20, 20, W - 40, H - 40, 28); ctx.stroke();
    // Wordmark
    ctx.fillStyle = '#C8FF4D';
    ctx.font = '700 34px "Space Grotesk", Arial, sans-serif';
    ctx.fillText('⚡ HUNGTER', 70, 100);
    ctx.fillStyle = '#5F6A94';
    ctx.font = '400 22px "Manrope", Arial, sans-serif';
    ctx.fillText((opts.kind === 'codex' ? 'CODEX · 4-AI DEV TEAM' : 'AI TUTOR'), 70, 132);
    // Title
    ctx.fillStyle = '#F2F5FF';
    ctx.font = '700 64px "Space Grotesk", Arial, sans-serif';
    const lines = wrap(ctx, opts.title || 'I built something great', W - 140);
    let y = 300;
    lines.slice(0, 3).forEach((ln) => { ctx.fillText(ln, 70, y); y += 78; });
    // Subtitle
    if (opts.subtitle) {
      ctx.fillStyle = '#A9B2D6';
      ctx.font = '400 30px "Manrope", Arial, sans-serif';
      wrap(ctx, opts.subtitle, W - 140).slice(0, 2).forEach((ln) => { ctx.fillText(ln, 70, y); y += 42; });
    }
    // Stat pill
    if (opts.stat) {
      ctx.font = '700 26px "Space Mono", monospace';
      const tw = ctx.measureText(opts.stat).width;
      ctx.fillStyle = 'rgba(200,255,77,0.12)';
      roundRect(ctx, 70, H - 130, tw + 56, 56, 28); ctx.fill();
      ctx.fillStyle = '#C8FF4D';
      ctx.fillText(opts.stat, 98, H - 93);
    }
    // Footer
    ctx.fillStyle = '#5F6A94';
    ctx.font = '400 24px "Manrope", Arial, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('hungter.com · the tutor that gets you', W - 70, H - 70);
    ctx.textAlign = 'left';
    return cv;
  }

  function cardToBlob(cv) {
    return new Promise((resolve) => cv.toBlob((b) => resolve(b), 'image/png'));
  }

  async function shareCard(opts) {
    const cv = renderCard(opts);
    const blob = await cardToBlob(cv);
    if (!blob) return;
    const file = new File([blob], 'hungter-card.png', { type: 'image/png' });
    const shareText = (opts.title || 'Built with Hungter') + ' — hungter.com';
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], text: shareText }); return; } catch { /* fall through to download */ }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'hungter-card.png';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }

  // Add a "Share" button/card into a container (used after a Codex build).
  function mountShareButton(container, opts) {
    if (!container) return;
    const card = document.createElement('div');
    card.className = 'celebrate-share';
    card.innerHTML =
      '<span class="celebrate-emoji">🎉</span>' +
      '<div class="celebrate-copy"><strong>Nice — you shipped it!</strong>' +
      '<span>Share your win and invite a friend.</span></div>' +
      '<button type="button" class="celebrate-btn">📸 Share card</button>';
    card.querySelector('.celebrate-btn').addEventListener('click', () => shareCard(opts));
    container.prepend(card);
  }

  window.Celebrate = { confetti, shareCard, mountShareButton, renderCard };
})();
