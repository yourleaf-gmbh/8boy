// Service Worker: hält die App offline verfügbar. VERSION erhöhen, wenn sich Dateien ändern.
const VERSION = '8boy-v36';
const SHELL = [
  './', 'index.html', 'config.js', 'manifest.webmanifest', 'LIZENZEN.txt', 'css/console.css', 'css/unbox.css', 'css/dock.css', 'vendor/fengari-web.js',
  'js/main.js', 'js/gfx.js', 'js/font.js', 'js/audio.js', 'js/input.js', 'js/vm.js', 'js/system.js', 'js/carts.js', 'js/editor.js', 'js/api-docs.js', 'js/pixel-editor.js', 'js/pixelart.js', 'js/unbox.js', 'js/pngcart.js', 'js/machines.js', 'js/gfx3d.js', 'js/model-editor.js', 'js/obj-import.js', 'js/net.js', 'js/vm-debug.js', 'js/debug-panel.js', 'js/innen.js', 'js/a11y.js', 'js/dock.js', 'js/pad.js', 'js/padnet.js', 'js/qr.js', 'js/gpu.js', 'js/gpufx.js', 'js/model-pack.js', 'js/gltf-import.js', 'js/mesh-simplify.js', 'js/assets.js', 'js/skin.js', 'js/physik.js', 'js/ui-ebene.js', 'js/ui-schrift.js', 'vendor/AtkinsonHyperlegible-Regular.ttf', 'vendor/AtkinsonHyperlegible-Bold.ttf',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'carts/index.json', 'carts/store.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(SHELL);
    // nur das Grundregal; Spiele aus dem Store kommen beim Holen in den Cache
    const list = await (await fetch('carts/index.json')).json();
    await cache.addAll(list.map((f) => 'carts/' + f));
    // Titelbilder der Packungen: fehlende sind kein Fehler
    await Promise.all(list.map((f) => cache.add('covers/' + f.replace(/\.lua$/, '.png')).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // der Zwischenspeicher der Asset-Pakete (js/assets.js) bleibt über App-Updates erhalten
    for (const key of await caches.keys()) if (key !== VERSION && !key.startsWith('8boy-assets')) await caches.delete(key);
    await self.clients.claim();
  })());
});

// Erst Netz (damit neue Kartridges ankommen), bei Funkloch der Cache
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Teilbereiche (Range) lassen sich nicht cachen
  if (e.request.headers.has('range')) return;
  // Asset-Pakete verwaltet js/assets.js selbst (eigener Zwischenspeicher, Prüfsummen)
  if (url.pathname.includes('/assets/')) return;
  e.respondWith((async () => {
    try {
      const res = await fetch(e.request);
      if (res.ok) (await caches.open(VERSION)).put(e.request, res.clone());
      return res;
    } catch {
      return (await caches.match(e.request, { ignoreSearch: true })) || Response.error();
    }
  })());
});
