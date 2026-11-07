// Karten zeichnen: Kacheln und Objekte einer Szene auf ein Canvas (für Editor, Vorschaubilder, Blaupausen).
import { hex, spriteBitmap } from './ui.js';

export function spriteMap(project) {
  const m = new Map();
  for (const s of project.sprites) m.set(s.n, s);
  return m;
}

// Zeichnet in Pixeln der Konsole (8 je Kachel) auf g; der Aufrufer skaliert das Canvas.
export function drawScene(g, project, { tiles, w, h, objects = [], color = 1, hidden = true }, sprites = spriteMap(project)) {
  g.imageSmoothingEnabled = false;
  g.fillStyle = hex(color);
  g.fillRect(0, 0, w * 8, h * 8);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = sprites.get(tiles[y * w + x]);
    if (s) g.drawImage(spriteBitmap(s.rows), x * 8, y * 8);
  }
  for (const o of objects) {
    const s = sprites.get(o.sprite);
    if (!s) continue;
    if (o.versteckt && hidden) g.globalAlpha = 0.45;
    g.drawImage(spriteBitmap(s.rows), o.x * 8, o.y * 8);
    g.globalAlpha = 1;
  }
}

export function sceneCanvas(project, scene, scale = 1) {
  const c = document.createElement('canvas');
  c.width = scene.w * 8; c.height = scene.h * 8;
  drawScene(c.getContext('2d'), project, { tiles: scene.tiles, w: scene.w, h: scene.h, objects: scene.objects, color: scene.color });
  c.style.width = scene.w * 8 * scale + 'px';
  c.className = 'pix';
  return c;
}
