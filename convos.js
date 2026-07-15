// Convo — a tiny localStorage store for saved conversation threads, shared by
// the Chat page and Codex. Each thread is { id, title, updatedAt, ...data }.
// It piggybacks on lsGet/lsSet from script.js so it works on any host with no
// backend. Keys: 'mm_chat_threads' (chat) and 'mm_codex_threads' (Codex).
(function () {
  function get(key) {
    const list = (typeof lsGet === 'function') ? lsGet(key, []) : [];
    return Array.isArray(list) ? list : [];
  }
  function set(key, list) {
    if (typeof lsSet === 'function') lsSet(key, list.slice(0, 80));
  }

  window.Convo = {
    newId() {
      return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    },
    list(key) {
      return get(key).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    },
    get(key, id) {
      return get(key).find((t) => t && t.id === id) || null;
    },
    save(key, thread) {
      if (!thread || !thread.id) return thread;
      thread.updatedAt = Date.now();
      const rest = get(key).filter((t) => t && t.id !== thread.id);
      set(key, [thread, ...rest]);
      return thread;
    },
    remove(key, id) {
      set(key, get(key).filter((t) => t && t.id !== id));
    },
    // "3m ago", "2h ago", "Yesterday", or a date.
    ago(ts) {
      const s = Math.max(0, Math.floor((Date.now() - (ts || 0)) / 1000));
      if (s < 60) return 'just now';
      if (s < 3600) return Math.floor(s / 60) + 'm ago';
      if (s < 86400) return Math.floor(s / 3600) + 'h ago';
      if (s < 172800) return 'yesterday';
      return new Date(ts).toLocaleDateString();
    },

    // Build a slide-in history drawer. opts:
    //   key         storage key of the threads
    //   title       panel heading
    //   newLabel    text of the "new" button
    //   onSelect(id), onNew()
    //   itemLabel(thread) -> { title, sub }
    // Returns { open, close, refresh }.
    mountDrawer(opts) {
      const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      const btn = document.createElement('button');
      btn.className = 'convo-fab';
      btn.type = 'button';
      btn.innerHTML = '<span>🕘</span> History';
      const overlay = document.createElement('div');
      overlay.className = 'convo-overlay';
      const panel = document.createElement('aside');
      panel.className = 'convo-panel';
      panel.setAttribute('aria-hidden', 'true');
      panel.innerHTML =
        '<div class="convo-head"><strong>' + esc(opts.title || 'History') + '</strong>' +
        '<button class="convo-x" type="button" aria-label="Close">✕</button></div>' +
        '<button class="convo-new" type="button">' + esc(opts.newLabel || '＋ New chat') + '</button>' +
        '<div class="convo-list"></div>';
      document.body.append(btn, overlay, panel);
      const listEl = panel.querySelector('.convo-list');

      function render() {
        const items = window.Convo.list(opts.key);
        if (!items.length) {
          listEl.innerHTML = '<p class="convo-empty">No saved conversations yet.</p>';
          return;
        }
        listEl.innerHTML = items.map((t) => {
          const lab = opts.itemLabel ? opts.itemLabel(t) : { title: t.title || 'Untitled', sub: window.Convo.ago(t.updatedAt) };
          return '<div class="convo-item" data-id="' + esc(t.id) + '">' +
            '<div class="convo-item-main"><div class="convo-item-title">' + esc(lab.title || 'Untitled') + '</div>' +
            '<div class="convo-item-sub">' + esc(lab.sub || '') + '</div></div>' +
            '<button class="convo-del" data-del="' + esc(t.id) + '" title="Delete" aria-label="Delete">🗑</button></div>';
        }).join('');
      }
      const open = () => { render(); panel.classList.add('open'); overlay.classList.add('open'); panel.setAttribute('aria-hidden', 'false'); };
      const close = () => { panel.classList.remove('open'); overlay.classList.remove('open'); panel.setAttribute('aria-hidden', 'true'); };

      btn.addEventListener('click', open);
      overlay.addEventListener('click', close);
      panel.querySelector('.convo-x').addEventListener('click', close);
      panel.querySelector('.convo-new').addEventListener('click', () => { close(); if (opts.onNew) opts.onNew(); });
      listEl.addEventListener('click', (e) => {
        const del = e.target.closest('[data-del]');
        if (del) { e.stopPropagation(); window.Convo.remove(opts.key, del.getAttribute('data-del')); render(); return; }
        const item = e.target.closest('.convo-item');
        if (item) { close(); if (opts.onSelect) opts.onSelect(item.getAttribute('data-id')); }
      });
      return { open, close, refresh: render };
    },
  };
})();
