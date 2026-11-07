// Auspacken: Beim ersten Mal liegt jede Kartridge eingeschweißt in ihrer Packung.
// Folie aufreißen → Deckel auf → Kartridge und Anleitungsheft kommen heraus → Heft durchblättern → einlegen.
import {
  renderBoxFront, renderBoxSide, renderBoxTop, renderBoxBack, renderManualPages, BOX_W, BOX_H, BOX_D, PAGE_W, PAGE_H,
} from './pixelart.js';

const SND = {
  tear: 't255 w5 v13 l64 o3 c d e f g a b > c d e f g a b',
  lid: 't200 w1 v9 l32 o4 c g > c e',
  rise: 't220 w0 v8 l32 o5 c e g > c',
  ta: 't150 w1 v9 l16 o4 g > c e g8',
  page: 't255 w5 v6 l64 o6 c r o5 a',
};

export function createUnboxer({ audio, cartElement, loadCover, onOpened, onInsert }) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const root = document.createElement('div');
  root.className = 'ub';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.innerHTML = `
    <div class="ub-room" aria-hidden="true"></div>
    <div class="ub-stage">
      <div class="ub-scene">
        <div class="ub-box">
          <div class="ub-face ub-back"></div>
          <div class="ub-face ub-bottom"></div>
          <div class="ub-face ub-left"></div>
          <div class="ub-face ub-right"></div>
          <div class="ub-face ub-inner"></div>
          <div class="ub-face ub-front"></div>
          <div class="ub-hinge"><div class="ub-lid"><div class="ub-face ub-lid-out"></div><div class="ub-face ub-lid-in"></div></div></div>
          <div class="ub-foil"><i></i><i></i><i></i><i></i></div>
          <div class="ub-seal"><b>8BOY</b><span>OPEN SOURCE</span></div>
        </div>
      </div>
      <div class="ub-item ub-cart"></div>
      <button class="ub-item ub-manual" aria-label="Anleitungsheft lesen"></button>
      <div class="ub-sparks" aria-hidden="true"></div>
    </div>
    <div class="ub-actions">
      <button class="ub-hint"></button>
      <button class="tb ub-read" hidden>Heft lesen</button>
    </div>
    <div class="ub-bar">
      <button class="tb ub-skip">Überspringen ▶</button>
      <button class="tb tb-close ub-close" aria-label="Schließen">✕</button>
    </div>
    <div class="ub-book" hidden>
      <div class="bk-spread">
        <div class="bk-page bk-left"><img alt=""></div>
        <div class="bk-page bk-right"><img alt=""></div>
        <div class="bk-leaf"><img class="bk-front" alt=""><img class="bk-back" alt=""></div>
      </div>
      <div class="bk-nav">
        <button class="tb bk-prev" aria-label="Zurückblättern">◀</button>
        <span class="bk-num" aria-live="polite"></span>
        <button class="tb bk-next" aria-label="Weiterblättern">▶</button>
        <button class="tb tb-run bk-insert">▶ Einlegen</button>
      </div>
      <button class="tb tb-close bk-close" aria-label="Heft zuklappen">✕</button>
    </div>`;
  document.body.appendChild(root);
  const q = (s) => root.querySelector(s);
  const box = q('.ub-box'), scene = q('.ub-scene'), hint = q('.ub-hint');
  const book = q('.ub-book');

  let cart = null, state = 'closed', pages = [], pageURLs = [], spread = 0, flipping = false, timers = [], onlyBook = false;
  const later = (ms, fn) => timers.push(setTimeout(fn, reduce ? Math.min(ms, 60) : ms));
  const sfx = (name) => { try { audio.sfx(SND[name], 3); } catch { /* stumm */ } };

  function face(sel, canvas) {
    const el = q(sel);
    el.textContent = '';
    if (canvas) el.appendChild(canvas);
  }

  function setState(s) {
    state = s;
    root.dataset.state = s;
    const texts = {
      sealed: 'Folie aufreißen',
      torn: 'Packung öffnen',
      open: '',
      out: '▶ Einlegen und spielen',
    };
    hint.textContent = texts[s] ?? '';
    hint.hidden = !hint.textContent;
    hint.classList.toggle('ub-go', s === 'out');
    q('.ub-read').hidden = s !== 'out';
  }

  function sizes() {
    const W = innerWidth, H = innerHeight;
    const land = W > H * 1.1;
    const bh = Math.round(Math.min(H * (land ? 0.62 : 0.5), (W * (land ? 0.42 : 0.66)) / (BOX_W / BOX_H)));
    const bw = Math.round(bh * BOX_W / BOX_H), bd = Math.round(bw * BOX_D / BOX_W);
    root.style.setProperty('--bw', bw + 'px');
    root.style.setProperty('--bh', bh + 'px');
    root.style.setProperty('--bd', bd + 'px');
    // Endlage der Teile nach dem Auspacken
    const ch = Math.round(bh * 0.5), mh = Math.round(bh * 0.62);
    root.style.setProperty('--cart-s', (ch / 132).toFixed(3));
    root.style.setProperty('--man-h', mh + 'px');
    const pos = land
      ? { box: [-W * 0.2, 0, 0.82], cart: [W * 0.1, H * 0.02], man: [W * 0.3, 0] }
      : { box: [0, -H * 0.22, 0.62], cart: [-W * 0.22, H * 0.15], man: [W * 0.2, H * 0.14] };
    root.style.setProperty('--box-out', `translate(${pos.box[0]}px, ${pos.box[1]}px) scale(${pos.box[2]})`);
    root.style.setProperty('--cart-out', `translate(${pos.cart[0]}px, ${pos.cart[1]}px)`);
    root.style.setProperty('--man-out', `translate(${pos.man[0]}px, ${pos.man[1]}px)`);
    // Heft
    const two = W > H * 1.05;
    book.classList.toggle('two', two);
    const ph = Math.floor(Math.min(H * 0.8, two ? (W * 0.9) / 2 / (PAGE_W / PAGE_H) : (W * 0.9) / (PAGE_W / PAGE_H)));
    root.style.setProperty('--ph', ph + 'px');
    root.style.setProperty('--pw', Math.floor(ph * PAGE_W / PAGE_H) + 'px');
  }

  async function open(c, { manualOnly = false } = {}) {
    cart = c;
    timers.forEach(clearTimeout); timers = [];
    const cover = await loadCover(c);
    face('.ub-front', renderBoxFront(c, cover));
    face('.ub-back', renderBoxBack(c, cover));
    face('.ub-left', renderBoxSide(c));
    face('.ub-right', renderBoxSide(c));
    face('.ub-lid-out', renderBoxTop(c));
    pages = renderManualPages(c, cover);
    pageURLs = pages.map((p) => p.toDataURL());
    const cartEl = cartElement(c);
    q('.ub-cart').textContent = '';
    q('.ub-cart').appendChild(cartEl);
    const m = q('.ub-manual');
    m.textContent = '';
    const img = new Image(); img.src = pageURLs[0]; img.alt = '';
    m.appendChild(img);
    root.setAttribute('aria-label', 'Packung: ' + c.title);
    sizes();
    root.hidden = false;
    document.body.classList.add('ub-open');
    onlyBook = manualOnly;
    requestAnimationFrame(() => root.classList.add('show'));
    if (manualOnly) { setState('out'); openBook(); return; }
    setState('sealed');
    hint.focus({ preventScroll: true });
  }

  function close() {
    timers.forEach(clearTimeout); timers = [];
    root.classList.remove('show');
    book.hidden = true;
    root.hidden = true;
    document.body.classList.remove('ub-open');
    state = 'closed';
    cart = null;
  }

  function tear() {
    if (state !== 'sealed') return;
    sfx('tear');
    setState('torn');
    root.classList.add('tearing');
    later(650, () => root.classList.remove('tearing'));
  }

  function openLid() {
    if (state !== 'torn') return;
    setState('open');
    onOpened?.(cart);
    sfx('lid');
    later(700, () => { sfx('rise'); root.classList.add('rising'); });
    later(1500, () => { root.classList.remove('rising'); setState('out'); sfx('ta'); });
  }

  function next() {
    if (state === 'sealed') tear();
    else if (state === 'torn') openLid();
  }

  // ---------------------------------------------------------------- Heft
  const two = () => book.classList.contains('two');
  const maxSpread = () => (two() ? Math.ceil(pages.length / 2) : pages.length - 1);
  function pageAt(i) { return i >= 0 && i < pages.length ? pageURLs[i] : ''; }
  function showSpread() {
    const L = q('.bk-left img'), R = q('.bk-right img');
    if (two()) {
      L.src = pageAt(2 * spread - 1) || ''; R.src = pageAt(2 * spread) || '';
      q('.bk-left').classList.toggle('empty', !pageAt(2 * spread - 1));
      q('.bk-right').classList.toggle('empty', !pageAt(2 * spread));
    } else { R.src = pageAt(spread); q('.bk-right').classList.remove('empty'); }
    const last = spread >= maxSpread();
    q('.bk-prev').disabled = spread <= 0;
    q('.bk-next').hidden = last;
    // „Einlegen“ auf jeder Seite – niemand muss bis zum Ende blättern
    q('.bk-insert').hidden = false;
    const n = two() ? [2 * spread, 2 * spread + 1].filter((i) => i >= 1 && i <= pages.length).join('–') : String(spread + 1);
    q('.bk-num').textContent = spread === 0 ? 'Umschlag' : `Seite ${n} / ${pages.length}`;
  }
  function openBook() {
    sizes();
    spread = 0;
    book.hidden = false;
    root.classList.add('reading');
    showSpread();
    q('.bk-next').focus({ preventScroll: true });
  }
  function closeBook() {
    book.hidden = true;
    root.classList.remove('reading');
    if (onlyBook || state !== 'out') close();
  }
  function flip(dir) {
    if (flipping) return;
    const to = spread + dir;
    if (to < 0 || to > maxSpread()) return;
    sfx('page');
    const leaf = q('.bk-leaf');
    const front = leaf.querySelector('.bk-front'), back = leaf.querySelector('.bk-back');
    leaf.className = 'bk-leaf ' + (dir > 0 ? 'fwd' : 'back');
    if (two()) {
      if (dir > 0) { front.src = pageAt(2 * spread); back.src = pageAt(2 * spread + 1); q('.bk-right img').src = pageAt(2 * to); q('.bk-right').classList.toggle('empty', !pageAt(2 * to)); }
      else { front.src = pageAt(2 * spread - 1); back.src = pageAt(2 * spread - 2); q('.bk-left img').src = pageAt(2 * to - 1); q('.bk-left').classList.toggle('empty', !pageAt(2 * to - 1)); }
    } else {
      front.src = pageAt(dir > 0 ? spread : to); back.src = '';
      q('.bk-right img').src = pageAt(dir > 0 ? to : spread);
    }
    flipping = true;
    void leaf.offsetWidth;
    leaf.classList.add('go');
    setTimeout(() => { spread = to; leaf.className = 'bk-leaf'; flipping = false; showSpread(); }, reduce ? 30 : 520);
  }

  function insert() {
    const el = q('.ub-cart .cart');
    const rect = el?.getBoundingClientRect();
    const c = cart;
    onOpened?.(c);
    close();
    onInsert(c, rect);
  }

  // ---------------------------------------------------------------- Bedienung
  hint.addEventListener('click', () => (state === 'out' ? insert() : next()));
  q('.ub-read').addEventListener('click', () => { if (state === 'out') openBook(); });
  box.addEventListener('click', next);
  q('.ub-seal').addEventListener('click', (e) => { e.stopPropagation(); next(); });
  q('.ub-manual').addEventListener('click', () => { if (state === 'out') openBook(); });
  q('.ub-cart').addEventListener('click', () => { if (state === 'out') insert(); });
  q('.ub-skip').addEventListener('click', insert);
  q('.ub-close').addEventListener('click', close);
  q('.bk-prev').addEventListener('click', () => flip(-1));
  q('.bk-next').addEventListener('click', () => flip(1));
  q('.bk-insert').addEventListener('click', insert);
  q('.bk-close').addEventListener('click', closeBook);
  let sw = null;
  q('.bk-spread').addEventListener('pointerdown', (e) => { sw = { x: e.clientX, y: e.clientY }; });
  q('.bk-spread').addEventListener('pointerup', (e) => {
    if (!sw) return;
    const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
    sw = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) flip(dx < 0 ? 1 : -1);
    else if (Math.abs(dx) < 8 && Math.abs(dy) < 8) {
      const r = q('.bk-spread').getBoundingClientRect();
      flip(e.clientX > r.left + r.width / 2 ? 1 : -1);
    }
  });
  window.addEventListener('keydown', (e) => {
    if (root.hidden) return;
    const k = e.code;
    const reading = !book.hidden;
    if (k === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); reading ? closeBook() : close(); return; }
    // Fokus per Tastatur auf einem Knopf: Enter/Leertaste drücken genau diesen Knopf
    if ((k === 'Space' || k === 'Enter') && e.target.closest?.('.ub button') && e.target.matches(':focus-visible')) { e.stopImmediatePropagation(); return; }
    if (reading) {
      if (k === 'ArrowRight' || k === 'KeyD') flip(1);
      else if (k === 'ArrowLeft' || k === 'KeyA') flip(-1);
      else if (k === 'Enter' || k === 'KeyX' || k === 'KeyK') insert();
      else if (k === 'KeyZ' || k === 'KeyY' || k === 'KeyJ') closeBook();
      else return;
      e.preventDefault(); e.stopImmediatePropagation();
      return;
    }
    if (k === 'Space' || k === 'Enter' || k === 'KeyX' || k === 'KeyK') {
      e.preventDefault(); e.stopImmediatePropagation();
      if (state === 'out') insert(); else next();
    } else if (state === 'out' && (k === 'KeyE' || k === 'KeyH')) { e.preventDefault(); k === 'KeyE' ? insert() : openBook(); }
  }, true);
  window.addEventListener('resize', () => { if (!root.hidden) { sizes(); if (!book.hidden) showSpread(); } });

  // Zurück: erst das Heft zuklappen, dann die Packung schließen
  const back = () => (!book.hidden ? closeBook() : close());

  return {
    open,
    close,
    back,
    openManual: (c) => open(c, { manualOnly: true }),
    get isOpen() { return !root.hidden; },
    get state() { return state; },
  };
}
