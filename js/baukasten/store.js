// Projektspeicher: alle Baukasten-Projekte im localStorage ("8boy:baukasten"), Rückgängig/Wiederholen,
// Export/Import als JSON-Datei.
import { TEMPLATES, uid } from './templates.js';

const KEY = '8boy:baukasten';
const MAX_UNDO = 120;

function readAll() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (raw && raw.projects) return raw;
  } catch { /* kaputt oder privat */ }
  return { current: null, projects: {} };
}

export function createStore() {
  const db = readAll();
  const listeners = new Set();
  let project = db.current && db.projects[db.current] ? db.projects[db.current] : null;
  let undo = [], redo = [];
  let lastKey = null, lastTime = 0;
  let saveTimer = null;
  let pending = null;   // Schnappschuss vor einer laufenden Malbewegung
  const ui = {};        // Auswahl in der Oberfläche (gehört nicht in die Geschichte)

  const emit = (what) => listeners.forEach((f) => f(what));

  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 350);
    emit('dirty');
  }
  function saveNow() {
    clearTimeout(saveTimer);
    if (project) { project.updated = Date.now(); db.projects[project.id] = project; db.current = project.id; }
    try {
      localStorage.setItem(KEY, JSON.stringify(db));
      emit('saved');
    } catch (e) {
      emit('savefail');
      console.warn('Baukasten: Speichern fehlgeschlagen', e);
    }
  }

  // Eine Änderung: fn(project) verändert das Projekt direkt.
  // opts.merge = Schlüssel: schnelle Änderungen am selben Feld werden ein Schritt (Tippen).
  // opts.render = false: Oberfläche nicht neu aufbauen (das Eingabefeld zeigt den Wert schon)
  function edit(fn, opts = {}) {
    if (!project) return;
    const now = performance.now();
    const merge = opts.merge && opts.merge === lastKey && now - lastTime < 1200;
    if (!merge && !pending) {
      undo.push(JSON.stringify(project));
      if (undo.length > MAX_UNDO) undo.shift();
      redo = [];
    }
    lastKey = opts.merge || null; lastTime = now;
    fn(project);
    persist();
    emit(opts.render === false ? 'quiet' : 'change');
  }
  // Malbewegungen: begin() merkt den Stand, während des Malens wird ohne Schnappschuss geändert, end() schließt ab
  function begin() { if (!project || pending) return; pending = JSON.stringify(project); }
  function end() {
    if (pending === null) return;
    if (pending !== JSON.stringify(project)) { undo.push(pending); if (undo.length > MAX_UNDO) undo.shift(); redo = []; persist(); }
    pending = null;
    lastKey = null;
    emit('change');
  }

  function doUndo() {
    if (!undo.length) return false;
    redo.push(JSON.stringify(project));
    project = JSON.parse(undo.pop());
    db.projects[project.id] = project;
    lastKey = null;
    persist(); emit('change');
    return true;
  }
  function doRedo() {
    if (!redo.length) return false;
    undo.push(JSON.stringify(project));
    project = JSON.parse(redo.pop());
    db.projects[project.id] = project;
    lastKey = null;
    persist(); emit('change');
    return true;
  }

  function open(id) {
    if (!db.projects[id]) return;
    saveNow();
    project = db.projects[id];
    db.current = id;
    undo = []; redo = []; lastKey = null;
    for (const k of Object.keys(ui)) delete ui[k];
    saveNow();
    emit('open');
  }
  function create(templateId) {
    const t = TEMPLATES.find((x) => x.id === templateId) || TEMPLATES[0];
    const p = t.make();
    p.template = t.id;
    db.projects[p.id] = p;
    open(p.id);
    return p;
  }
  function duplicate(id) {
    const src = db.projects[id];
    if (!src) return null;
    const p = JSON.parse(JSON.stringify(src));
    p.id = uid('p'); p.cartId = null; p.title = src.title + ' (Kopie)'; p.created = Date.now();
    db.projects[p.id] = p;
    saveNow();
    emit('list');
    return p;
  }
  function remove(id) {
    delete db.projects[id];
    if (project?.id === id) {
      project = null; db.current = null;
      const next = Object.values(db.projects).sort((a, b) => b.updated - a.updated)[0];
      if (next) open(next.id);
    }
    saveNow();
    emit('list');
  }
  function importJSON(text) {
    let p;
    // kein JSON (z.B. eine .lua-Kartridge): verständliche Meldung statt „Unexpected token … in JSON“
    try { p = JSON.parse(text); } catch { throw new Error(/^\s*--/.test(text) ? 'Das ist eine Kartridge (.lua), keine Baukasten-Datei. Kartridges öffnest du in der Konsole oder im Studio.' : 'Das ist keine Baukasten-Datei.'); }
    if (p?.format !== '8boy-baukasten' || !Array.isArray(p.scenes) || !Array.isArray(p.sprites)) throw new Error('Das ist keine Baukasten-Datei.');
    for (const k of ['sounds', 'music', 'counters', 'rules', 'dialogs', 'blueprints']) if (!Array.isArray(p[k])) p[k] = [];
    if (db.projects[p.id]) p.id = uid('p');
    p.cartId = null;
    p.updated = Date.now();
    db.projects[p.id] = p;
    open(p.id);
    return p;
  }
  const exportJSON = () => JSON.stringify(project, null, 1);

  return {
    get project() { return project; },
    get list() { return Object.values(db.projects).sort((a, b) => b.updated - a.updated); },
    get canUndo() { return undo.length > 0; },
    get canRedo() { return redo.length > 0; },
    ui, edit, begin, end, undo: doUndo, redo: doRedo, open, create, duplicate, remove, importJSON, exportJSON, saveNow,
    on(f) { listeners.add(f); return () => listeners.delete(f); },
  };
}
