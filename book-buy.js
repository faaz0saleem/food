// Shared purchase logic for a book product page. The page sets window.BOOK to
// the book's data; this wires the buy box (PDF / physical), checkout and the
// related-books rail. Element IDs match every /books/<id> page.
(function () {
  var API = String(window.HUNGTER_API_BASE || '').replace(/\/$/, '');
  var SHIP = 5; // flat shipping for the physical book
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); };
  var palette = ['#8B5CFF', '#4DF0FF', '#FF6B4A', '#C8FF4D', '#FF4DE3', '#4DD8FF', '#FFD14D'];
  function colorFor(s) { s = String(s || ''); var h = 0; for (var i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h); return palette[Math.abs(h) % palette.length]; }
  function coverStyle(b) { var c = colorFor(b.subject || b.title); return 'background:linear-gradient(150deg,' + c + ',rgba(4,6,15,0.9));'; }

  var book = window.BOOK;
  if (!book || !$('buyBtn')) return;
  var state = { format: 'pdf', qty: 1 };

  function money(n) { return '$' + Number(n).toFixed(2); }
  function unitPrice() { return state.format === 'physical' ? (book.price + SHIP) : book.price; }
  function total() { return unitPrice() * (state.format === 'physical' ? state.qty : 1); }

  function renderPrices() {
    if ($('pdfPrice')) $('pdfPrice').textContent = money(book.price);
    if ($('physPrice')) $('physPrice').textContent = money(book.price + SHIP) + ' incl. ship';
    $('price').innerHTML = money(total()) + ' <small>' + (state.format === 'pdf' ? 'PDF download' : state.qty + ' × physical') + '</small>';
    $('deliveryNote').textContent = state.format === 'pdf'
      ? '📧 Emailed as a PDF to you within 5 hours of purchase.'
      : '🚚 Printed book shipped to your address (' + money(SHIP) + ' flat shipping).';
    $('qtyRow').style.display = state.format === 'physical' ? 'flex' : 'none';
    if (state.format === 'pdf') { state.qty = 1; $('qVal').textContent = '1'; }
  }
  function setFormat(f) {
    state.format = f;
    $('fmtPdf').classList.toggle('on', f === 'pdf');
    $('fmtPhys').classList.toggle('on', f === 'physical');
    renderPrices();
  }

  $('buyBtn').addEventListener('click', function () {
    $('checkout').classList.remove('hide');
    $('coSummary').textContent = book.title + ' · ' + (state.format === 'pdf' ? 'PDF' : state.qty + ' × physical') + ' · ' + money(total());
    $('shipFields').classList.toggle('hide', state.format !== 'physical');
    $('checkout').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  $('fmtPdf').addEventListener('click', function () { setFormat('pdf'); if (!$('checkout').classList.contains('hide')) $('buyBtn').click(); });
  $('fmtPhys').addEventListener('click', function () { setFormat('physical'); if (!$('checkout').classList.contains('hide')) $('buyBtn').click(); });
  $('qMinus').addEventListener('click', function () { state.qty = Math.max(1, state.qty - 1); $('qVal').textContent = state.qty; renderPrices(); });
  $('qPlus').addEventListener('click', function () { state.qty = Math.min(20, state.qty + 1); $('qVal').textContent = state.qty; renderPrices(); });

  $('placeBtn').addEventListener('click', async function () {
    $('coErr').textContent = '';
    var name = $('coName').value.trim(), email = $('coEmail').value.trim();
    if (!name) { $('coErr').textContent = 'Please enter your name.'; return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { $('coErr').textContent = 'Please enter a valid email.'; return; }
    var payload = { bookId: book.id, bookTitle: book.title, price: unitPrice(), quantity: state.qty, email: email, name: name, format: state.format };
    if (state.format === 'physical') {
      payload.address = $('coAddress').value.trim();
      payload.phone = $('coPhone').value.trim();
      if (!payload.address) { $('coErr').textContent = 'Please enter your shipping address.'; return; }
    }
    var tok = null; try { tok = JSON.parse(localStorage.getItem('mm_auth_token') || 'null'); } catch (e) {}
    $('placeBtn').disabled = true; $('placeBtn').textContent = 'Placing…';
    var data = null, urls = [API + '/api/book-order.php', API + '/api/book-order'];
    for (var i = 0; i < urls.length; i++) {
      try {
        var r = await fetch(urls[i], { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, tok ? { Authorization: 'Bearer ' + tok } : {}), body: JSON.stringify(payload) });
        var ct = String(r.headers.get('content-type') || '');
        if (r.ok || ct.indexOf('application/json') >= 0) { data = await r.json(); break; }
      } catch (e) {}
    }
    $('placeBtn').disabled = false; $('placeBtn').textContent = 'Place order';
    if (data && data.orderRef) {
      $('productView').classList.add('hide');
      $('doneView').classList.remove('hide');
      $('doneRef').textContent = data.orderRef;
      $('doneMsg').textContent = data.message || data.delivery || '';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      $('coErr').textContent = (data && data.error) ? data.error : 'Could not place the order. Please try again.';
    }
  });

  function renderRelated() {
    fetch('/data/books.json').then(function (r) { return r.json(); }).then(function (list) {
      var rel = (list || []).filter(function (b) { return b.id !== book.id && (b.subject === book.subject || b.section === book.section); }).slice(0, 6);
      if (!rel.length || !$('relatedWrap')) return;
      $('relatedWrap').style.display = 'block';
      $('relGrid').innerHTML = rel.map(function (b) {
        return '<a class="rel-card" href="/books/' + encodeURIComponent(b.id) + '"><div class="rc-cov" style="' + coverStyle(b) + '">' + esc(b.title) + '</div><div class="rc-t">' + esc(b.title) + '</div><div class="rc-p">' + money(b.price) + '</div></a>';
      }).join('');
    }).catch(function () {});
  }

  renderPrices();
  renderRelated();
})();
