// Innenleben: Konsole umdrehen, vier Schrauben lösen, Rückwand abheben – darunter die Platine mit den Chips.
// Die Chips sind echte Programmteile (gfx.js, audio.js, vm.js …). Ein Klick zeigt, was der Baustein tut,
// was er bei dieser Konsole kann, wie das beim echten Vorbild war und wo er im Code steht – mit Live-Werten.

const VORBILD = {
  8: 'Game Boy (1989)',
  16: 'Super Nintendo (1990)',
  32: 'PlayStation (1994)',
  64: 'Nintendo 64 (1996) bis GameCube und Xbox (2001)',
};

// Chips je Konsole: x, y, w, h in Prozent der Platine
function chips(m) {
  const mega = m.id >= 32, sup = m.id >= 16;
  const list = [
    { k: 'cpu', name: 'CPU', sub: 'Lua-Maschine', x: 38, y: 30, w: 22, h: 26, file: 'js/vm.js' },
    { k: 'gfx', name: sup ? 'PPU' : 'Grafik', sub: sup ? 'Bild · Ebenen · Perspektivboden' : 'Bild & Sprites', x: 64, y: 22, w: 20, h: 22, file: 'js/gfx.js' },
    { k: 'snd', name: sup ? 'DSP' : 'APU', sub: m.channels + ' Kanäle', x: 64, y: 52, w: 16, h: 18, file: 'js/audio.js' },
    { k: 'ram', name: 'RAM', sub: 'Arbeitsspeicher', x: 14, y: 26, w: 18, h: 12, file: 'js/vm.js' },
    { k: 'rom', name: 'ROM', sub: 'Betriebssystem', x: 14, y: 44, w: 18, h: 12, file: 'js/system.js' },
    { k: 'save', name: 'SAVE', sub: 'Spielstände', x: 14, y: 62, w: 12, h: 10, file: 'js/carts.js' },
    { k: 'io', name: 'I/O', sub: 'Tasten & Maus', x: 40, y: 64, w: 14, h: 12, file: 'js/input.js' },
    { k: 'slot', name: 'Schacht', sub: 'Kartridge', x: 26, y: 4, w: 48, h: 12, file: 'js/carts.js' },
  ];
  if (m.gpu) {
    // 8BOY 64: ein echter Grafikchip – im Browser die Grafikkarte über WebGL2
    list.push({ k: 'gpu', name: 'GPU', sub: 'Grafikkarte · WebGL2', x: 84, y: 22, w: 14, h: 38, file: 'js/gpu.js' });
    list.push({ k: 'vram', name: 'VRAM', sub: 'Tiefe & Texturen', x: 84, y: 64, w: 14, h: 12, file: 'js/gpu.js' });
  } else if (mega) {
    list.push({ k: 'gte', name: 'GTE', sub: '3D-Chip', x: 84, y: 30, w: 12, h: 30, file: 'js/gfx3d.js' });
    list.push({ k: 'zb', name: 'Z-RAM', sub: 'Tiefenspeicher', x: 84, y: 64, w: 12, h: 10, file: 'js/gfx3d.js' });
  }
  return list;
}

function info(k, m) {
  const mega = m.id >= 32, sup = m.id >= 16;
  const T = {
    cpu: ['Der Rechner der Konsole',
      'Hier läuft der Lua-Code der Kartridge: 60-mal pro Sekunde _update() für die Spiellogik und _draw() fürs Bild. Rechnet ein Aufruf länger als 2,5 Sekunden, gilt er als Endlosschleife und wird abgebrochen – sonst würde die Konsole einfrieren.',
      m.id === 8 ? 'Der Game Boy hatte einen Sharp-Prozessor mit 4,19 MHz, verwandt mit dem Z80. Programmiert wurde in Maschinensprache.'
        : m.id === 16 ? 'Im SNES rechnete ein Ricoh 5A22 (65C816) mit etwa 3,58 MHz – langsamer als man denkt. Für 3D brauchten Spiele wie Star Fox einen Zusatzchip in der Kartridge.'
          : m.id === 32 ? 'Die PlayStation hatte einen MIPS-R3000A mit 33,8 MHz, dazu einen eigenen Rechenchip für 3D (die GTE).'
            : 'Im Nintendo 64 rechnete ein MIPS-R4300i mit 93,75 MHz. Ab dieser Zeit übernahm ein eigener Grafikchip immer mehr Arbeit – die CPU kümmerte sich um die Spiellogik.'],
    gfx: ['Der Grafikchip',
      `Er malt jedes Bild: ${m.w}×${m.h} Bildpunkte, ${m.colors} Farben, Sprites bis 256 Stück und eine Kachelkarte.` + (sup ? ' Der 8BOY 16 hat 4 Ebenen und Perspektivboden: eine Karte als Boden in Perspektive, wie bei Rennspielen.' : ' Jeder Bildpunkt ist eine Farbnummer – die Palette sagt, welche Farbe dahintersteckt.'),
      m.id === 8 ? 'Der Game Boy zeigte 160×144 Punkte in 4 Graustufen. Höchstens 10 Sprites passten in eine Zeile, sonst flackerte es.'
        : m.id === 16 ? 'Beim SNES teilten sich zwei Chips (PPU1 und PPU2) die Arbeit: bis zu 256 von 32.768 Farben gleichzeitig, und eine eigene Betriebsart drehte und zoomte eine ganze Ebene – berühmt aus F-Zero und Super Mario Kart.'
          : m.id === 32 ? 'Die PlayStation-GPU zeichnete Dreiecke mit Texturen in 1 MB Videospeicher – bis zu etwa 360.000 pro Sekunde.'
            : 'Beim 8BOY 64 malt dieser Chip nur noch die 2D-Ebene (Text, Sprites, Anzeigen). Die 3D-Welt entsteht in der GPU daneben – beide Bilder werden übereinandergelegt.'],
    snd: ['Der Klangchip',
      `${m.channels} Kanäle spielen gleichzeitig: Melodien als Noten (MML), fertige Effekte oder Dauertöne für Motoren.` + (sup ? ' Dazu kommen Klangproben (Samples) und Hall.' : ' Jeder Kanal hat eine Wellenform: Rechteck, Dreieck, Säge oder Rauschen.'),
      m.id === 8 ? 'Der Game Boy hatte 4 Tonkanäle: 2 Rechteck, 1 freie Welle und 1 Rauschen – genau wie hier.'
        : m.id === 16 ? 'Im SNES steckte ein eigener Sony-Chip (SPC700 mit DSP): 8 Kanäle mit Klangproben und eigenem 64-KB-Speicher.'
          : m.id === 32 ? 'Die PlayStation-SPU mischte 24 Kanäle mit Klangproben, dazu kam Musik direkt von der CD.'
            : 'Das Nintendo 64 hatte keinen eigenen Klangchip – den Ton rechnete der Grafik-Koprozessor nebenbei mit.'],
    ram: ['Arbeitsspeicher',
      'Hier liegen alle Variablen und Tabellen der Kartridge, solange sie läuft. Beim Ausschalten ist alles weg – deshalb gibt es store() und fetch() für Spielstände.',
      m.id === 8 ? 'Der Game Boy kam mit 8 KB Arbeitsspeicher aus – ein heutiges Foto ist tausendmal größer.'
        : m.id === 16 ? 'Das SNES hatte 128 KB Arbeitsspeicher und 64 KB Videospeicher.' : m.id === 32 ? 'Die PlayStation hatte 2 MB Arbeitsspeicher und 1 MB Videospeicher.'
          : 'Das Nintendo 64 hatte 4 MB gemeinsamen Speicher für Programm, Bild und Texturen (mit Erweiterung 8 MB).'],
    rom: ['Betriebssystem',
      'Der feste Teil der Konsole: Einschalten, Startbild, Menü mit der Taste MENÜ, Kartridge prüfen und laden, „passt nicht“ bei zu neuen Kartridges.',
      m.id >= 64 ? 'Heimkonsolen wie GameCube und Xbox hatten ein Startmenü für Speicherkarten, Uhr und Einstellungen – die Xbox sogar eine Festplatte.'
        : m.id === 32 ? 'Die PlayStation hatte ein BIOS mit dem berühmten Startbild und einer Verwaltung für die Speicherkarte.' : 'Beim Game Boy prüfte ein winziges Start-ROM das Nintendo-Logo auf dem Modul – fehlte es, startete nichts.'],
    save: ['Spielstände',
      'store() schreibt Werte dauerhaft weg, fetch() liest sie wieder. Bei 8BOY landen sie im Speicher deines Browsers – nur auf diesem Gerät, ohne Konto.',
      m.id >= 64 ? 'Beim Nintendo 64 speicherten viele Module selbst, dazu gab es den Controller Pak; die Xbox speicherte auf ihrer Festplatte.'
        : m.id === 32 ? 'Bei der PlayStation kamen Spielstände auf eine Speicherkarte mit 128 KB.' : 'Game Boy und SNES speicherten im Modul selbst, auf einem Speicher mit kleiner Knopfzellen-Batterie.'],
    io: ['Eingabe',
      `${m.buttons} Tasten, dazu Gamepads, Tastatur, Touch und Maus. btn() fragt, ob eine Taste gehalten wird, btnp(), ob sie gerade gedrückt wurde.`,
      m.id === 8 ? 'Der Game Boy hatte 8 Tasten: Steuerkreuz, A, B, START und SELECT. Beim 8BOY heißen die beiden kleinen Tasten MENÜ und OPTION.' : m.id === 16 ? 'Das SNES brachte X, Y und die Schultertasten L und R dazu.' : m.id === 32 ? 'Der PlayStation-Controller hatte 14 Tasten, später kamen zwei Analogsticks dazu.'
        : 'Das Nintendo 64 hatte vier Anschlüsse für Controller – Mehrspieler am selben Bildschirm wurde zum Standard. Beim 8BOY 64: bis zu 4 Gamepads oder Handys (TV-Modus).'],
    slot: ['Kartridge-Schacht',
      'Eine Kartridge ist eine Lua-Datei mit Kopfzeilen: Titel, Etikett, für welche Konsole. Neuere Konsolen spielen ältere Kartridges, umgekehrt geht es nicht.',
      m.id >= 64 ? 'Das Nintendo 64 blieb bei Modulen (schnell, aber teuer), GameCube und Xbox setzten auf Discs.'
        : m.id === 32 ? 'Die PlayStation las Spiele von CD – viel Platz, aber Ladezeiten.' : 'Game-Boy- und SNES-Module enthielten einen ROM-Chip mit dem Spiel – sofort da, ohne Ladezeit.'],
    gte: ['3D-Chip',
      'Er rechnet Modelle aus Dreiecken in das Bild: drehen, verschieben, Perspektive, Licht und Nebel. Mit cam3d() setzt du die Kamera, mit draw3d() stellst du Modelle in die Welt.',
      'Die GTE der PlayStation rechnete Matrizen und Perspektive – sie war ein Rechen-Helfer, gezeichnet hat danach die GPU.'],
    zb: ['Tiefenspeicher (Z-Buffer)',
      'Für jeden Bildpunkt merkt er sich, wie weit weg das dort gemalte Dreieck ist. So verdeckt Nahes das Ferne – egal, in welcher Reihenfolge gemalt wird.',
      'Die PlayStation hatte keinen Z-Buffer! Spiele mussten Dreiecke selbst sortieren – daher das typische Wackeln und Überlappen.'],
    gpu: ['Grafikchip (GPU)',
      `Die 3D-Welt rechnet hier die echte Grafikkarte deines Geräts – über WebGL2. Tausende kleine Rechenkerne malen gleichzeitig: Tiefenspeicher, Texturen ohne Verziehen, Licht für jeden Bildpunkt und bis zu ${m.lamps} Lampen. Dazu Effekte: Glühen und Filter über das ganze Bild, Partikel, Sonnenschatten, Wasser. Datenblatt: höchstens ${(m.maxTris || 64000).toLocaleString('de-DE')} Dreiecke und 16.384 Teilchen pro Bild.`,
      'Das Nintendo 64 brachte 1996 einen Grafikchip mit Tiefenspeicher und weichgezeichneten Texturen. Die Xbox hatte 2001 als erste Konsole programmierbare Shader – kleine Programme, die direkt auf der Grafikkarte laufen.'],
    vram: ['Videospeicher: Tiefe und Texturen',
      'Auf der Grafikkarte liegen die Modelle (als Puffer mit Eckpunkten), die Sprites als Texturen und der Tiefenspeicher. filter3d() schaltet zwischen scharfen Pixeln, glatten Texturen und Mipmaps um.',
      'Das Nintendo 64 hatte nur 4 KB Texturspeicher im Grafikchip – deshalb wirken viele Spiele so verwaschen.'],
  };
  return T[k];
}

export function createInnen({ system, gfx, audio, input, hw, onCode }) {
  let stat = { ms: 0, n: 0 };
  const orig = system.tick;
  system.tick = (...a) => {
    const t0 = performance.now();
    const r = orig.apply(system, a);
    const d = performance.now() - t0;
    stat.ms = stat.ms * 0.9 + d * 0.1;
    stat.n++;
    return r;
  };

  const root = document.createElement('div');
  root.className = 'hw';
  root.hidden = true;
  document.body.appendChild(root);
  let schrauben = 0, auf = false, sel = null, raf = 0;

  function open() {
    const m = hw();
    schrauben = 0; auf = false; sel = null;
    root.innerHTML = `
      <div class="hw-stage">
        <div class="hw-back" id="hwBack">
          <div class="hw-plate">
            <div class="hw-sticker"><b>${m.name}</b><span>Modell ${m.typ} · YOURLEAF GmbH</span>
              <span>${m.w}×${m.h} · ${m.colors} Farben · ${m.channels} Kanäle</span></div>
            <div class="hw-batt">${m.id >= 64 ? 'Netzteil 12 V' : m.id >= 32 ? 'Akku 3,7 V' : '4 × AA'}</div>
            <div class="hw-grill">${'<i></i>'.repeat(12)}</div>
            ${[0, 1, 2, 3].map((i) => `<button class="hw-screw s${i}" aria-label="Schraube ${i + 1} lösen"><i></i></button>`).join('')}
          </div>
          <div class="hw-pcb" id="hwPcb">
            <div class="hw-traces"></div>
            ${chips(m).map((c) => `<button class="hw-chip c-${c.k}" data-k="${c.k}" style="left:${c.x}%;top:${c.y}%;width:${c.w}%;height:${c.h}%"><b>${c.name}</b><span>${c.sub}</span><em class="hw-led" data-led="${c.k}"></em></button>`).join('')}
          </div>
        </div>
        <aside class="hw-info" id="hwInfo"></aside>
      </div>
      <div class="hw-bar">
        <span id="hwHint">Vier Schrauben lösen – antippen oder anklicken.</span>
        <button class="tb" id="hwClose">Zuschrauben &amp; umdrehen</button>
      </div>`;
    root.hidden = false;
    document.body.classList.add('hw-open');
    requestAnimationFrame(() => root.classList.add('on'));
    root.querySelectorAll('.hw-screw').forEach((s) => s.addEventListener('click', () => {
      if (s.classList.contains('los')) return;
      s.classList.add('los');
      audio.sfx('t200 w1 v6 l32 o5 c e g', 2);
      schrauben++;
      root.querySelector('#hwHint').textContent = schrauben < 4 ? `Noch ${4 - schrauben} Schraube${4 - schrauben === 1 ? '' : 'n'}.` : 'Rückwand ab – tippe einen Chip an.';
      if (schrauben === 4) setTimeout(() => { auf = true; root.querySelector('.hw-back').classList.add('auf'); audio.sfx('powerup', 2); zeige('cpu'); }, 450);
    }));
    root.querySelectorAll('.hw-chip').forEach((c) => c.addEventListener('click', () => zeige(c.dataset.k)));
    root.querySelector('#hwClose').addEventListener('click', close);
    tick();
  }
  function close() {
    root.classList.remove('on');
    document.body.classList.remove('hw-open');
    cancelAnimationFrame(raf);
    setTimeout(() => { root.hidden = true; root.innerHTML = ''; }, 450);
  }
  function zeige(k) {
    if (!auf) return;
    const m = hw();
    sel = k;
    const c = chips(m).find((x) => x.k === k);
    const [titel, was, vorbild] = info(k, m);
    root.querySelectorAll('.hw-chip').forEach((el) => el.classList.toggle('sel', el.dataset.k === k));
    const box = root.querySelector('#hwInfo');
    box.innerHTML = `<h3>${c.name} · ${titel}</h3><p>${was}</p>
      <div class="hw-live" id="hwLive"></div>
      ${k === 'gpu' || k === 'vram' ? `<div class="hw-dbg">${[['', 'Normal'], ['draht', 'Drahtgitter'], ['tiefe', 'Tiefenspeicher'], ['zahlen', 'Zähler im Bild']].map(([d, l]) => `<button class="tb" data-dbg="${d}">${l}</button>`).join('')}</div>` : ''}
      <h4>Echtes Vorbild: ${VORBILD[m.id]}</h4><p>${vorbild}</p>
      <p class="hw-code">Im Code: <code>${c.file}</code> <a href="${c.file}" target="_blank" rel="noopener">ansehen</a></p>
      <p><small>Die Vorbilder sind zum Vergleich genannt. Genannte Marken gehören ihren Inhabern; 8BOY steht in keiner Verbindung zu ihnen.</small></p>`;
    box.classList.add('on');
    // Fehlersuch-Schalter des Grafikchips: wirken auf das laufende Spiel
    box.querySelectorAll('[data-dbg]').forEach((b) => b.addEventListener('click', () => gfx.g3?.debug3d?.(b.dataset.dbg || null)));
    if (onCode) box.querySelector('a').addEventListener('click', (e) => { if (onCode(c.file)) e.preventDefault(); });
  }
  // Live-Werte und Lämpchen
  function tick() {
    raf = requestAnimationFrame(tick);
    const m = hw();
    const led = (k, on) => { const el = root.querySelector(`[data-led="${k}"]`); if (el) el.classList.toggle('an', !!on); };
    const ch = [];
    for (let i = 0; i < m.channels; i++) ch.push(audio.playing(i));
    let tasten = 0;
    for (let i = 0; i < m.buttons; i++) if (input.btn(i)) tasten++;
    const running = system.state === 'running';
    led('cpu', running && (stat.n & 7) < 5);
    led('gfx', running);
    led('snd', ch.some(Boolean));
    led('io', tasten > 0);
    led('slot', !!system.cart);
    led('rom', system.state !== 'off');
    led('ram', running);
    const g3 = gfx.g3;
    led('gte', running && g3 && g3.tris3d() > 0);
    led('zb', running && g3 && g3.tris3d() > 0);
    led('gpu', running && g3 && g3.tris3d() > 0);
    led('vram', running && g3 && g3.tris3d() > 0);
    const live = root.querySelector('#hwLive');
    if (!live || !sel) return;
    const budget = 1000 / 60;
    let h = '';
    if (sel === 'cpu') h = `<div class="hw-meter"><i style="width:${Math.min(100, stat.ms / budget * 100).toFixed(0)}%"></i></div><small>${stat.ms.toFixed(2)} ms von ${budget.toFixed(1)} ms pro Bild · ${system.state === 'running' ? (system.cart?.title || '') : 'keine Kartridge läuft'}</small>`;
    else if (sel === 'snd') h = `<div class="hw-ch">${ch.map((on, i) => `<i class="${on ? 'an' : ''}" title="Kanal ${i}"></i>`).join('')}</div><small>leuchtet = Kanal spielt gerade</small>`;
    else if (sel === 'gfx') {
      const pal = gfx.palette;
      h = `<div class="hw-pal">${Array.from({ length: 32 }, (_, i) => `<i style="background:#${(pal[i] >>> 0 & 0xffffff).toString(16).padStart(6, '0')}"></i>`).join('')}</div><small>die ersten 32 Farben der Palette · ${m.w}×${m.h}</small>`;
    } else if (sel === 'io') h = `<div class="hw-ch">${Array.from({ length: m.buttons }, (_, i) => `<i class="${input.btn(i) ? 'an' : ''}"></i>`).join('')}</div><small>drück eine Taste – ihr Lämpchen leuchtet</small>`;
    else if (sel === 'gte' || sel === 'zb') h = `<small>${g3 ? g3.tris3d() : 0} Dreiecke im letzten Bild</small>`;
    else if (sel === 'gpu' || sel === 'vram') {
      const st = g3?.stats3d ? g3.stats3d() : { calls: 0, tris: 0, limit: false };
      const max = m.maxTris || 64000, voll = Math.min(100, st.tris / max * 100);
      h = `<div class="hw-meter"><i style="width:${voll.toFixed(0)}%"></i></div><small>${st.tris.toLocaleString('de-DE')} von ${max.toLocaleString('de-DE')} Dreiecken · ${st.calls} Zeichenaufrufe${st.limit ? ' · <b>Grenze erreicht</b>' : ''}${st.parts ? ` · ${st.parts.toLocaleString('de-DE')} Teilchen` : ''}${st.post ? ' · Nachbearbeitung an' : ''}${g3?.gpu ? ` · Effekt-Stufe ${st.quality ?? 0}` : ' · ohne Grafikkarte (Ersatz-Chip)'}</small>`;
    }
    else if (sel === 'slot') h = `<small>${system.cart ? `Drin: „${system.cart.title}“ · ${system.cart.code.length.toLocaleString('de')} Zeichen Lua` : 'Schacht ist leer'}</small>`;
    else if (sel === 'save') {
      let n = 0, b = 0;
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('8boy:save:')) { n++; b += (localStorage.getItem(k) || '').length; } }
      h = `<small>${n} gespeicherte Werte · ${(b / 1024).toFixed(1)} KB im Browser</small>`;
    } else if (sel === 'rom') h = `<small>Zustand: ${system.state}</small>`;
    else if (sel === 'ram') h = `<small>${system.cart ? 'Kartridge läuft und belegt Speicher' : 'gerade fast leer'}</small>`;
    if (live.dataset.h !== h) {
      live.innerHTML = h; live.dataset.h = h;
    }
  }
  document.addEventListener('keydown', (e) => { if (!root.hidden && e.code === 'Escape') { e.stopPropagation(); close(); } }, true);
  return { open, close, get offen() { return !root.hidden; } };
}
